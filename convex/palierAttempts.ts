/**
 * Palier-aware attempt mutations + queries.
 *
 * Decisions: 12, 13, 50, 51, 52, 59, 61 (security: never leak correctAnswer),
 *            75 (deterministic shuffle uses match/order/drag-drop verifier).
 *
 * Lives outside `paliers/` because Convex's file-based routing places this
 * under `api.palierAttempts.*` — easier for the client to import.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  computePalierScore,
  PALIER_VALIDATION_THRESHOLD,
  scoreExerciseFromAttempts,
} from "./paliers/scoring";
import { shuffleDeterministic } from "./paliers";
import { verifyAnswer } from "./paliers/answers";
import {
  clampCount,
  clampSubmittedAt,
  clampTimeSpent,
  lowerBound,
} from "./paliers/journal";
import { api, internal } from "./_generated/api";
import { checkAccess, requireAccess } from "./access";

// ===========================================================================
// La vérification des réponses vit dans `paliers/answers.ts`, avec les
// ENCODEURS que les clients emploient pour fabriquer la chaîne soumise.
//
// Elle était ici, et chaque composant d'exercice du web fabriquait sa chaîne
// de son côté. Tant qu'il n'y avait qu'un client, une divergence se voyait
// tout de suite ; à deux clients — web et mobile — un encodage qui dérive d'un
// caractère donne un enfant qui a RAISON et que le serveur compte FAUX, sans
// que rien ne signale l'écart. Les deux moitiés du contrat sont donc dans un
// seul fichier pur, sous tests d'aller-retour.
// ===========================================================================

// ===========================================================================
// MUTATIONS
// ===========================================================================

async function loadFinalExercisesForAttempt(
  ctx: QueryCtx | MutationCtx,
  palierAttempt: Doc<"palierAttempts">,
): Promise<Doc<"exercises">[]> {
  const exosByAttempt = await ctx.db
    .query("exercises")
    .withIndex("by_palierAttemptId", (q) =>
      q.eq("palierAttemptId", palierAttempt._id),
    )
    .take(50);
  const variationOriginalIds = new Set(
    exosByAttempt
      .map((e) => e.originalExerciseId)
      .filter(Boolean) as Id<"exercises">[],
  );
  const exosByPalier = await ctx.db
    .query("exercises")
    .withIndex("by_palierId", (q) => q.eq("palierId", palierAttempt.palierId))
    .take(50);

  const finalExos: Doc<"exercises">[] = [];
  for (const ex of exosByPalier) {
    if (!variationOriginalIds.has(ex._id)) finalExos.push(ex);
  }
  for (const ex of exosByAttempt) finalExos.push(ex);
  finalExos.sort((a, b) => a.order - b.order);
  return finalExos;
}

export const verifyAttempt = mutation({
  args: {
    exerciseId: v.id("exercises"),
    palierAttemptId: v.id("palierAttempts"),
    userAnswer: v.string(),
    timeSpentMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Non authentifié");
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId as string))
      .unique();
    if (!profile) throw new Error("Profil introuvable");

    // Paywall (spec §5.4) — une mutation lève, l'appelant attrape.
    await requireAccess(ctx, profile);

    const exercise = await ctx.db.get(args.exerciseId);
    if (!exercise) throw new Error("Exercice introuvable");

    const attempt = await ctx.db.get(args.palierAttemptId);
    if (!attempt) throw new Error("Tentative introuvable");
    if (attempt.userId !== profile._id) throw new Error("Accès refusé");

    // How many times has the kid attempted this exo in this palierAttempt?
    const previous = await ctx.db
      .query("attempts")
      .withIndex("by_palierAttempt_exercise", (q) =>
        q.eq("palierAttemptId", args.palierAttemptId).eq("exerciseId", args.exerciseId),
      )
      .take(100);

    const attemptNumber = previous.length + 1;
    const hintsUsedCount = previous.reduce((acc, a) => acc + a.hintsUsedCount, 0);

    const isCorrect = verifyByType(exercise, args.userAnswer);

    await ctx.db.insert("attempts", {
      studentId: profile._id,
      exerciseId: args.exerciseId,
      submittedAnswer: args.userAnswer,
      isCorrect,
      attemptNumber,
      hintsUsedCount: 0, // hint usage is tracked on the requestHint mutation directly
      timeSpentMs: args.timeSpentMs ?? 0,
      submittedAt: Date.now(),
      palierAttemptId: args.palierAttemptId,
    });

    // Server-only feedback. We DO NOT return the correct answer — Decision 61.
    return {
      isCorrect,
      attemptNumber,
      hintsUsedSoFar: hintsUsedCount,
      attemptsRemaining: Math.max(0, 5 - attemptNumber),
    };
  },
});

export const requestHint = mutation({
  args: {
    exerciseId: v.id("exercises"),
    palierAttemptId: v.id("palierAttempts"),
    hintIndex: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Non authentifié");
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId as string))
      .unique();
    if (!profile) throw new Error("Profil introuvable");

    // Paywall (spec §5.4) — une mutation lève, l'appelant attrape.
    await requireAccess(ctx, profile);

    const exercise = await ctx.db.get(args.exerciseId);
    if (!exercise) throw new Error("Exercice introuvable");
    if (!Array.isArray(exercise.hints)) throw new Error("Aucun indice disponible");
    if (args.hintIndex < 0 || args.hintIndex >= exercise.hints.length) {
      throw new Error("Index d'indice invalide");
    }

    const attempt = await ctx.db.get(args.palierAttemptId);
    if (!attempt) throw new Error("Tentative introuvable");
    if (attempt.userId !== profile._id) throw new Error("Accès refusé");

    // Track the hint with a synthetic non-correct attempt row so the score
    // function can later deduct it. We add 1 hint and isCorrect=false so it's
    // ignored by `firstCorrect` lookup but counted in totalHints.
    await ctx.db.insert("attempts", {
      studentId: profile._id,
      exerciseId: args.exerciseId,
      submittedAnswer: `__HINT_${args.hintIndex}`,
      isCorrect: false,
      attemptNumber: 0, // sentinel: not a real attempt
      hintsUsedCount: 1,
      timeSpentMs: 0,
      submittedAt: Date.now(),
      palierAttemptId: args.palierAttemptId,
    });

    return {
      hint: exercise.hints[args.hintIndex],
      hintIndex: args.hintIndex,
      totalHints: exercise.hints.length,
    };
  },
});

export const submitPalier = mutation({
  args: { palierAttemptId: v.id("palierAttempts") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Non authentifié");
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId as string))
      .unique();
    if (!profile) throw new Error("Profil introuvable");

    // Paywall (spec §5.4) — une mutation lève, l'appelant attrape.
    await requireAccess(ctx, profile);

    const palierAttempt = await ctx.db.get(args.palierAttemptId);
    if (!palierAttempt) throw new Error("Tentative introuvable");
    if (palierAttempt.userId !== profile._id) throw new Error("Accès refusé");

    // Build the live exo list — same logic as getExercisesForPalier.
    const exosByAttempt = await ctx.db
      .query("exercises")
      .withIndex("by_palierAttemptId", (q) =>
        q.eq("palierAttemptId", args.palierAttemptId),
      )
      .take(50);
    const variationOriginalIds = new Set(
      exosByAttempt.map((e) => e.originalExerciseId).filter(Boolean) as Id<"exercises">[],
    );
    const exosByPalier = await ctx.db
      .query("exercises")
      .withIndex("by_palierId", (q) => q.eq("palierId", palierAttempt.palierId))
      .take(50);
    const finalExos: Doc<"exercises">[] = [];
    for (const ex of exosByPalier) {
      if (!variationOriginalIds.has(ex._id)) finalExos.push(ex);
    }
    for (const ex of exosByAttempt) finalExos.push(ex);
    finalExos.sort((a, b) => a.order - b.order);

    if (finalExos.length === 0) {
      throw new Error("Palier vide");
    }

    // Compute per-exo scores from attempts attached to this palierAttempt.
    const exerciseIds: string[] = [];
    const scores: number[] = [];
    for (const ex of finalExos) {
      const attempts = await ctx.db
        .query("attempts")
        .withIndex("by_palierAttempt_exercise", (q) =>
          q
            .eq("palierAttemptId", args.palierAttemptId)
            .eq("exerciseId", ex._id),
        )
        .take(100);
      const realAttempts = attempts.filter((a) => a.attemptNumber > 0);
      const totalHints = attempts.reduce((acc, a) => acc + a.hintsUsedCount, 0);
      const { score } = scoreExerciseFromAttempts(
        realAttempts.map((a) => ({
          attemptNumber: a.attemptNumber,
          isCorrect: a.isCorrect,
          // We bake the *total* hints into the first attempt so
          // `scoreExerciseFromAttempts` accounts for them. Other rows = 0.
          hintsUsedCount: a === realAttempts[0] ? totalHints : 0,
        })),
      );
      exerciseIds.push(ex._id);
      scores.push(score);
    }

    const result = computePalierScore({
      exerciseScores: scores,
      exerciseIds,
    });

    const failedIds = (result.failedExerciseIds ?? []) as Id<"exercises">[];
    const isValidated = result.status === "validated";

    await ctx.db.patch(args.palierAttemptId, {
      status: isValidated ? "validated" : "failed",
      averageScore: result.average,
      failedExerciseIds: failedIds,
      completedAt: Date.now(),
    });

    // D7 — record daily activity for streak (no-op if streaks disabled).
    await ctx.runMutation(internal.streak.recordKidActivity, {
      studentId: profile._id,
    });

    // Cumulative regen check (Decision 60) — UI uses canRegen flag.
    const history = await ctx.db
      .query("palierAttemptHistory")
      .withIndex("by_user_palier", (q) =>
        q.eq("userId", profile._id).eq("palierId", palierAttempt.palierId),
      )
      .unique();
    const cumulativeRegens =
      history && Date.now() - history.lastRegenAt < 7 * 24 * 60 * 60 * 1000
        ? history.regenCount
        : 0;

    return {
      status: isValidated ? "validated" : "failed",
      average: result.average,
      starsTotal: result.starsTotal,
      threshold: PALIER_VALIDATION_THRESHOLD,
      failedCount: failedIds.length,
      canRegen: !isValidated && cumulativeRegens < 3,
      cumulativeRegens,
    };
  },
});

// ===========================================================================
// SYNCHRONISATION DU JOURNAL HORS-LIGNE
//
// Elle vit ICI, et non dans un module à elle, pour une raison concrète :
// `convex/_generated/api.d.ts` est GÉNÉRÉ par `npx convex dev`, et un nouveau
// MODULE n'y apparaît qu'après régénération — impossible sans déploiement. Un
// nouvel EXPORT dans un module existant, lui, est typé immédiatement
// (`palierAttempts: typeof palierAttempts`).
//
// Ce n'est pas qu'un contournement : cette mutation écrit des lignes
// `attempts` d'une tentative de palier, ce que ce module fait déjà.
// ===========================================================================

/**
 * LA SYNCHRONISATION DU JOURNAL HORS-LIGNE — décisions D12, D13, D15, D17, D18.
 *
 * Ce que l'appareil envoie, ce sont les RÉPONSES, jamais les verdicts. Le
 * serveur relit tout avec `verifyAnswer` et n'accorde aucune confiance à ce que
 * l'appareil a montré à l'enfant. C'est ce qui garde la Décision 61 debout :
 * elle est relâchée pour le RETOUR à l'enfant, pas pour la NOTE.
 *
 * CETTE MUTATION N'ÉCRIT QUE DES LIGNES `attempts`, et c'est tout le génie de
 * la forme choisie (D13) : `submitPalier` ne lit aucun état intermédiaire, il
 * recalcule tout depuis ces lignes. Rejouer une séance hors ligne, c'est donc
 * les réécrire — sans toucher au calcul du score, ni à la validation, ni aux
 * badges.
 */

export const syncOfflineJournal = mutation({
  args: {
    palierAttemptId: v.id("palierAttempts"),
    /** Quand le lot a été téléchargé — la borne BASSE des horodatages. */
    bundleDownloadedAt: v.number(),
    entries: v.array(
      v.object({
        /** Clé d'idempotence tirée par l'appareil (D15). */
        clientAttemptId: v.string(),
        exerciseId: v.id("exercises"),
        submittedAnswer: v.string(),
        /** 1..5 pour une vraie réponse, 0 pour un indice (sentinelle `requestHint`). */
        attemptNumber: v.number(),
        hintsUsedCount: v.number(),
        timeSpentMs: v.number(),
        submittedAt: v.number(),
        /**
         * Ce que l'appareil a MONTRÉ à l'enfant. Consultatif : il ne décide de
         * rien, il sert à mesurer les divergences (D20.4).
         */
        localVerdict: v.optional(v.boolean()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Non authentifié");
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId as string))
      .unique();
    if (!profile) throw new Error("Profil introuvable");

    // ---------------------------------------------------------------------
    // AUCUN `requireAccess` ICI, ET C'EST LE PIÈGE QUE D18 DÉSIGNE.
    //
    // Les cinq autres chemins du palier commencent par lui. Le copier ici
    // détruirait le travail de l'enfant : si l'abonnement de l'école expire
    // pendant qu'il joue hors ligne, la synchronisation lèverait et une
    // semaine de réponses partirait en silence — pour une raison qui ne le
    // regarde pas et sur laquelle il ne peut rien.
    //
    // ON ENREGISTRE TOUJOURS, ON OUVRE AU CAS PAR CAS. Ce qui reste fermé est
    // l'OUVERTURE d'un nouveau lot : `getOfflineBundle` refuse quand l'accès
    // l'est, et c'est là que le mur se tient.
    // ---------------------------------------------------------------------

    const attempt = await ctx.db.get(args.palierAttemptId);
    if (!attempt) throw new Error("Tentative introuvable");
    if (attempt.userId !== profile._id) throw new Error("Accès refusé");

    const now = Date.now();
    // Le bornage vit dans `paliers/journal.ts`, pur et testé : c'est lui qui
    // décide de la SÉRIE de l'enfant, et une règle qui décide de cela doit
    // pouvoir être éprouvée sans base de données.
    const lower = lowerBound(args.bundleDownloadedAt, attempt.startedAt, now);

    let inserted = 0;
    let skipped = 0;
    let divergences = 0;

    for (const entry of args.entries) {
      // --- Idempotence (D15) --------------------------------------------
      const already = await ctx.db
        .query("attempts")
        .withIndex("by_clientAttemptId", (q) =>
          q.eq("clientAttemptId", entry.clientAttemptId),
        )
        .first();
      if (already !== null) {
        skipped++;
        continue;
      }

      const exercise = await ctx.db.get(entry.exerciseId);
      if (!exercise) {
        // L'exercice a disparu (régénération, purge d'import). On ne lève
        // pas : le reste du journal vaut mieux que rien.
        skipped++;
        continue;
      }

      // --- LE VERDICT EST RECALCULÉ ICI (D12) ---------------------------
      // Une ligne d'indice (`attemptNumber === 0`) porte `__HINT_<i>` en
      // réponse : elle n'est pas une tentative et ne se vérifie pas.
      const isHint = entry.attemptNumber === 0;
      const isCorrect = isHint
        ? false
        : verifyAnswer(exercise.type, exercise.payload, entry.submittedAnswer);

      if (
        !isHint &&
        entry.localVerdict !== undefined &&
        entry.localVerdict !== isCorrect
      ) {
        divergences++;
        // ON CONSIGNE, ON NE PUNIT PAS (D20.4). Un écart signale un
        // trafiquage OU un défaut de canonicalisation — et le second est
        // infiniment plus probable. Un enfant ne doit jamais payer pour un
        // bug ; c'est nous que ce compteur doit alerter.
        console.warn(
          JSON.stringify({
            event: "offline_verdict_divergence",
            palierAttemptId: args.palierAttemptId,
            exerciseId: entry.exerciseId,
            type: exercise.type,
            deviceSaid: entry.localVerdict,
            serverSays: isCorrect,
          }),
        );
      }

      // --- Bornage d'horloge (D17) --------------------------------------
      // On GARDE la date déclarée quand elle tombe dans la fenêtre plausible,
      // et on la ramène sinon. Un enfant qui joue vraiment lundi sans réseau
      // et synchronise vendredi garde son lundi — donc sa série. Une horloge
      // avancée d'un mois est ramenée à maintenant.
      const submittedAt = clampSubmittedAt(entry.submittedAt, lower, now);
      const timeSpentMs = clampTimeSpent(entry.timeSpentMs);

      const attemptId = await ctx.db.insert("attempts", {
        studentId: profile._id,
        exerciseId: entry.exerciseId,
        submittedAnswer: entry.submittedAnswer,
        isCorrect,
        attemptNumber: clampCount(entry.attemptNumber),
        hintsUsedCount: clampCount(entry.hintsUsedCount),
        timeSpentMs,
        submittedAt,
        palierAttemptId: args.palierAttemptId,
        clientAttemptId: entry.clientAttemptId,
      });
      inserted++;

      // --- LE RATTRAPAGE DE LA RÉPONSE COURTE (D16) ---------------------
      //
      // Hors ligne, `verifyShortAnswer` est LITTÉRAL : l'enfant qui écrit
      // « la ville de Dakar » quand on attend « Dakar » est compté faux. En
      // ligne, le lecteur web rattrape en faisant relire la réponse par l'IA ;
      // hors ligne, personne ne pouvait le faire. C'est ici que ça se rattrape.
      //
      // VERS LE HAUT SEULEMENT. `verifyShortAnswerWithAI` ne bascule que
      // `false` → `true` : il ne reprend jamais une bonne réponse. Une coche
      // verte montrée à un enfant ne se retire pas.
      //
      // ON PLANIFIE, ON N'ATTEND PAS. Une mutation est une transaction : y
      // attendre un appel réseau vers OpenAI la tiendrait ouverte pendant des
      // secondes. Le `scheduler` la referme et laisse l'action travailler à
      // côté ; si le plafond de dépense IA la refuse, le verdict littéral
      // reste — c'est le repli documenté d'`attemptsVerify`.
      if (!isHint && !isCorrect && exercise.type === "short-answer") {
        await ctx.scheduler.runAfter(
          0,
          api.attemptsVerify.verifyShortAnswerWithAI,
          { attemptId },
        );
      }
    }

    return { inserted, skipped, divergences };
  },
});

// ===========================================================================
// QUERIES
// ===========================================================================

export const getMyAttempt = query({
  args: { palierAttemptId: v.id("palierAttempts") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId as string))
      .unique();
    if (!profile) return null;

    // Paywall (spec §5.4) — une requête ne lève jamais : elle retourne la
    // même valeur vide que pour un profil invalide.
    const access = await checkAccess(ctx, profile);
    if (!access.ok) return null;

    const attempt = await ctx.db.get(args.palierAttemptId);
    if (!attempt || attempt.userId !== profile._id) return null;
    return attempt;
  },
});

export const getProgressForPalierAttempt = query({
  args: { palierAttemptId: v.id("palierAttempts") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId as string))
      .unique();
    if (!profile) return null;

    // Paywall (spec §5.4) — une requête ne lève jamais : elle retourne la
    // même valeur vide que pour un profil invalide.
    const access = await checkAccess(ctx, profile);
    if (!access.ok) return null;

    const palierAttempt = await ctx.db.get(args.palierAttemptId);
    if (!palierAttempt) return null;
    if (palierAttempt.userId !== profile._id) return null;

    const finalExos = await loadFinalExercisesForAttempt(ctx, palierAttempt);
    if (finalExos.length === 0) {
      return {
        currentIndex: 0,
        completedCount: 0,
        totalCount: 0,
        failedAttemptsThisExo: 0,
        hintsUsedThisExo: 0,
      };
    }

    let currentIndex = finalExos.length - 1;
    let completedCount = 0;
    const attemptsByExercise = new Map<string, Doc<"attempts">[]>();

    for (let i = 0; i < finalExos.length; i++) {
      const ex = finalExos[i];
      const rows = await ctx.db
        .query("attempts")
        .withIndex("by_palierAttempt_exercise", (q) =>
          q.eq("palierAttemptId", args.palierAttemptId).eq("exerciseId", ex._id),
        )
        .take(100);
      attemptsByExercise.set(String(ex._id), rows);

      const realAttempts = rows.filter((a) => a.attemptNumber > 0);
      const isCompleted =
        realAttempts.some((a) => a.isCorrect) || realAttempts.length >= 5;
      if (isCompleted) {
        completedCount += 1;
        continue;
      }
      currentIndex = i;
      break;
    }

    const currentExercise = finalExos[currentIndex];
    const currentRows = attemptsByExercise.get(String(currentExercise._id)) ?? [];
    const currentRealAttempts = currentRows.filter((a) => a.attemptNumber > 0);

    return {
      currentIndex,
      completedCount,
      totalCount: finalExos.length,
      failedAttemptsThisExo: currentRealAttempts.filter((a) => !a.isCorrect)
        .length,
      hintsUsedThisExo: currentRows.reduce(
        (acc, a) => acc + a.hintsUsedCount,
        0,
      ),
    };
  },
});

export const listMyAttempts = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId as string))
      .unique();
    if (!profile) return [];

    // Paywall (spec §5.4) — une requête ne lève jamais : elle retourne la
    // même valeur vide que pour un profil invalide.
    const access = await checkAccess(ctx, profile);
    if (!access.ok) return [];

    const limit = args.limit ?? 20;
    return await ctx.db
      .query("palierAttempts")
      .withIndex("by_user", (q) => q.eq("userId", profile._id))
      .order("desc")
      .take(limit);
  },
});

// Helper used in tests
export { verifyByType };

function verifyByType(exercise: Doc<"exercises">, submitted: string): boolean {
  return verifyAnswer(exercise.type, exercise.payload, submitted);
}

// Re-export for tests / settings-driven shuffle preview
export { shuffleDeterministic };
