import { ConvexError, v } from "convex/values";
import {
  query,
  mutation,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "./_generated/dataModel";
import { callerIsAdmin, callerStaffProfile } from "./access";

// ---------------------------------------------------------------------------
// CE MODULE ÉTAIT OUVERT DE BOUT EN BOUT. Ses cinq fonctions publiques
// n'avaient AUCUNE garde : `list` rendait tous les imports de la plateforme,
// `getById` les exercices BRUTS d'un import — corrigés compris —,
// `generateUploadUrl` une URL d'envoi, `create` créait un import AU NOM DE
// N'IMPORTE QUI (elle prenait `adminId` en argument) et planifiait une
// extraction IA facturée, et `remove` effaçait jusqu'à cinq cents exercices
// sans le moindre contrôle. Un appelant non authentifié pouvait tout cela.
//
// TROIS RÈGLES DÉJÀ POSÉES AILLEURS DANS CETTE BRANCHE suffisent à le fermer,
// et c'est pourquoi le découpage ci-dessous n'invente rien :
//   - l'auteur d'un import vient de la SESSION, jamais d'un argument. Un droit
//     vérifié sur l'appelant n'autorise que ce que l'appelant fait pour
//     lui-même (cf. `attempts.submit`).
//   - un professeur n'agit que sur SES imports — garde de LIEN et non de rôle,
//     comme `exercises.staffMayTouchExercise`. L'administrateur passe partout.
//   - on n'efface pas ce sur quoi un enfant a travaillé (cf. `exercises.remove`
//     et `topics.removeWithExercises`). C'est ce manque-là qui laissait des
//     tentatives orphelines et invalidait le raisonnement de
//     `removeWithExercises`.
//
// Une requête rend vide, une mutation lève — convention du dépôt.
// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** List all PDF uploads, most recent first. Includes subject name. */
/**
 * Cet import appartient-il à ce membre du personnel ?
 *
 * `pdfUploads.adminId` nomme qui l'a déposé. Un administrateur passe sans
 * condition — il n'a pas d'import à lui, il les administre tous.
 */
function staffOwnsUpload(
  staff: Doc<"profiles">,
  upload: Doc<"pdfUploads">,
): boolean {
  return staff.role === "admin" || upload.adminId === staff._id;
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    // Elle rend les imports de TOUTE la plateforme : c'est une lecture
    // d'administration. Un professeur a `listByTeacher`, qui filtre sur lui.
    if (!(await callerIsAdmin(ctx))) return [];

    const uploads = await ctx.db.query("pdfUploads").order("desc").take(200);

    const results = await Promise.all(
      uploads.map(async (upload) => {
        const subject = await ctx.db.get(upload.subjectId);
        return {
          ...upload,
          subjectName: subject?.name ?? "Inconnu",
        };
      }),
    );

    return results;
  },
});

/**
 * List PDF uploads owned by the current teacher (adminId === profile._id).
 * Returns [] if not a teacher/admin or unauthenticated.
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

    const uploads = await ctx.db.query("pdfUploads").order("desc").take(200);
    const mine = uploads.filter((u) => u.adminId === profile._id);

    const results = await Promise.all(
      mine.map(async (upload) => {
        const subject = await ctx.db.get(upload.subjectId);
        return {
          ...upload,
          subjectName: subject?.name ?? "Inconnu",
        };
      }),
    );

    return results;
  },
});

/** Get a single upload by ID, including the count of generated exercises. */
export const getById = query({
  args: { id: v.id("pdfUploads") },
  handler: async (ctx, { id }) => {
    // Elle rend les exercices BRUTS de l'import — `answerKey` et indices
    // compris. Garde de LIEN : un professeur ne lit que ses propres imports.
    // Un import hors de portée est INTROUVABLE, jamais « non autorisé » :
    // distinguer les deux renseignerait sur ce qui existe.
    const staff = await callerStaffProfile(ctx);
    if (!staff) return null;

    const upload = await ctx.db.get(id);
    if (!upload || !staffOwnsUpload(staff, upload)) return null;

    const subject = await ctx.db.get(upload.subjectId);

    // Exercices produits par cet import, PAR INDEX. Ce commentaire disait
    // « no index on sourcePdfUploadId, bounded scan with take » : la borne
    // portait sur le résultat, pas sur le parcours, et cette lecture d'écran
    // devenait un parcours de toute la table `exercises`.
    const exercises = await ctx.db
      .query("exercises")
      .withIndex("by_sourcePdfUploadId", (q) =>
        q.eq("sourcePdfUploadId", id),
      )
      .take(200);

    return {
      ...upload,
      subjectName: subject?.name ?? "Inconnu",
      exercisesCount: exercises.length,
      exercises,
    };
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Generate a Convex storage upload URL. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    // Une URL d'envoi est un droit d'ÉCRIRE dans le stockage du projet. Sans
    // garde, n'importe qui pouvait y déposer n'importe quoi.
    if (!(await callerStaffProfile(ctx))) {
      throw new ConvexError("Rôle non autorisé");
    }
    return await ctx.storage.generateUploadUrl();
  },
});

/** Create a PDF upload record and schedule AI extraction. */
export const create = mutation({
  args: {
    storageId: v.string(),
    originalFilename: v.string(),
    mimeType: v.string(),
    size: v.number(),
    subjectId: v.id("subjects"),
  },
  handler: async (ctx, args) => {
    // L'AUTEUR VIENT DE LA SESSION, ET IL N'EST PLUS UN ARGUMENT. `adminId`
    // était reçu de l'appelant puis écrit tel quel : n'importe qui pouvait
    // créer un import AU NOM D'UN AUTRE — et, comme cette mutation planifie
    // une extraction IA, déclencher une dépense facturée à l'école d'autrui.
    // Retirer l'argument rend l'usurpation inexprimable, non refusée.
    const staff = await callerStaffProfile(ctx);
    if (!staff) throw new ConvexError("Rôle non autorisé");

    const uploadId = await ctx.db.insert("pdfUploads", {
      adminId: staff._id,
      storageId: args.storageId,
      originalFilename: args.originalFilename,
      mimeType: args.mimeType,
      size: args.size,
      subjectId: args.subjectId,
      status: "uploaded",
    });

    // Schedule the extraction immediately
    await ctx.scheduler.runAfter(0, internal.pdfUploadsExtract.extract, { uploadId });

    return uploadId;
  },
});

/** Delete a PDF upload and its associated exercises. */
/**
 * Relance l'extraction d'un import qui a échoué.
 *
 * ELLE EXISTE PARCE QUE L'ÉCRAN RECRÉAIT UN IMPORT, et que ce raccourci est
 * devenu un défaut le jour où `create` a cessé de recevoir `adminId` : l'auteur
 * venant désormais de la SESSION, un administrateur qui relançait l'import d'un
 * professeur s'en attribuait la copie — et le professeur perdait l'accès à ses
 * propres exercices, `listByTeacher` et `getById` filtrant sur `adminId`.
 *
 * Relancer sur la ligne EXISTANTE ferme trois choses à la fois : l'auteur reste
 * celui qui est écrit dans le document et non celui qui clique ; aucune ligne
 * jumelle n'apparaît ; et les deux ne partagent plus un même `storageId`, ce
 * qui faisait qu'une suppression de l'une emportait le fichier de l'autre.
 *
 * Garde de LIEN comme le reste du module : son propre import, ou administrateur.
 *
 * ELLE REFUSE SI L'EXTRACTION N'A PAS ÉCHOUÉ, et cette garde-là n'est pas du
 * zèle. `pdfUploadsExtract.extract` n'est PAS idempotente : elle rappelle
 * `createDraftExercises`, qui INSÈRE une ligne par exercice extrait. Relancée
 * sur un import déjà extrait, elle refacturait donc une extraction gpt-4o
 * entière — l'appel le plus cher du dépôt, plafonné à 16 000 jetons de sortie —
 * et doublait les brouillons, sans que rien ne s'y oppose. Le seul obstacle
 * était que l'écran n'affiche le bouton qu'en cas d'échec ; la règle D24 de
 * cette branche dit exactement pourquoi cela ne suffit pas.
 *
 * L'ÉCHEC SE LIT DANS `extractedRaw.error`, que `markError` est seule à écrire
 * et que toute sortie en erreur d'`extract` traverse — son `catch` englobe
 * l'appel, l'analyse de la réponse et la création des brouillons. C'est donc
 * l'état d'échec lui-même qui autorise la relance, pas un statut approchant.
 *
 * FENÊTRE CONNUE, NON FERMÉE ICI : si `markExtracted` a réussi et que
 * `createDraftExercises` a échoué juste après, l'import porte à la fois des
 * brouillons et une erreur ; la relance est alors légitime et redoublera ce qui
 * avait été créé. La fermer demande une idempotence dans
 * `createDraftExercises`, pas une garde de plus ici — et surtout pas un
 * effacement préalable des brouillons, qui emporterait ceux qu'un relecteur a
 * déjà corrigés ou publiés.
 */
export const retryExtraction = mutation({
  args: { id: v.id("pdfUploads") },
  handler: async (ctx, { id }) => {
    const staff = await callerStaffProfile(ctx);
    if (!staff) throw new ConvexError("Rôle non autorisé");

    const upload = await ctx.db.get(id);
    if (!upload || !staffOwnsUpload(staff, upload)) {
      throw new ConvexError("Import introuvable");
    }

    const raw = upload.extractedRaw;
    const failed =
      typeof raw === "object" && raw !== null && "error" in raw;
    if (!failed) {
      throw new ConvexError(
        "Cet import n'est pas en erreur : il n'y a rien à relancer. " +
          "Relancer une extraction réussie la referait payer et créerait un " +
          "second jeu de brouillons.",
      );
    }

    // L'erreur précédente s'efface : la laisser ferait afficher un échec
    // pendant que l'extraction retourne.
    await ctx.db.patch(id, { extractedRaw: undefined });
    await ctx.scheduler.runAfter(0, internal.pdfUploadsExtract.extract, {
      uploadId: id,
    });
  },
});

/** Exercices lus au plus pour la suppression d'un import. */
const UPLOAD_EXERCISES_LIMIT = 200;

/**
 * Supprime un import et les exercices qu'il a produits.
 *
 * ELLE CONTOURNAIT LA RÈGLE QUE `exercises.remove` PROTÈGE, et c'est le plus
 * grave. Sans aucune garde ni aucun contrôle, elle effaçait jusqu'à cinq cents
 * exercices — y compris ceux qu'un enfant avait tentés, qu'`exercises.remove`
 * refuse de supprimer un par un. Les `attempts` correspondantes SURVIVAIENT en
 * pointant vers un exercice effacé.
 *
 * Ce n'est pas une nuisance abstraite : c'est elle qui rendait fausse la preuve
 * de `topics.removeWithExercises`. Celle-ci raisonnait qu'une progression
 * implique une tentative sur un exercice ACTUEL de la thématique — vrai, sauf
 * si un exercice peut disparaître en laissant tentative et progression
 * derrière lui. C'était exactement ce que faisait cette fonction.
 */
export const remove = mutation({
  args: { id: v.id("pdfUploads") },
  handler: async (ctx, { id }) => {
    // Garde de LIEN, première instruction : rien n'est lu avant.
    const staff = await callerStaffProfile(ctx);
    if (!staff) throw new ConvexError("Rôle non autorisé");

    const upload = await ctx.db.get(id);
    if (!upload || !staffOwnsUpload(staff, upload)) {
      throw new ConvexError("Import introuvable");
    }

    // Filtrer PUIS prendre — l'inverse lirait les premiers documents de la
    // table entière. La ligne de plus distingue « à la borne » de « au-delà ».
    const exercises = await ctx.db
      .query("exercises")
      .withIndex("by_sourcePdfUploadId", (q) =>
        q.eq("sourcePdfUploadId", id),
      )
      .take(UPLOAD_EXERCISES_LIMIT + 1);

    if (exercises.length > UPLOAD_EXERCISES_LIMIT) {
      throw new ConvexError(
        `Cet import a produit plus de ${UPLOAD_EXERCISES_LIMIT} exercices et ne peut pas être supprimé d'un seul geste.`,
      );
    }

    // TOUS LES REFUS AVANT LA PREMIÈRE SUPPRESSION. Un import à moitié effacé,
    // avec son fichier de stockage parti, serait pire que pas de suppression.
    for (const exercise of exercises) {
      const attempt = await ctx.db
        .query("attempts")
        .withIndex("by_exerciseId", (q) => q.eq("exerciseId", exercise._id))
        .first();
      if (attempt) {
        throw new ConvexError(
          "Impossible de supprimer cet import car des élèves ont déjà travaillé sur ses exercices.",
        );
      }

      const explanation = await ctx.db
        .query("exerciseExplanations")
        .withIndex("by_exercise", (q) => q.eq("exerciseId", exercise._id))
        .first();
      if (explanation) {
        throw new ConvexError(
          "Impossible de supprimer cet import car un élève a demandé une explication sur l'un de ses exercices.",
        );
      }
    }

    for (const exercise of exercises) {
      await ctx.db.delete(exercise._id);
    }

    // Delete the storage file
    try {
      await ctx.storage.delete(upload.storageId as Id<"_storage">);
    } catch {
      // Storage file may already be deleted
    }

    // Delete the upload record
    await ctx.db.delete(id);
  },
});

// ---------------------------------------------------------------------------
// Internal mutations for updating status
// ---------------------------------------------------------------------------

/** Mark an upload as extracted with raw data. */
export const markExtracted = internalMutation({
  args: {
    uploadId: v.id("pdfUploads"),
    extractedRaw: v.any(),
    extractedAt: v.number(),
  },
  handler: async (ctx, { uploadId, extractedRaw, extractedAt }) => {
    await ctx.db.patch(uploadId, {
      status: "extracted",
      extractedRaw,
      extractedAt,
    });
  },
});

/** Mark an upload as errored with error info. */
export const markError = internalMutation({
  args: {
    uploadId: v.id("pdfUploads"),
    error: v.string(),
  },
  handler: async (ctx, { uploadId, error }) => {
    await ctx.db.patch(uploadId, {
      extractedRaw: { error },
    });
  },
});

/** Create draft exercises from extracted data. */
export const createDraftExercises = internalMutation({
  args: {
    uploadId: v.id("pdfUploads"),
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
      }),
    ),
    subjectId: v.id("subjects"),
    suggestedTopicName: v.optional(v.string()),
  },
  handler: async (ctx, { uploadId, exercises, subjectId, suggestedTopicName }) => {
    const topics = await ctx.db
      .query("topics")
      .withIndex("by_subjectId", (q) => q.eq("subjectId", subjectId))
      .take(200);

    // Resolve a target topic in this order:
    // 1. If the IA suggested a topic name and one already exists (case-insensitive match) → reuse it
    // 2. If the IA suggested a topic name → create a new topic with that name
    // 3. Else fall back to the first existing topic
    // 4. Else create a "Général" topic as last resort
    let targetTopicId;

    const suggested = suggestedTopicName?.trim();
    if (suggested) {
      const normalized = suggested.toLowerCase();
      const existing = topics.find((t) => t.name.toLowerCase() === normalized);
      if (existing) {
        targetTopicId = existing._id;
      } else {
        targetTopicId = await ctx.db.insert("topics", {
          subjectId,
          name: suggested,
          description: `Thème identifié automatiquement lors de l'import d'un PDF.`,
          order: topics.length + 1,
        });
      }
    } else if (topics.length > 0) {
      targetTopicId = topics[0]._id;
    } else {
      targetTopicId = await ctx.db.insert("topics", {
        subjectId,
        name: "Général",
        description:
          "Thème créé automatiquement lors de l'import d'un PDF. Vous pouvez le renommer ou le réorganiser.",
        order: 1,
      });
    }

    const defaultTopicId = targetTopicId;

    for (let i = 0; i < exercises.length; i++) {
      const ex = exercises[i];
      await ctx.db.insert("exercises", {
        topicId: defaultTopicId,
        type: ex.type,
        prompt: ex.prompt,
        payload: ex.payload,
        answerKey: ex.answerKey,
        hints: ex.hints,
        order: i + 1,
        status: "draft",
        version: 1,
        sourcePdfUploadId: uploadId,
        generatedBy: "ai",
      });
    }
  },
});

// NOTE: the internalAction `extract` lives in convex/pdfUploadsExtract.ts
// (Node runtime) so it can use Node's `Buffer` to base64-encode the PDF.

// ---------------------------------------------------------------------------
// Internal query (used by the extract action)
// ---------------------------------------------------------------------------

/** Get upload document for internal use. */
export const getUploadInternal = internalQuery({
  args: { uploadId: v.id("pdfUploads") },
  handler: async (ctx, { uploadId }) => {
    return await ctx.db.get(uploadId);
  },
});
