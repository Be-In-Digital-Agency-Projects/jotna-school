import { internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { blockedStudent } from "./access";
import { isHiddenClass } from "./curriculum";

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Progression par chapitre d'un élève nommé en argument — INTERNE, aucun
 * appelant.
 *
 * Cette lecture quitte la surface publique : elle rendait la progression de
 * n'importe quel `Id<"profiles">` sans vérifier l'appelant. Le paywall
 * ci-dessous contrôle bien quelque chose, mais autre chose : il juge le droit
 * d'accès de l'appelant, jamais son droit sur CET élève-là.
 *
 * Pour la rouvrir au public, il manque exactement cela : une vérification du
 * lien entre l'appelant et l'élève visé (l'élève lui-même, ou un tuteur), en
 * plus du paywall. Le corps est inchangé.
 */
export const getStudentProgress = internalQuery({
  args: {
    studentId: v.id("profiles"),
  },
  handler: async (ctx, args) => {
    // Paywall (spec §5.4) — cette lecture prend `studentId` en argument et
    // ne résout aucun profil. blockedStudent(ctx) résout le profil de
    // L'APPELANT et ne bloque que s'il s'agit d'un élève sans droit valide —
    // jamais un adulte, jamais un visiteur non authentifié.
    if (await blockedStudent(ctx)) return [];

    return await ctx.db
      .query("studentTopicProgress")
      .withIndex("by_studentId", (q) => q.eq("studentId", args.studentId))
      .take(200);
  },
});

/**
 * Progression agrégée d'un élève sur une matière — INTERNE, aucun appelant.
 *
 * Même raison que `getStudentProgress` ci-dessus : elle rendait les compteurs
 * de n'importe quel `Id<"profiles">` sans vérifier l'appelant, et le paywall
 * ne dit rien du droit de l'appelant sur cet élève. Une version publique
 * devrait vérifier ce lien en plus du paywall. Le corps est inchangé.
 */
export const getSubjectProgress = internalQuery({
  args: {
    studentId: v.id("profiles"),
    subjectId: v.id("subjects"),
  },
  handler: async (ctx, args) => {
    // Paywall (spec §5.4) — même raisonnement que getStudentProgress
    // ci-dessus : pas de profil résolu ici, donc blockedStudent(ctx) sur
    // l'appelant.
    if (await blockedStudent(ctx)) return null;

    // Get all topics for this subject — hors niveaux masqués
    // (`convex/curriculum.ts`) : l'élève ne peut pas les atteindre.
    const topics = (
      await ctx.db
        .query("topics")
        .withIndex("by_subjectId", (q) => q.eq("subjectId", args.subjectId))
        .take(1000)
    ).filter((topic) => !isHiddenClass(topic.class));

    const topicIds = new Set(topics.map((t) => t._id));

    // Get all progress records for this student
    const allProgress = await ctx.db
      .query("studentTopicProgress")
      .withIndex("by_studentId", (q) => q.eq("studentId", args.studentId))
      .take(200);

    // Filter to only include progress for topics in this subject
    const subjectProgress = allProgress.filter((p) => topicIds.has(p.topicId));

    // Aggregate
    const totalTopics = topics.length;
    const completedTopics = subjectProgress.filter(
      (p) => p.completedAt !== undefined,
    ).length;
    const totalCompleted = subjectProgress.reduce(
      (sum, p) => sum + p.completedExercises,
      0,
    );
    const totalCorrect = subjectProgress.reduce(
      (sum, p) => sum + p.correctExercises,
      0,
    );
    const totalHintsUsed = subjectProgress.reduce(
      (sum, p) => sum + p.totalHintsUsed,
      0,
    );
    const avgMastery =
      subjectProgress.length > 0
        ? subjectProgress.reduce((sum, p) => sum + p.masteryLevel, 0) /
          subjectProgress.length
        : 0;

    return {
      totalTopics,
      completedTopics,
      totalCompleted,
      totalCorrect,
      totalHintsUsed,
      avgMastery,
      topicProgress: subjectProgress,
    };
  },
});
