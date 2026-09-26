import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

import { mutation } from "./_generated/server";
import { verifyAnswer } from "./paliers/answers";
import {
  clampCount,
  clampSubmittedAt,
  clampTimeSpent,
  lowerBound,
} from "./paliers/journal";

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

      await ctx.db.insert("attempts", {
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
    }

    return { inserted, skipped, divergences };
  },
});
