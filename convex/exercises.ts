import {
  query,
  mutation,
  internalMutation,
  type MutationCtx,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { ConvexError, v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { callerIsAdmin, callerIsStaff, callerStaffProfile } from "./access";
import { isHiddenClass } from "./curriculum";

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

    // LE NIVEAU MASQUÉ SE REFUSE AUSSI AU PROFESSEUR. Il ne peut pas découvrir
    // la thématique — `topics.listAll` la filtre — mais un identifiant suffirait
    // sinon à lire le contenu de collège que personne ne sert encore. L'admin,
    // lui, le prépare : c'est le seul rôle qui passe (`convex/curriculum.ts`).
    const topic = await ctx.db.get(args.topicId);
    if (topic === null) return [];
    if (isHiddenClass(topic.class) && !(await callerIsAdmin(ctx))) return [];

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
// LES SIX SONT GARDÉES, ET AUCUNE NE L'ÉTAIT. Pas une ne contrôlait quoi que
// ce soit : un appelant NON AUTHENTIFIÉ pouvait réécrire l'énoncé, le corrigé
// et les indices de n'importe quel exercice, en publier, en dépublier, en
// supprimer. Les LECTURES de ce fichier avaient été fermées ; les écritures
// avaient été manquées, alors qu'elles sont le cœur de valeur d'une
// application devenue payante.
//
// DEUX RÈGLES, et non une liste d'écrans — une liste se périme à l'écran
// suivant, une règle tient :
//
//  1. Une écriture qu'un membre du PERSONNEL fait sur ce qui est À LUI passe
//     par une garde de LIEN (`staffMayTouchExercise` plus bas) : un rôle ne
//     dit rien de ce sur quoi on a le droit d'agir. Deux professeurs d'une même
//     école portent le même rôle ; seul le lien distingue leurs exercices.
//  2. Une écriture qui n'appartient à personne en particulier — créer,
//     dépublier, supprimer — est réservée à l'ADMINISTRATEUR. Ce sont des
//     actes sur le catalogue lui-même, pas sur le travail de quelqu'un.
//
// Déplacer cette ligne est une décision de produit, pas de code : elle est
// posée ici au plus serré que les données soutiennent, sans inventer de
// restriction ni laisser de mou.
//
// `ConvexError` et non `Error` : la règle du dépôt (en-têtes de `topics.ts`,
// `subjects.ts`, `badges.ts` ; `lib/refusalMessage.ts`) veut cette classe pour
// ce qu'un LECTEUR AFFICHE. ELLE EST MÉRITÉE ICI : les cinq écrans appelants
// lisent `refusalMessage` et rendent une bannière, sur leurs NEUF
// gestionnaires. NE PAS RÉTROGRADER EN `Error` — ces refus retomberaient tous
// sur les textes de repli génériques des écrans, silencieusement : `err.data`
// cesserait d'être une chaîne, aucun test ni `tsc` ne le verrait, et les
// phrases écrites ici (« des tentatives y sont associées », « Exercice
// introuvable ») disparaîtraient de l'interface.
// ---------------------------------------------------------------------------

/**
 * Exercices lus au plus pour un import PDF donné.
 *
 * Même valeur que `pdfUploads.getById`, à dessein : ce que l'écran montre doit
 * être exactement ce que `publishAllFromUpload` publie. Deux bornes
 * différentes, et le compte annoncé cesse d'être le compte publié.
 */
const UPLOAD_EXERCISES_LIMIT = 200;

/**
 * Ce membre du personnel a-t-il quelque chose à voir avec cet exercice ?
 *
 * GARDE DE LIEN, ET NON DE RÔLE. Un `callerIsStaff` seul laisserait TOUT
 * professeur réécrire le `answerKey` de N'IMPORTE QUEL exercice, y compris ceux
 * d'une autre école et ceux qu'un palier a générés pour des élèves payants : le
 * trou serait rétréci, pas fermé. Un rôle dit ce qu'on est, jamais sur quoi on
 * a le droit d'agir.
 *
 * L'ARGUMENT D'ORIGINE ÉTAIT PLUS ÉTROIT, ET IL A CESSÉ D'ÊTRE VRAI : il
 * disait que `professeur` n'est pas un rôle de confiance parce que
 * `convex/auth.ts` l'accepte à l'auto-inscription. Cette branche a fermé cette
 * porte (`roleRules.decideSignupRole` refuse les trois rôles d'autorité). La
 * garde reste néanmoins juste — pour la raison ci-dessus, qui ne dépend
 * d'aucune porte d'inscription. Une justification périmée est plus dangereuse
 * qu'absente : le prochain lecteur vérifie la prémisse, la trouve fausse, et
 * conclut que la garde ne sert plus.
 *
 * Le lien EXISTE DÉJÀ dans les données : `sourcePdfUploadId` est posé par
 * `pdfUploads.createDraftExercises`, et `pdfUploads.adminId` nomme qui a
 * déposé le document. C'est exactement le contrôle que l'écran professeur fait
 * DÉJÀ côté client (`app/(teacher)/teacher/pdf-uploads/[id]/page.tsx`) — et un
 * client n'exécute que le code qu'il veut bien exécuter, donc le serveur doit
 * le refaire.
 *
 * Un administrateur passe sans condition : il n'a pas d'import à lui, il les
 * administre tous. Un professeur ne passe que sur les exercices issus de SES
 * imports ; un exercice sans import d'origine — ceux que les paliers génèrent —
 * n'appartient à aucun professeur, donc à aucun d'eux.
 */
async function staffMayTouchExercise(
  ctx: MutationCtx,
  staff: Doc<"profiles">,
  exercise: Doc<"exercises">,
): Promise<boolean> {
  if (staff.role === "admin") return true;
  if (!exercise.sourcePdfUploadId) return false;
  const upload = await ctx.db.get(exercise.sourcePdfUploadId);
  return upload?.adminId === staff._id;
}

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
    // Garde de LIEN, première instruction : rien n'est lu avant.
    const staff = await callerStaffProfile(ctx);
    if (!staff) throw new ConvexError("Rôle non autorisé");
    const { id, ...fields } = args;
    const existing = await ctx.db.get(id);
    // Un exercice hors de portée est INTROUVABLE, jamais « non autorisé » :
    // distinguer les deux renseignerait sur ce qui existe.
    if (!existing || !(await staffMayTouchExercise(ctx, staff, existing))) {
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
    // Garde de LIEN, première instruction : rien n'est lu avant.
    const staff = await callerStaffProfile(ctx);
    if (!staff) throw new ConvexError("Rôle non autorisé");
    const existing = await ctx.db.get(args.id);
    if (!existing || !(await staffMayTouchExercise(ctx, staff, existing))) {
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
    // Garde de LIEN, première instruction : rien n'est lu avant. Ici le lien se
    // juge sur l'IMPORT lui-même, que l'argument désigne.
    const staff = await callerStaffProfile(ctx);
    if (!staff) throw new ConvexError("Rôle non autorisé");
    const target = await ctx.db.get(uploadId);
    if (!target || (staff.role !== "admin" && target.adminId !== staff._id)) {
      throw new ConvexError("Import introuvable");
    }
    // FILTRER PUIS PRENDRE, ET NON L'INVERSE. Ce code lisait
    // `query("exercises").take(1000)` — donc les MILLE PLUS ANCIENS exercices
    // de toute la table — avant de filtrer en mémoire sur l'import. L'écran,
    // lui, filtre AVANT de prendre (`pdfUploads.getById`), si bien que les
    // deux divergeaient dès que la table dépassait mille documents : l'écran
    // affichait douze brouillons, la mutation n'en voyait aucun, n'en publiait
    // aucun, marquait tout de même l'import « publié », et rendait
    // `{ published: 0 }` — que l'écran annonçait en VERT comme une réussite.
    //
    // Le seuil n'a rien de théorique : `paliers/index.ts` insère un exercice à
    // chaque génération et régénération de palier, donc la table grandit avec
    // l'usage ÉLÈVE, pas seulement avec les imports.
    //
    // Même borne que l'écran (`.take(200)`), pour que ce qu'il montre soit
    // exactement ce que ceci publie.
    //
    // PAR INDEX, ET NON PAR `.filter()`. La première correction de ce bloc
    // s'était arrêtée à mi-chemin : elle rétablissait le bon ENSEMBLE — 200
    // exercices de cet import, au lieu des 200 plus anciens de la table filtrés
    // ensuite — mais laissait le parcours entier, `.filter()` étant chez Convex
    // un prédicat appliqué pendant la lecture. Le défaut de correction était
    // guéri, celui d'échelle restait, et le second finit en refus de
    // transaction plutôt qu'en lenteur.
    const fromUpload = await ctx.db
      .query("exercises")
      .withIndex("by_sourcePdfUploadId", (q) =>
        q.eq("sourcePdfUploadId", uploadId),
      )
      .take(UPLOAD_EXERCISES_LIMIT);
    const relevant = fromUpload.filter((ex) => ex.status === "draft");
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

    // Check if any attempts reference this exercise.
    // `by_exerciseId` : cette branche l'ajoute au schéma et l'utilise déjà dans
    // `topics.removeWithExercises` et `pdfUploads.remove` — ce site-ci avait été
    // manqué. En `.filter()`, `.first()` ne court-circuite que sur une
    // CORRESPONDANCE : quand l'exercice n'a aucune tentative — le cas qui
    // autorise la suppression — la requête parcourait toute la table.
    const attempt = await ctx.db
      .query("attempts")
      .withIndex("by_exerciseId", (q) => q.eq("exerciseId", args.id))
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
