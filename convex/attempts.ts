import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import {
  checkAccess,
  requireAccess,
  blockedStudent,
  studentIdsTaughtBy,
} from "./access";
import { verifyAnswer } from "./answerRules";

/**
 * Compute where the current student should resume in a given topic session.
 * Returns the 0-based index of the first published exercise (ordered by
 * `order`) for which the student does NOT yet have a correct attempt.
 *
 * null → no student profile found, topic has no exercises, or the topic
 *         is already fully completed.
 */
export const getResumeIndex = query({
  args: { topicId: v.id("topics") },
  handler: async (ctx, { topicId }) => {
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

    const exercises = await ctx.db
      .query("exercises")
      .withIndex("by_topicId", (q) => q.eq("topicId", topicId))
      .take(50);
    const published = exercises
      .filter((e) => e.status === "published")
      .sort((a, b) => a.order - b.order);
    if (published.length === 0) return null;

    // Only need to know which exercises have a correct attempt — collect IDs of
    // published exercises, then query per-exercise via compound index.
    const correctByExercise = new Set<string>();
    for (const ex of published) {
      const att = await ctx.db
        .query("attempts")
        .withIndex("by_studentId_exerciseId", (q) =>
          q.eq("studentId", profile._id).eq("exerciseId", ex._id),
        )
        .take(100);
      for (const a of att) {
        if (a.isCorrect) {
          correctByExercise.add(String(a.exerciseId));
          break;
        }
      }
    }

    const firstIncomplete = published.findIndex(
      (ex) => !correctByExercise.has(String(ex._id)),
    );
    return firstIncomplete === -1 ? null : firstIncomplete;
  },
});

/**
 * Le contexte d'une tentative pour la vérification IA
 * (`convex/attemptsVerify.ts`) : la réponse soumise, l'énoncé et les réponses
 * acceptées, de quoi comparer sémantiquement.
 *
 * `studentId` N'EST PAS DÉCORATIF — C'EST LA PREUVE DE PROPRIÉTÉ, et elle est
 * exigée ICI plutôt que chez l'appelant (§D16). L'action qui appelle ne connaît
 * qu'un `attemptId` reçu du client ; si le contrôle vivait là-haut, le prochain
 * appelant pourrait l'oublier, et rien ne le lui rappellerait. En le posant
 * dans la requête, une tentative qui n'appartient pas à `studentId` est
 * INTROUVABLE — indistinguable d'une tentative inexistante, donc sans oracle.
 *
 * Ce refus arrive AVANT l'appel IA de l'action, ce qui ferme aussi la dépense :
 * lire les erreurs d'un pair coûtait des jetons facturés à l'appelant.
 */
export const getAttemptContextForVerification = internalQuery({
  args: {
    attemptId: v.id("attempts"),
    studentId: v.id("profiles"),
  },
  handler: async (ctx, { attemptId, studentId }) => {
    const attempt = await ctx.db.get(attemptId);
    if (!attempt) return null;
    if (attempt.studentId !== studentId) return null;
    const exercise = await ctx.db.get(attempt.exerciseId);
    if (!exercise) return null;
    return {
      submittedAnswer: attempt.submittedAnswer,
      exercise: {
        prompt: exercise.prompt,
        type: exercise.type,
        acceptedAnswers:
          (exercise.payload?.acceptedAnswers as string[] | undefined) ?? [],
      },
    };
  },
});

/**
 * Internal query used by the AI explanation action (convex/attemptsExplain.ts).
 * Returns the exercise + the student's attempt history so the AI can craft
 * a personalised explanation referencing what the child got wrong.
 */
export const getExerciseAndAttempts = internalQuery({
  args: {
    exerciseId: v.id("exercises"),
    studentId: v.id("profiles"),
  },
  handler: async (ctx, { exerciseId, studentId }) => {
    const exercise = await ctx.db.get(exerciseId);
    if (!exercise) return null;

    const attempts = await ctx.db
      .query("attempts")
      .withIndex("by_studentId_exerciseId", (q) =>
        q.eq("studentId", studentId).eq("exerciseId", exerciseId),
      )
      .take(100);

    return {
      exercise: {
        prompt: exercise.prompt,
        type: exercise.type,
        answerKey: exercise.answerKey,
        hints: exercise.hints,
      },
      attempts: attempts
        .sort((a, b) => a.attemptNumber - b.attemptNumber)
        .map((a) => ({
          submittedAnswer: a.submittedAnswer,
          isCorrect: a.isCorrect,
        })),
    };
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const submit = mutation({
  args: {
    exerciseId: v.id("exercises"),
    submittedAnswer: v.string(),
    attemptNumber: v.number(),
    hintsUsedCount: v.number(),
    timeSpentMs: v.number(),
  },
  handler: async (ctx, args) => {
    // L'ÉLÈVE EST L'APPELANT, ET IL N'EST PLUS UN ARGUMENT.
    //
    // Cette mutation contrôlait le droit d'accès de l'appelant puis écrivait
    // quatre fois sous `args.studentId` : la tentative, la progression du
    // sujet, sa création, et la planification des badges. N'importe quel
    // compte authentifié couvert par un abonnement pouvait donc fabriquer des
    // tentatives et faire décerner des badges AU NOM D'UN AUTRE — le garde
    // regardait une personne, les écritures en désignaient une autre. Un droit
    // vérifié sur l'appelant n'autorise que ce que l'appelant fait pour
    // lui-même ; dès qu'une écriture nomme quelqu'un d'autre, il faut soit une
    // autorisation sur CETTE personne, soit cesser de la nommer. On cesse : le
    // profil vient de la session et l'argument disparaît, ce qui rend
    // l'usurpation INEXPRIMABLE plutôt que refusée.
    //
    // Paywall (spec §5.4) — une mutation lève, l'appelant attrape. C'EST LUI
    // QUI ÉCARTE LES NON-ÉLÈVES, et non la garde de rôle plus bas :
    // `decideAccess` répond `not_student` dès que le rôle n'est pas `student`
    // (`accessRules.ts`), ce que `loadAccessInput` lui garantit en ne
    // remplissant que `role` pour les autres. Un professeur qui essaie un
    // exercice ne produisait donc déjà aucune trace avant ce correctif — ce
    // que la garde ci-dessous ne change pas.
    const callerUserId = await getAuthUserId(ctx);
    if (!callerUserId) throw new Error("Non authentifié");
    const callerProfile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", callerUserId as string))
      .unique();
    if (!callerProfile) throw new Error("Profil introuvable");
    await requireAccess(ctx, callerProfile);

    // CEINTURE ET BRETELLES, ET APRÈS LE PAYWALL À DESSEIN. Cette garde est
    // redondante aujourd'hui ; elle ne mord que si `decideAccess` cessait un
    // jour de refuser les non-élèves. La placer AVANT `requireAccess`
    // remplacerait le `ConvexError({ code: "ACCESS_DENIED" })` — que le client
    // sait rendre (`lib/accessCopy.ts`) — par une `Error` nue qu'il ne sait
    // pas lire : une garde morte ne doit pas dégrader le refus vivant.
    // `attempts` et `studentTopicProgress` alimentent bulletins et badges, et
    // rien en aval ne saurait écarter une ligne portant un profil d'adulte.
    if (callerProfile.role !== "student") {
      throw new Error("Profil élève introuvable");
    }
    const studentId = callerProfile._id;

    const exercise = await ctx.db.get(args.exerciseId);
    if (!exercise) {
      throw new Error("Exercice introuvable");
    }

    // UNE SEULE SÉMANTIQUE DE CORRECTION, celle d'`answerRules.ts`. Ce fichier
    // portait sa propre copie des cinq vérificateurs, identique à celle de
    // `palierAttempts.ts` : deux mutations publiques corrigeaient le même
    // exercice avec deux codes distincts que rien n'obligeait à rester égaux.
    // Un type hors de l'union du schéma rend désormais `false` au lieu de
    // lever ; le validateur d'`exercises.type` rend ce cas inatteignable.
    const isCorrect = verifyAnswer(
      exercise.type,
      exercise.payload,
      args.submittedAnswer,
    );

    // Create the attempt record
    const attemptId = await ctx.db.insert("attempts", {
      studentId,
      exerciseId: args.exerciseId,
      submittedAnswer: args.submittedAnswer,
      isCorrect,
      attemptNumber: args.attemptNumber,
      hintsUsedCount: args.hintsUsedCount,
      timeSpentMs: args.timeSpentMs,
      submittedAt: Date.now(),
    });

    // For short-answer, if literal check failed, the frontend can call
    // `verifyShortAnswerWithAI` to get a semantic second opinion from the AI.
    const needsAiVerification =
      !isCorrect && exercise.type === "short-answer";

    // If correct, update studentTopicProgress
    if (isCorrect) {
      const progress = await ctx.db
        .query("studentTopicProgress")
        .withIndex("by_studentId_topicId", (q) =>
          q.eq("studentId", studentId).eq("topicId", exercise.topicId),
        )
        .first();

      if (progress) {
        await ctx.db.patch(progress._id, {
          completedExercises: progress.completedExercises + 1,
          correctExercises: progress.correctExercises + 1,
          totalHintsUsed: progress.totalHintsUsed + args.hintsUsedCount,
        });
      } else {
        await ctx.db.insert("studentTopicProgress", {
          studentId,
          topicId: exercise.topicId,
          completedExercises: 1,
          correctExercises: 1,
          totalHintsUsed: args.hintsUsedCount,
          masteryLevel: 0,
        });
      }

      // Check and award badges in real-time
      await ctx.scheduler.runAfter(0, internal.badges.checkAndAward, {
        studentId,
      });
    }

    // Build the correct answer to return only when max attempts reached
    let correctAnswer: string | undefined;
    if (!isCorrect && args.attemptNumber >= 5) {
      switch (exercise.type) {
        case "qcm":
          correctAnswer = String(exercise.payload.correctIndex);
          break;
        case "match":
          correctAnswer = JSON.stringify(exercise.payload.pairs);
          break;
        case "order":
          correctAnswer = JSON.stringify(exercise.payload.correctSequence);
          break;
        case "drag-drop": {
          const mapping: Record<string, string> = {};
          for (const item of exercise.payload.items) {
            mapping[item.text] = item.correctZone;
          }
          correctAnswer = JSON.stringify(mapping);
          break;
        }
        case "short-answer":
          correctAnswer = exercise.payload.acceptedAnswers[0];
          break;
      }
    }

    return { isCorrect, correctAnswer, needsAiVerification, attemptId };
  },
});

/**
 * Internal mutation: called by the Node action that re-verifies a short-answer
 * attempt with OpenAI. Flips the attempt's `isCorrect` flag to true and
 * increments the student's topic progress counters.
 */
export const markAttemptCorrectByAI = internalMutation({
  args: {
    attemptId: v.id("attempts"),
    studentId: v.id("profiles"),
  },
  handler: async (ctx, { attemptId, studentId }) => {
    // MÊME PREUVE DE PROPRIÉTÉ QUE LA REQUÊTE DE CONTEXTE, et redondante avec
    // elle aujourd'hui puisque l'action ne peut plus atteindre cette ligne pour
    // une tentative étrangère. Elle reste parce que c'est ICI qu'on ÉCRIT : un
    // `patch` sur la tentative d'un élève et sur sa progression ne doit pas
    // dépendre de la vigilance d'un appelant qui n'existe pas encore. Une
    // mutation interne n'est protégée que de l'extérieur, pas de ses pairs.
    const attempt = await ctx.db.get(attemptId);
    if (!attempt) throw new Error("Tentative introuvable");
    if (attempt.studentId !== studentId) {
      throw new Error("Tentative introuvable");
    }
    if (attempt.isCorrect) return; // already correct, nothing to do

    await ctx.db.patch(attemptId, { isCorrect: true });

    const exercise = await ctx.db.get(attempt.exerciseId);
    if (!exercise) return;

    const progress = await ctx.db
      .query("studentTopicProgress")
      .withIndex("by_studentId_topicId", (q) =>
        q.eq("studentId", attempt.studentId).eq("topicId", exercise.topicId),
      )
      .first();

    if (progress) {
      await ctx.db.patch(progress._id, {
        completedExercises: progress.completedExercises + 1,
        correctExercises: progress.correctExercises + 1,
        totalHintsUsed: progress.totalHintsUsed + attempt.hintsUsedCount,
      });
    } else {
      await ctx.db.insert("studentTopicProgress", {
        studentId: attempt.studentId,
        topicId: exercise.topicId,
        completedExercises: 1,
        correctExercises: 1,
        totalHintsUsed: attempt.hintsUsedCount,
        masteryLevel: 0,
      });
    }
  },
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Tentatives d'un élève sur un exercice — INTERNE, aucun appelant.
 *
 * Cette lecture quitte la surface publique : elle rendait les tentatives de
 * n'importe quel `Id<"profiles">` — réponses soumises comprises — sans
 * vérifier l'appelant. Le paywall ci-dessous contrôle le droit d'accès de
 * l'appelant, jamais son droit sur CET élève-là.
 *
 * Pour la rouvrir au public, il manque exactement cela : une vérification du
 * lien entre l'appelant et l'élève visé, en plus du paywall. Le corps est
 * inchangé.
 */
export const getAttemptsForExercise = internalQuery({
  args: {
    studentId: v.id("profiles"),
    exerciseId: v.id("exercises"),
  },
  handler: async (ctx, args) => {
    // Paywall (spec §5.4) — cette requête ne résout aucun profil (elle
    // prend `studentId` en argument), donc pas de "juste après la
    // résolution du profil" applicable ici. blockedStudent(ctx) résout le
    // profil de L'APPELANT et ne bloque que s'il s'agit d'un élève sans
    // droit valide — jamais un adulte, jamais un visiteur non authentifié.
    // Une requête ne lève jamais : même valeur vide que le .take(100)
    // ci-dessous retournerait pour un résultat sans lignes.
    if (await blockedStudent(ctx)) return [];

    return await ctx.db
      .query("attempts")
      .withIndex("by_studentId_exerciseId", (q) =>
        q.eq("studentId", args.studentId).eq("exerciseId", args.exerciseId),
      )
      .take(100);
  },
});

/**
 * Tentatives récentes des élèves du professeur de la SESSION.
 *
 * Alimente l'activité récente du tableau de bord enseignant. Élèves résolus
 * par ses classes (`access.studentIdsTaughtBy`) et non plus par un lien
 * `studentGuardians` de relation "professeur", que rien ne crée. Garde de
 * rôle, `limit` et forme de retour inchangés.
 */
export const listByTeacherStudents = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (!profile) return [];
    if (profile.role !== "professeur" && profile.role !== "admin") return [];

    const studentIds = await studentIdsTaughtBy(ctx, profile._id);

    if (studentIds.length === 0) return [];

    const limit = args.limit ?? 20;

    const allAttempts: Array<{
      _id: string;
      _creationTime: number;
      studentId: string;
      exerciseId: string;
      submittedAnswer: string;
      isCorrect: boolean;
      attemptNumber: number;
      hintsUsedCount: number;
      timeSpentMs: number;
      submittedAt: number;
      studentName: string;
      exercisePrompt: string;
      exerciseType: string;
      topicName: string;
    }> = [];

    for (const studentId of studentIds) {
      // Only fetch recent attempts per student (desc order, take enough for the final limit)
      const attempts = await ctx.db
        .query("attempts")
        .withIndex("by_studentId", (q) => q.eq("studentId", studentId))
        .order("desc")
        .take(limit);

      const student = await ctx.db.get(studentId);

      for (const attempt of attempts) {
        const exercise = await ctx.db.get(attempt.exerciseId);
        let topicName = "";
        if (exercise) {
          const topic = await ctx.db.get(exercise.topicId);
          topicName = topic?.name ?? "";
        }
        allAttempts.push({
          ...attempt,
          studentName: student?.name ?? "",
          exercisePrompt: exercise?.prompt ?? "",
          exerciseType: exercise?.type ?? "",
          topicName,
        });
      }
    }

    allAttempts.sort((a, b) => b.submittedAt - a.submittedAt);

    return allAttempts.slice(0, limit);
  },
});

/**
 * Progression d'un élève sur un chapitre — INTERNE, aucun appelant.
 *
 * Même raison que `getAttemptsForExercise` ci-dessus : elle rendait la ligne
 * de progression de n'importe quel `Id<"profiles">` sans vérifier l'appelant,
 * et le paywall ne dit rien du droit de l'appelant sur cet élève. Une version
 * publique devrait vérifier ce lien en plus du paywall. Le corps est inchangé.
 */
export const getProgressForTopic = internalQuery({
  args: {
    studentId: v.id("profiles"),
    topicId: v.id("topics"),
  },
  handler: async (ctx, args) => {
    // Paywall (spec §5.4) — même raisonnement que getAttemptsForExercise
    // ci-dessus : pas de profil résolu ici, donc blockedStudent(ctx) sur
    // l'appelant. Valeur vide alignée sur le .first() ci-dessous : null.
    if (await blockedStudent(ctx)) return null;

    return await ctx.db
      .query("studentTopicProgress")
      .withIndex("by_studentId_topicId", (q) =>
        q.eq("studentId", args.studentId).eq("topicId", args.topicId),
      )
      .first();
  },
});
