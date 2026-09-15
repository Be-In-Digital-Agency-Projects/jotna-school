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
 * Internal query used by the AI verification action (convex/attemptsVerify.ts).
 * Returns the submitted answer + the exercise's prompt and accepted answers
 * so the AI can compare them semantically.
 */
export const getAttemptContextForVerification = internalQuery({
  args: { attemptId: v.id("attempts") },
  handler: async (ctx, { attemptId }) => {
    const attempt = await ctx.db.get(attemptId);
    if (!attempt) return null;
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
// Answer verification helpers
// ---------------------------------------------------------------------------

function verifyQcm(submittedAnswer: string, payload: { correctIndex: number }): boolean {
  return parseInt(submittedAnswer, 10) === payload.correctIndex;
}

function verifyMatch(
  submittedAnswer: string,
  payload: { pairs: { left: string; right: string }[] },
): boolean {
  try {
    const submitted: { left: string; right: string }[] = JSON.parse(submittedAnswer);
    if (submitted.length !== payload.pairs.length) return false;

    const correctSet = new Set(
      payload.pairs.map((p) => `${p.left}|||${p.right}`),
    );
    for (const pair of submitted) {
      if (!correctSet.has(`${pair.left}|||${pair.right}`)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function verifyOrder(
  submittedAnswer: string,
  payload: { correctSequence: string[] },
): boolean {
  try {
    const submitted: string[] = JSON.parse(submittedAnswer);
    if (submitted.length !== payload.correctSequence.length) return false;
    return submitted.every((item, i) => item === payload.correctSequence[i]);
  } catch {
    return false;
  }
}

function verifyDragDrop(
  submittedAnswer: string,
  payload: { items: { text: string; correctZone: string }[] },
): boolean {
  try {
    const submitted: Record<string, string> = JSON.parse(submittedAnswer);
    for (const item of payload.items) {
      if (submitted[item.text] !== item.correctZone) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function verifyShortAnswer(
  submittedAnswer: string,
  payload: { acceptedAnswers: string[] },
): boolean {
  const normalized = submittedAnswer.toLowerCase().trim();
  return payload.acceptedAnswers.some(
    (answer) => answer.toLowerCase().trim() === normalized,
  );
}

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
    // ET IL DOIT ÊTRE UN ÉLÈVE, comme `badges.markBadgesSeen` l'exige déjà.
    // `attempts` et `studentTopicProgress` sont des tables de parcours
    // pédagogique, lues par les bulletins et les badges ; une ligne portant un
    // profil de parent ou de professeur n'y a pas de sens, et rien en aval ne
    // sait l'écarter. Un professeur qui essaie un exercice ne produit donc
    // aucune trace, ce qui est le comportement voulu.
    //
    // Paywall (spec §5.4) — une mutation lève, l'appelant attrape.
    const callerUserId = await getAuthUserId(ctx);
    if (!callerUserId) throw new Error("Non authentifié");
    const callerProfile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", callerUserId as string))
      .unique();
    if (!callerProfile || callerProfile.role !== "student") {
      throw new Error("Profil élève introuvable");
    }
    await requireAccess(ctx, callerProfile);
    const studentId = callerProfile._id;

    const exercise = await ctx.db.get(args.exerciseId);
    if (!exercise) {
      throw new Error("Exercice introuvable");
    }

    // Verify the answer based on exercise type
    let isCorrect = false;
    switch (exercise.type) {
      case "qcm":
        isCorrect = verifyQcm(args.submittedAnswer, exercise.payload);
        break;
      case "match":
        isCorrect = verifyMatch(args.submittedAnswer, exercise.payload);
        break;
      case "order":
        isCorrect = verifyOrder(args.submittedAnswer, exercise.payload);
        break;
      case "drag-drop":
        isCorrect = verifyDragDrop(args.submittedAnswer, exercise.payload);
        break;
      case "short-answer":
        isCorrect = verifyShortAnswer(args.submittedAnswer, exercise.payload);
        break;
      default:
        throw new Error(`Type d'exercice non supporté: ${exercise.type}`);
    }

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
  },
  handler: async (ctx, { attemptId }) => {
    const attempt = await ctx.db.get(attemptId);
    if (!attempt) throw new Error("Tentative introuvable");
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
