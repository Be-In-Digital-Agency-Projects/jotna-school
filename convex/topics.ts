import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { blockedStudent } from "./access";

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    // Paywall (spec §5.4) — lecture partagée avec l'administration et les
    // professeurs : blockedStudent(ctx) ne bloque qu'un élève sans droit
    // valide, jamais un adulte ni un visiteur non authentifié.
    if (await blockedStudent(ctx)) return [];

    return await ctx.db.query("topics").take(200);
  },
});

export const listBySubject = query({
  args: { subjectId: v.id("subjects") },
  handler: async (ctx, args) => {
    // Paywall (spec §5.4) — lecture partagée avec l'administration et les
    // professeurs : blockedStudent(ctx) ne bloque qu'un élève sans droit
    // valide, jamais un adulte ni un visiteur non authentifié.
    if (await blockedStudent(ctx)) return [];

    const topics = await ctx.db
      .query("topics")
      .withIndex("by_subjectId", (q) => q.eq("subjectId", args.subjectId))
      .take(200);
    return topics.sort((a, b) => a.order - b.order);
  },
});

export const getById = query({
  args: { id: v.id("topics") },
  handler: async (ctx, args) => {
    // Paywall (spec §5.4) — lecture partagée avec l'administration et les
    // professeurs : blockedStudent(ctx) ne bloque qu'un élève sans droit
    // valide, jamais un adulte ni un visiteur non authentifié.
    if (await blockedStudent(ctx)) return null;

    return await ctx.db.get(args.id);
  },
});

export const create = mutation({
  args: {
    subjectId: v.id("subjects"),
    name: v.string(),
    description: v.string(),
    order: v.number(),
  },
  handler: async (ctx, args) => {
    // Verify subject exists
    const subject = await ctx.db.get(args.subjectId);
    if (!subject) {
      throw new Error("Matière introuvable");
    }
    return await ctx.db.insert("topics", {
      subjectId: args.subjectId,
      name: args.name,
      description: args.description,
      order: args.order,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("topics"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    order: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    const existing = await ctx.db.get(id);
    if (!existing) {
      throw new Error("Thématique introuvable");
    }
    const updates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) {
        updates[key] = value;
      }
    }
    await ctx.db.patch(id, updates);
  },
});

export const remove = mutation({
  args: { id: v.id("topics") },
  handler: async (ctx, args) => {
    // Check if any exercises reference this topic
    const exercise = await ctx.db
      .query("exercises")
      .withIndex("by_topicId", (q) => q.eq("topicId", args.id))
      .first();
    if (exercise) {
      throw new Error(
        "Impossible de supprimer cette thématique car elle contient des exercices. Utilisez removeWithExercises pour supprimer en cascade.",
      );
    }
    await ctx.db.delete(args.id);
  },
});

/**
 * Cascade-delete a topic and every exercise + attempt + progress + report
 * attached to it. Used by the teacher space when a thematic folder must be
 * removed (for instance an auto-generated "Général" topic from an early
 * extraction that the teacher wants to clean up).
 */
export const removeWithExercises = mutation({
  args: { id: v.id("topics") },
  handler: async (ctx, { id }) => {
    const topic = await ctx.db.get(id);
    if (!topic) throw new Error("Thématique introuvable");

    // 1. Exercises in this topic
    const exercises = await ctx.db
      .query("exercises")
      .withIndex("by_topicId", (q) => q.eq("topicId", id))
      .take(500);

    // 2. Attempts on those exercises
    // No index by exerciseId alone, so scan bounded batches per exercise.
    for (const ex of exercises) {
      const attempts = await ctx.db
        .query("attempts")
        .take(500);
      for (const a of attempts) {
        if (a.exerciseId === ex._id) await ctx.db.delete(a._id);
      }
      await ctx.db.delete(ex._id);
    }

    // 3. Student progress for this topic
    const progressRows = await ctx.db
      .query("studentTopicProgress")
      .take(500);
    for (const p of progressRows) {
      if (p.topicId === id) await ctx.db.delete(p._id);
    }

    // 4. Topic reports
    const reports = await ctx.db
      .query("topicReports")
      .take(500);
    for (const r of reports) {
      if (r.topicId === id) await ctx.db.delete(r._id);
    }

    // 5. Finally, the topic itself
    await ctx.db.delete(id);

    return { deletedExercises: exercises.length };
  },
});
