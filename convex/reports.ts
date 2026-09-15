import {
  query,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { callerMayReadStudent, studentIdsTaughtBy } from "./access";

// ---------------------------------------------------------------------------
// Public Queries
// ---------------------------------------------------------------------------

/**
 * Bilans d'un élève, joints aux noms de thématique et de matière.
 *
 * Garde de LIEN — elle n'en avait AUCUN : ni authentification, ni rôle, ni
 * rapport avec l'élève. Elle rendait les bilans rédigés sur un enfant (score,
 * forces, faiblesses, erreurs fréquentes) à quiconque détenait son
 * identifiant, sans même de compte.
 *
 * `callerMayReadStudent` accepte le lien `studentGuardians` quelle que soit sa
 * relation, et c'est ce dont dépendent les quatre écrans parents appelants
 * (`app/(parent)/parent/dashboard`, `/children`, `/children/[id]/progress`,
 * `/children/[id]/reports/[topicId]`) : `profiles.getChildren` leur donne des
 * enfants liés en "parent" ou "tuteur", jamais en "professeur".
 *
 * Les deux écrans professeur appelants (`app/(teacher)/teacher/students/[id]`
 * et `/teacher/reports/[studentId]/[topicId]`) passent par le même lien. La
 * vérification côté client de la page de détail reste en place : elle
 * redirige proprement, elle ne protège rien — le verrou est ici.
 *
 * Une requête ne lève jamais : [] pour tout autre appelant.
 */
export const listByStudent = query({
  args: { studentId: v.id("profiles") },
  handler: async (ctx, args) => {
    if (!(await callerMayReadStudent(ctx, args.studentId))) return [];

    const reports = await ctx.db
      .query("topicReports")
      .withIndex("by_studentId_topicId", (q) =>
        q.eq("studentId", args.studentId),
      )
      .take(200);

    const enriched = await Promise.all(
      reports.map(async (report) => {
        const topic = await ctx.db.get(report.topicId);
        const subject = topic ? await ctx.db.get(topic.subjectId) : null;
        return {
          ...report,
          topicName: topic?.name ?? "Thématique inconnue",
          subjectName: subject?.name ?? "Matière inconnue",
        };
      }),
    );

    return enriched;
  },
});

/**
 * Bilans de tous les élèves du professeur de la SESSION.
 *
 * Élèves résolus par ses classes (`access.studentIdsTaughtBy`) et non plus par
 * un lien `studentGuardians` de relation "professeur", que rien ne crée. Garde
 * de rôle, tri et forme de retour inchangés : `app/(teacher)/teacher/reports`
 * et le tableau de bord reçoivent exactement les mêmes champs.
 */
export const listByTeacher = query({
  args: {},
  handler: async (ctx) => {
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

    const allReports = [];
    for (const studentId of studentIds) {
      const student = await ctx.db.get(studentId);
      const reports = await ctx.db
        .query("topicReports")
        .withIndex("by_studentId_topicId", (q) =>
          q.eq("studentId", studentId),
        )
        .take(200);

      for (const report of reports) {
        const topic = await ctx.db.get(report.topicId);
        const subject = topic ? await ctx.db.get(topic.subjectId) : null;
        allReports.push({
          ...report,
          studentName: student?.name ?? "Élève inconnu",
          topicName: topic?.name ?? "Thématique inconnue",
          subjectName: subject?.name ?? "Matière inconnue",
        });
      }
    }

    return allReports.sort((a, b) => b._creationTime - a._creationTime);
  },
});

/**
 * List topic reports for all children linked to the current parent/tuteur
 * via studentGuardians (relation "parent" or "tuteur").
 */
export const listByParent = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (!profile) return [];
    if (profile.role !== "parent" && profile.role !== "admin") return [];

    const links = await ctx.db
      .query("studentGuardians")
      .withIndex("by_guardianId", (q) => q.eq("guardianId", profile._id))
      .take(200);

    const studentIds = links
      .filter((l) => l.relation === "parent" || l.relation === "tuteur")
      .map((l) => l.studentId);

    if (studentIds.length === 0) return [];

    const allReports = [];
    for (const studentId of studentIds) {
      const student = await ctx.db.get(studentId);
      const reports = await ctx.db
        .query("topicReports")
        .withIndex("by_studentId_topicId", (q) =>
          q.eq("studentId", studentId),
        )
        .take(200);

      for (const report of reports) {
        const topic = await ctx.db.get(report.topicId);
        const subject = topic ? await ctx.db.get(topic.subjectId) : null;
        allReports.push({
          ...report,
          studentName: student?.name ?? "Enfant inconnu",
          topicName: topic?.name ?? "Thématique inconnue",
          subjectName: subject?.name ?? "Matière inconnue",
        });
      }
    }

    return allReports.sort((a, b) => b._creationTime - a._creationTime);
  },
});

/** Get a single report with full details (topic name, subject name). */
export const getById = query({
  args: { id: v.id("topicReports") },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.id);
    if (!report) return null;

    const topic = await ctx.db.get(report.topicId);
    const subject = topic ? await ctx.db.get(topic.subjectId) : null;

    return {
      ...report,
      topicName: topic?.name ?? "Thématique inconnue",
      subjectName: subject?.name ?? "Matière inconnue",
    };
  },
});

// ---------------------------------------------------------------------------
// Internal Queries (used by sendEmail action in reportsEmail.ts)
// ---------------------------------------------------------------------------

/** Internal: get a single report with topic & subject names. */
export const internalGetById = internalQuery({
  args: { id: v.id("topicReports") },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.id);
    if (!report) return null;

    const topic = await ctx.db.get(report.topicId);
    const subject = topic ? await ctx.db.get(topic.subjectId) : null;

    return {
      ...report,
      topicName: topic?.name ?? "Thématique inconnue",
      subjectName: subject?.name ?? "Matière inconnue",
    };
  },
});

/** Internal: get a student profile by document id. */
export const getStudentProfile = internalQuery({
  args: { id: v.id("profiles") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/** Internal: get all guardian profiles + emails for a student. */
export const getGuardians = internalQuery({
  args: { studentId: v.id("profiles") },
  handler: async (ctx, args) => {
    const links = await ctx.db
      .query("studentGuardians")
      .withIndex("by_studentId", (q) => q.eq("studentId", args.studentId))
      .take(50);

    const guardians = await Promise.all(
      links.map(async (link) => {
        const profile = await ctx.db.get(link.guardianId);
        if (!profile) return null;

        // profile.userId is the _id of the users table — use ctx.db.get directly
        const user = await ctx.db.get(profile.userId as Id<"users">);

        return {
          ...profile,
          email: ((user as { email?: string } | null)?.email) ?? null,
        };
      }),
    );

    return guardians.filter(
      (g): g is NonNullable<typeof g> => g !== null,
    );
  },
});

// ---------------------------------------------------------------------------
// Internal Mutations
// ---------------------------------------------------------------------------

/**
 * Generate a topic report for a student + topic.
 * Analyses all attempts for exercises in the topic, computes score,
 * strengths, weaknesses, frequent mistakes, then schedules the email.
 */
export const generate = internalMutation({
  args: {
    studentId: v.id("profiles"),
    topicId: v.id("topics"),
  },
  handler: async (ctx, args) => {
    // Fetch all exercises for this topic
    const exercises = await ctx.db
      .query("exercises")
      .withIndex("by_topicId", (q) => q.eq("topicId", args.topicId))
      .take(50);

    if (exercises.length === 0) {
      throw new Error("Aucun exercice trouvé pour cette thématique");
    }

    let totalAttempts = 0;
    let correctAttempts = 0;
    const typeScores: Record<string, { correct: number; total: number }> = {};
    const frequentMistakes: string[] = [];

    for (const exercise of exercises) {
      const attempts = await ctx.db
        .query("attempts")
        .withIndex("by_studentId_exerciseId", (q) =>
          q.eq("studentId", args.studentId).eq("exerciseId", exercise._id),
        )
        .take(100);

      if (attempts.length === 0) continue;

      const exerciseCorrect = attempts.filter((a) => a.isCorrect).length;
      totalAttempts += attempts.length;
      correctAttempts += exerciseCorrect;

      // Aggregate by exercise type
      if (!typeScores[exercise.type]) {
        typeScores[exercise.type] = { correct: 0, total: 0 };
      }
      typeScores[exercise.type].correct += exerciseCorrect;
      typeScores[exercise.type].total += attempts.length;

      // Frequent mistakes: exercises attempted 3+ times with majority failures
      if (attempts.length >= 3 && exerciseCorrect / attempts.length < 0.5) {
        frequentMistakes.push(exercise.prompt);
      }
    }

    // Calculate score
    const score = totalAttempts > 0 ? correctAttempts / totalAttempts : 0;

    // Identify strengths (exercise types with >80% success)
    const strengths: string[] = [];
    for (const [type, stats] of Object.entries(typeScores)) {
      if (stats.total > 0 && stats.correct / stats.total > 0.8) {
        strengths.push(formatExerciseType(type));
      }
    }

    // Identify weaknesses (exercise types with <50% success)
    const weaknesses: string[] = [];
    for (const [type, stats] of Object.entries(typeScores)) {
      if (stats.total > 0 && stats.correct / stats.total < 0.5) {
        weaknesses.push(formatExerciseType(type));
      }
    }

    // Create the report record
    const reportId = await ctx.db.insert("topicReports", {
      studentId: args.studentId,
      topicId: args.topicId,
      score,
      strengths,
      weaknesses,
      frequentMistakes,
    });

    // Schedule the email immediately (sendEmail is in reportsEmail.ts)
    await ctx.scheduler.runAfter(0, internal.reportsEmail.sendEmail, {
      reportId,
    });

    return reportId;
  },
});

/** Mark a report as email-sent with a timestamp. */
export const markEmailSent = internalMutation({
  args: { reportId: v.id("topicReports") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.reportId, { emailSentAt: Date.now() });
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatExerciseType(type: string): string {
  const labels: Record<string, string> = {
    qcm: "Questions à choix multiples",
    "drag-drop": "Glisser-déposer",
    match: "Association",
    order: "Remise en ordre",
    "short-answer": "Réponse courte",
  };
  return labels[type] ?? type;
}
