import { query, mutation } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import {
  blockedStudent,
  callerHasProfile,
  callerIsAdmin,
  callerIsStaff,
} from "./access";

// ---------------------------------------------------------------------------
// Queries — DEUX gardes qui se cumulent, dans cet ordre.
//
// 1. `callerHasProfile` établit l'IDENTITÉ. Nécessaire parce que
//    `blockedStudent` rend false pour un appelant NON authentifié, par
//    conception : il ne doit bloquer ni un adulte ni un visiteur. Seul, il se
//    contournait en retirant simplement le jeton de session.
// 2. `blockedStudent` établit le DROIT D'ACCÈS (paywall, spec §5.4). Lecture
//    partagée avec l'administration et les professeurs : il ne bloque qu'un
//    élève sans droit valide, jamais un adulte.
//
// Le premier ne remplace pas le second — un élève impayé a bien un profil.
// Tous les appelants sont des écrans authentifiés (élève, parent, professeur,
// admin), donc exiger un profil n'en casse aucun.
//
// Une requête ne lève jamais : même valeur vide que le chemin nominal.
// ---------------------------------------------------------------------------

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    // Identité puis paywall — voir l'en-tête : les deux se cumulent.
    if (!(await callerHasProfile(ctx))) return [];
    if (await blockedStudent(ctx)) return [];

    return await ctx.db.query("topics").take(200);
  },
});

export const listBySubject = query({
  args: { subjectId: v.id("subjects") },
  handler: async (ctx, args) => {
    // Identité puis paywall — voir l'en-tête : les deux se cumulent.
    if (!(await callerHasProfile(ctx))) return [];
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
    // Identité puis paywall — voir l'en-tête : les deux se cumulent.
    if (!(await callerHasProfile(ctx))) return null;
    if (await blockedStudent(ctx)) return null;

    return await ctx.db.get(args.id);
  },
});

// ---------------------------------------------------------------------------
// Mutations — garde de RÔLE, pas garde de paywall.
//
// Les cinq écritures ci-dessous créent, modifient et suppriment le curriculum
// lui-même. Elles n'ont rien à voir avec le droit d'accès d'un élève :
// `blockedStudent` et `requireAccess` jugent un abonnement, pas la qualité de
// l'appelant. `admin` pour les quatre premières, dont les appelants sont les
// écrans `app/(admin)/admin/subjects/*` ; `removeWithExercises` est la seule
// exception, appelée par `app/(teacher)/teacher/exercises/page.tsx`, d'où
// `callerIsStaff` (professeur + admin).
//
// Une mutation peut lever, et le garde est la toute première instruction :
// rien n'est lu avant d'avoir établi le rôle. Un seul message pour tous les
// refus de rôle, comme `profiles.linkChild`.
//
// CES REFUS SONT DES `ConvexError`, PARCE QU'UN LECTEUR LES AFFICHE. La règle
// se juge au LECTEUR, jamais au module : hors développement Convex occulte le
// `message` d'une erreur, et seul `data` est transmis TEL QUEL, donc un refus
// qu'un écran montre doit voyager par là. Les écrans le lisent avec
// `refusalMessage` (`lib/refusalMessage.ts`). Sans cette bascule leur repli
// serait INATTEIGNABLE — ils attrapent en `err instanceof Error`, test que
// toute erreur passe puisque `ConvexError` étend `Error` — et l'administrateur
// lirait un message enveloppé et vidé à la place de la phrase écrite ici.
// ---------------------------------------------------------------------------

export const create = mutation({
  args: {
    subjectId: v.id("subjects"),
    name: v.string(),
    description: v.string(),
    order: v.number(),
  },
  handler: async (ctx, args) => {
    if (!(await callerIsAdmin(ctx))) throw new ConvexError("Rôle non autorisé");

    // Verify subject exists
    const subject = await ctx.db.get(args.subjectId);
    if (!subject) {
      throw new ConvexError("Matière introuvable");
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
    if (!(await callerIsAdmin(ctx))) throw new ConvexError("Rôle non autorisé");

    const { id, ...fields } = args;
    const existing = await ctx.db.get(id);
    if (!existing) {
      throw new ConvexError("Thématique introuvable");
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
    if (!(await callerIsAdmin(ctx))) throw new ConvexError("Rôle non autorisé");

    // Check if any exercises reference this topic
    const exercise = await ctx.db
      .query("exercises")
      .withIndex("by_topicId", (q) => q.eq("topicId", args.id))
      .first();
    if (exercise) {
      throw new ConvexError(
        "Impossible de supprimer cette thématique car elle contient des exercices. Supprimez-les d'abord — sachant qu'un exercice déjà tenté par un élève ne peut pas être supprimé.",
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
 *
 * `callerIsStaff` et non `callerIsAdmin` : son unique appelant est l'écran
 * professeur, que restreindre à `admin` casserait. C'était la pire des onze
 * écritures ouvertes — publique et sans aucune authentification, un simple
 * `Id<"topics">` suffisait à effacer un chapitre, jusqu'à 500 de ses
 * exercices, toutes les tentatives des élèves dessus et leur progression.
 */
export const removeWithExercises = mutation({
  args: { id: v.id("topics") },
  handler: async (ctx, { id }) => {
    if (!(await callerIsStaff(ctx))) throw new ConvexError("Rôle non autorisé");

    const topic = await ctx.db.get(id);
    if (!topic) throw new ConvexError("Thématique introuvable");

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
