import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { blockedStudent } from "./access";

export const list = query({
  args: {},
  handler: async (ctx) => {
    // Paywall (spec §5.4) — lecture partagée avec l'administration et les
    // professeurs : blockedStudent(ctx) ne bloque qu'un élève sans droit
    // valide, jamais un adulte ni un visiteur non authentifié.
    if (await blockedStudent(ctx)) return [];

    const subjects = await ctx.db.query("subjects").take(50);
    return subjects.sort((a, b) => a.order - b.order);
  },
});

export const getById = query({
  args: { id: v.id("subjects") },
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
    name: v.string(),
    icon: v.string(),
    color: v.string(),
    order: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("subjects", {
      name: args.name,
      icon: args.icon,
      color: args.color,
      order: args.order,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("subjects"),
    name: v.optional(v.string()),
    icon: v.optional(v.string()),
    color: v.optional(v.string()),
    order: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    const existing = await ctx.db.get(id);
    if (!existing) {
      throw new Error("Matière introuvable");
    }
    // Filter out undefined fields
    const updates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) {
        updates[key] = value;
      }
    }
    await ctx.db.patch(id, updates);
  },
});

/**
 * Seed default subjects (CE2-CM2 curriculum, francophone context).
 * Idempotent: skips subjects that already exist by name.
 * Can be called from any authenticated user; safe for manual runs via
 * `pnpx convex run subjects:seedDefaults`.
 */
export const seedDefaults = mutation({
  args: {},
  handler: async (ctx) => {
    const defaults = [
      { name: "Mathématiques", icon: "Calculator", color: "#4f46e5", order: 1 },
      { name: "Français", icon: "Book", color: "#db2777", order: 2 },
      { name: "Sciences", icon: "Flask", color: "#10b981", order: 3 },
      { name: "Histoire-Géographie", icon: "Globe", color: "#f59e0b", order: 4 },
      { name: "Anglais", icon: "Globe", color: "#0ea5e9", order: 5 },
      { name: "Arts plastiques", icon: "Palette", color: "#ec4899", order: 6 },
      { name: "Éducation musicale", icon: "Music", color: "#8b5cf6", order: 7 },
      { name: "EMC", icon: "Users", color: "#6b7280", order: 8 },
    ];

    const existing = await ctx.db.query("subjects").take(50);
    const existingNames = new Set(existing.map((s) => s.name));

    const created: string[] = [];
    for (const subject of defaults) {
      if (!existingNames.has(subject.name)) {
        await ctx.db.insert("subjects", subject);
        created.push(subject.name);
      }
    }
    return { created, skipped: defaults.length - created.length };
  },
});

export const remove = mutation({
  args: { id: v.id("subjects") },
  handler: async (ctx, args) => {
    // Check if any topics reference this subject
    const topics = await ctx.db
      .query("topics")
      .withIndex("by_subjectId", (q) => q.eq("subjectId", args.id))
      .first();
    if (topics) {
      throw new Error(
        "Impossible de supprimer cette matière car elle contient des thématiques.",
      );
    }
    await ctx.db.delete(args.id);
  },
});
