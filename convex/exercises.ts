import { query, mutation, internalMutation } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { callerIsAdmin, callerIsStaff } from "./access";

// ---------------------------------------------------------------------------
// Queries
//
// Les quatre premières rendent le document `exercises` BRUT : il porte
// `answerKey`, le tableau complet des `hints` et un `payload` qui contient la
// réponse (`correctIndex`, paires correctes…). Ce sont des lectures d'écrans
// adultes — admin et professeur. Le chemin élève légitime passe par
// `paliers/index.ts`, qui retire la réponse via `stripAnswerFromExercise`
// avant de rendre quoi que ce soit.
//
// Ce n'est pas un contrôle de paywall mais un contrôle de rôle : aucun élève,
// payant ou non, ne doit lire ces corrigés. D'où `callerIsStaff` et non
// `blockedStudent` / `requireAccess`. Le garde vit dans `convex/access.ts`,
// partagé avec `convex/students.ts`.
// ---------------------------------------------------------------------------

export const listByTopic = query({
  args: {
    topicId: v.id("topics"),
    status: v.optional(
      v.union(v.literal("draft"), v.literal("published"), v.literal("all")),
    ),
  },
  handler: async (ctx, args) => {
    // Réservé aux adultes : rend le document brut, corrigé compris.
    if (!(await callerIsStaff(ctx))) return [];

    const exercises = await ctx.db
      .query("exercises")
      .withIndex("by_topicId", (q) => q.eq("topicId", args.topicId))
      .take(50);

    const statusFilter = args.status ?? "all";

    const filtered =
      statusFilter === "all"
        ? exercises
        : exercises.filter((e) => e.status === statusFilter);

    return filtered.sort((a, b) => a.order - b.order);
  },
});

export const listAllDrafts = query({
  args: {},
  handler: async (ctx) => {
    // Réservé aux adultes : rend le document brut, corrigé compris.
    if (!(await callerIsStaff(ctx))) return [];

    const exercises = await ctx.db.query("exercises").take(1000);
    return exercises.filter((e) => e.status === "draft");
  },
});

export const listAllPublished = query({
  args: {},
  handler: async (ctx) => {
    // Réservé aux adultes : les exercices de palier générés par l'IA sont
    // insérés "published" (paliers/index.ts), corrigé inclus.
    if (!(await callerIsStaff(ctx))) return [];

    const exercises = await ctx.db.query("exercises").take(1000);
    return exercises.filter((e) => e.status === "published");
  },
});

export const getById = query({
  args: { id: v.id("exercises") },
  handler: async (ctx, args) => {
    // Réservé aux adultes : rend le document brut, corrigé compris.
    if (!(await callerIsStaff(ctx))) return null;

    return await ctx.db.get(args.id);
  },
});

/**
 * List exercises created/reviewed by the current teacher.
 * Returns exercises where reviewedBy === current profile id.
 * Returns [] if not a teacher or unauthenticated.
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

    const all = await ctx.db.query("exercises").take(1000);
    const mine = all.filter((e) => e.reviewedBy === profile._id);

    // Enrich with topic + subject names
    const enriched = await Promise.all(
      mine.map(async (ex) => {
        const topic = await ctx.db.get(ex.topicId);
        const subject = topic ? await ctx.db.get(topic.subjectId) : null;
        return {
          ...ex,
          topicName: topic?.name ?? "Thématique inconnue",
          subjectId: topic?.subjectId,
          subjectName: subject?.name ?? "Matière inconnue",
        };
      }),
    );

    return enriched;
  },
});

// ---------------------------------------------------------------------------
// Mutations
//
// LES SIX SONT GARDÉES, ET ELLES NE L'ÉTAIENT PAS. Aucune ne contrôlait quoi
// que ce soit : un appelant NON AUTHENTIFIÉ pouvait réécrire l'énoncé, le
// corrigé et les indices de n'importe quel exercice, en publier, en dépublier,
// en supprimer. Les quatre LECTURES de ce fichier avaient été fermées ; les
// écritures avaient été manquées, alors qu'elles sont le cœur de valeur d'une
// application devenue payante.
//
// LA LIGNE DE PARTAGE VIENT DES APPELANTS VIVANTS, pas d'une règle produit que
// personne n'a écrite. `callerIsStaff` là où un écran PROFESSEUR agit
// aujourd'hui — `update` (son écran d'édition), `publish` et
// `publishAllFromUpload` (ses imports PDF) ; `callerIsAdmin` là où seuls des
// écrans d'administration appellent — `unpublish`, `remove`, et `create`, qui
// n'a aucun appelant applicatif (les exercices naissent par `createDrafts`,
// interne au flux PDF). Quiconque connaît le produit peut déplacer cette ligne
// À DESSEIN ; elle n'est resserrée ici qu'à la hauteur que les faits
// soutiennent, pour fermer le trou sans inventer une restriction.
//
// `ConvexError` et non `Error` : ces refus s'adressent à un adulte devant un
// écran (spec §5.8, `lib/refusalMessage.ts`). Réserve à traiter : QUATRE des
// cinq écrans appelants n'ont aucune capture, et le cinquième jette l'erreur
// dans un `catch {}` nu — un refus y est donc invisible aujourd'hui, celui-ci
// comme ceux qui existaient déjà (« Exercice introuvable », « des tentatives y
// sont associées »). La classe est posée juste ; les lecteurs restent à
// réparer.
// ---------------------------------------------------------------------------

export const create = mutation({
  args: {
    topicId: v.id("topics"),
    type: v.union(
      v.literal("qcm"),
      v.literal("drag-drop"),
      v.literal("match"),
      v.literal("order"),
      v.literal("short-answer"),
    ),
    prompt: v.string(),
    payload: v.any(),
    answerKey: v.string(),
    hints: v.array(v.string()),
    order: v.number(),
  },
  handler: async (ctx, args) => {
    // Garde de RÔLE, première instruction : rien n'est lu avant.
    if (!(await callerIsAdmin(ctx))) throw new ConvexError("Rôle non autorisé");
    const topic = await ctx.db.get(args.topicId);
    if (!topic) {
      throw new ConvexError("Thématique introuvable");
    }
    return await ctx.db.insert("exercises", {
      topicId: args.topicId,
      type: args.type,
      prompt: args.prompt,
      payload: args.payload,
      answerKey: args.answerKey,
      hints: args.hints,
      order: args.order,
      status: "draft",
      version: 1,
      generatedBy: "manual",
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("exercises"),
    type: v.optional(
      v.union(
        v.literal("qcm"),
        v.literal("drag-drop"),
        v.literal("match"),
        v.literal("order"),
        v.literal("short-answer"),
      ),
    ),
    prompt: v.optional(v.string()),
    payload: v.optional(v.any()),
    answerKey: v.optional(v.string()),
    hints: v.optional(v.array(v.string())),
    order: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Garde de RÔLE, première instruction : rien n'est lu avant.
    if (!(await callerIsStaff(ctx))) throw new ConvexError("Rôle non autorisé");
    const { id, ...fields } = args;
    const existing = await ctx.db.get(id);
    if (!existing) {
      throw new ConvexError("Exercice introuvable");
    }

    const updates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) {
        updates[key] = value;
      }
    }

    // Increment version on each update
    updates.version = existing.version + 1;

    await ctx.db.patch(id, updates);
  },
});

export const publish = mutation({
  args: { id: v.id("exercises") },
  handler: async (ctx, args) => {
    // Garde de RÔLE, première instruction : rien n'est lu avant.
    if (!(await callerIsStaff(ctx))) throw new ConvexError("Rôle non autorisé");
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new ConvexError("Exercice introuvable");
    }
    await ctx.db.patch(args.id, {
      status: "published",
      publishedAt: Date.now(),
    });
  },
});

export const unpublish = mutation({
  args: { id: v.id("exercises") },
  handler: async (ctx, args) => {
    // Garde de RÔLE, première instruction : rien n'est lu avant.
    if (!(await callerIsAdmin(ctx))) throw new ConvexError("Rôle non autorisé");
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new ConvexError("Exercice introuvable");
    }
    await ctx.db.patch(args.id, {
      status: "draft",
    });
  },
});

/**
 * Publish every draft exercise generated from a specific PDF upload.
 * Used by the teacher's PDF detail page to confirm all generated exercises
 * at once after review.
 */
export const publishAllFromUpload = mutation({
  args: { uploadId: v.id("pdfUploads") },
  handler: async (ctx, { uploadId }) => {
    // Garde de RÔLE, première instruction : rien n'est lu avant.
    if (!(await callerIsStaff(ctx))) throw new ConvexError("Rôle non autorisé");
    const allExercises = await ctx.db.query("exercises").take(1000);
    const relevant = allExercises.filter(
      (ex) => ex.sourcePdfUploadId === uploadId && ex.status === "draft",
    );
    const now = Date.now();
    for (const ex of relevant) {
      await ctx.db.patch(ex._id, {
        status: "published",
        publishedAt: now,
      });
    }
    // Also mark the upload as "published" so the status progress bar advances
    const upload = await ctx.db.get(uploadId);
    if (upload && upload.status !== "published") {
      await ctx.db.patch(uploadId, {
        status: "published",
        publishedAt: now,
      });
    }
    return { published: relevant.length };
  },
});

export const remove = mutation({
  args: { id: v.id("exercises") },
  handler: async (ctx, args) => {
    // Garde de RÔLE, première instruction : rien n'est lu avant.
    if (!(await callerIsAdmin(ctx))) throw new ConvexError("Rôle non autorisé");
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new ConvexError("Exercice introuvable");
    }

    // Check if any attempts reference this exercise
    const attempt = await ctx.db
      .query("attempts")
      .filter((q) => q.eq(q.field("exerciseId"), args.id))
      .first();
    if (attempt) {
      throw new ConvexError(
        "Impossible de supprimer cet exercice car des tentatives y sont associées.",
      );
    }

    await ctx.db.delete(args.id);
  },
});

// ---------------------------------------------------------------------------
// Internal mutation: create drafts from AI extraction
// ---------------------------------------------------------------------------

export const createDrafts = internalMutation({
  args: {
    topicId: v.id("topics"),
    sourcePdfUploadId: v.id("pdfUploads"),
    exercises: v.array(
      v.object({
        type: v.union(
          v.literal("qcm"),
          v.literal("drag-drop"),
          v.literal("match"),
          v.literal("order"),
          v.literal("short-answer"),
        ),
        prompt: v.string(),
        payload: v.any(),
        answerKey: v.string(),
        hints: v.array(v.string()),
        order: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const topic = await ctx.db.get(args.topicId);
    if (!topic) {
      throw new Error("Thématique introuvable");
    }

    const ids = [];
    for (const exercise of args.exercises) {
      const id = await ctx.db.insert("exercises", {
        topicId: args.topicId,
        type: exercise.type,
        prompt: exercise.prompt,
        payload: exercise.payload,
        answerKey: exercise.answerKey,
        hints: exercise.hints,
        order: exercise.order,
        status: "draft",
        version: 1,
        generatedBy: "ai",
        sourcePdfUploadId: args.sourcePdfUploadId,
      });
      ids.push(id);
    }

    return ids;
  },
});
