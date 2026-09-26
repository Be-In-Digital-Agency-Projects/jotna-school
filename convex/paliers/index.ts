/**
 * Paliers — bucket lifecycle (cache + lazy gen) + regen orchestration.
 *
 * Decisions: 3, 9, 10, 46, 50, 52, 53, 56, 60, 71, 75, 77, 78.
 */

import { v, ConvexError } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  assertVisibleClass,
  visibleClassValidator,
} from "../curriculum";
import {
  buildPalierBasePrompt,
  buildPalierBaseSystemPrompt,
  buildVariationPrompt,
  buildVariationSystemPrompt,
} from "./prompts";
import { checkMathExercise } from "../aiGateway/factCheck";
import { computeExerciseScore } from "./scoring";
import { getAuthUserId } from "@convex-dev/auth/server";
import { checkAccess, requireAccess } from "../access";
import { AI_CONSENT_KID_MESSAGE } from "../aiConsentRules";
import { buildDigests } from "./offline";
import { saltFor, sha256Hex } from "./digest";

/**
 * Péremption du contenu d'un palier, PARTAGÉ par tous les élèves d'un niveau,
 * toutes écoles confondues. Un trimestre.
 *
 * Elle valait sept jours. Un cache à péremption sert à rattraper une source qui
 * change ; ici il n'y en a pas : la table de multiplication en CE2 est la même
 * en septembre et en juin, et le programme ne bouge pas d'une semaine à
 * l'autre. Régénérer chaque semaine rachetait donc peu et coûtait 92 % du
 * budget de contenu — la génération d'un palier (6 000 jetons de sortie) est de
 * loin l'appel le plus cher du produit, ~23 fois une vérification de réponse.
 *
 * La variété, elle, ne dépend pas de cette constante : `shuffleSeed`, les
 * paliers personnalisés, les « encore » quotidiens et REGEN_WINDOW_MS
 * ci-dessous s'en chargent, et chacun vise UN élève au lieu de rafraîchir pour
 * tout le monde parce que la semaine d'un seul s'est écoulée.
 *
 * Ce qui justifierait vraiment une régénération, c'est un changement de prompt,
 * pas un calendrier : invalider sur une version de prompt stockée avec le
 * palier rafraîchirait exactement quand le contenu a une raison de changer.
 * C'est la forme juste du besoin, et elle n'est pas implémentée.
 *
 * Aucune migration : `expiresAt` est figé à la génération, donc les paliers
 * déjà en base gardent leur échéance courte, se régénèrent une dernière fois,
 * puis adoptent celle-ci.
 */
const PALIER_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Tout autre chose, malgré la valeur voisine : le quota d'UN élève sur UN
 * palier — au plus REGEN_HARD_CAP régénérations demandées par semaine. Borne un
 * enfant qui redemanderait des exercices sans fin ; ne périme rien.
 */
const REGEN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const REGEN_HARD_CAP = 3;

const classValidator = visibleClassValidator;

const exerciseTypeValidator = v.union(
  v.literal("qcm"),
  v.literal("drag-drop"),
  v.literal("match"),
  v.literal("order"),
  v.literal("short-answer"),
);

// ===========================================================================
// READ — bucket lookup
// ===========================================================================

export const getProfileByUserId = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
  },
});

/**
 * Check that a student has validated every palier from 1..palierIndex-1.
 * Returns the first missing (unvalidated) palier index, or null if all clear.
 */
export const checkPalierProgression = internalQuery({
  args: {
    profileId: v.id("profiles"),
    subjectId: v.id("subjects"),
    class: classValidator,
    topicId: v.id("topics"),
    palierIndex: v.number(),
  },
  handler: async (ctx, args): Promise<{ blockedAt: number } | null> => {
    if (args.palierIndex <= 1) return null;

    for (let i = 1; i < args.palierIndex; i++) {
      const palier = await ctx.db
        .query("paliers")
        .withIndex("by_bucket", (q) =>
          q
            .eq("subjectId", args.subjectId)
            .eq("class", args.class)
            .eq("topicId", args.topicId)
            .eq("palierIndex", i),
        )
        .unique();

      if (!palier) return { blockedAt: i };

      const attempts = await ctx.db
        .query("palierAttempts")
        .withIndex("by_user_palier", (q) =>
          q.eq("userId", args.profileId).eq("palierId", palier._id),
        )
        .collect();
      if (!attempts.some((a) => a.status === "validated")) return { blockedAt: i };
    }
    return null;
  },
});

/**
 * Find an existing palier row for (subjectId, class, topicId, palierIndex).
 * Returns null if not yet generated. Used both by queries (UI) and the action.
 */
export const findBucket = internalQuery({
  args: {
    subjectId: v.id("subjects"),
    class: classValidator,
    topicId: v.id("topics"),
    palierIndex: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("paliers")
      .withIndex("by_bucket", (q) =>
        q
          .eq("subjectId", args.subjectId)
          .eq("class", args.class)
          .eq("topicId", args.topicId)
          .eq("palierIndex", args.palierIndex),
      )
      .unique();
  },
});

/**
 * Public read: list exercises for a palier — projection-strict.
 * Strips `answerKey` and `hints` (Decision 61) and replaces `payload` with a
 * client-safe variant for types that would otherwise leak the answer.
 */
export const getExercisesForPalier = query({
  args: { palierAttemptId: v.id("palierAttempts") },
  handler: async (ctx, args) => {
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

    const attempt = await ctx.db.get(args.palierAttemptId);
    if (!attempt) return null;
    if (attempt.userId !== profile._id) return null; // ownership

    // Exos are attached either to the palier directly (initial) or to the
    // attempt (after regen — variations replace failed exos).
    const exosByAttempt = await ctx.db
      .query("exercises")
      .withIndex("by_palierAttemptId", (q) =>
        q.eq("palierAttemptId", args.palierAttemptId),
      )
      .take(50);
    const variationOriginalIds = new Set(
      exosByAttempt.map((e) => e.originalExerciseId).filter(Boolean) as Id<"exercises">[],
    );

    const palier = await ctx.db.get(attempt.palierId);
    if (!palier) return null;

    const exosByPalier = await ctx.db
      .query("exercises")
      .withIndex("by_palierId", (q) => q.eq("palierId", attempt.palierId))
      .take(50);

    // Final list: original exos minus those that were variation-replaced,
    // plus variation exos.
    const finalSet: Doc<"exercises">[] = [];
    for (const ex of exosByPalier) {
      if (!variationOriginalIds.has(ex._id)) finalSet.push(ex);
    }
    for (const ex of exosByAttempt) finalSet.push(ex);
    finalSet.sort((a, b) => a.order - b.order);

    return finalSet.map((ex) => stripAnswerFromExercise(ex, args.palierAttemptId));
  },
});

/**
 * LE LOT HORS-LIGNE — décisions D11, D14, D18, D19, D20.
 *
 * Le pendant de `getExercisesForPalier` pour un enfant qui va perdre le
 * réseau. Les deux fonctions vivent côte à côte À DESSEIN : elles décrivent le
 * MÊME exercice tel que l'enfant le voit, et l'une qui dériverait de l'autre
 * ferait jouer deux versions différentes selon la présence du réseau.
 *
 * L'APPELANT DOIT AVOIR CRÉÉ LA TENTATIVE AVANT (D14). C'est pourquoi ceci
 * prend un `palierAttemptId` et non un `palierId` : `sanitizePayload` sème son
 * mélange avec l'identifiant de la tentative, donc le lot ne peut pas se
 * construire sans elle. L'appareil enchaîne `startPalierAttempt` puis cette
 * requête — le même ordre qu'en ligne, et toute la garde de progression de
 * `startPalierAttempt` reste en vigueur, sans être dupliquée ici.
 *
 * CE QUE LE LOT AJOUTE À LA FORME EN LIGNE, ET RIEN D'AUTRE :
 *
 *   - `hints` — les textes, en entier. Ils descendent parce que `requestHint`
 *     ne passera pas hors ligne. Ils approchent la réponse sans la donner,
 *     exactement comme en ligne un par un (concession D20.3) ;
 *   - `verifier` — le sel et les empreintes des ATOMES acceptables, pour que
 *     l'appareil rende une coche verte sans détenir le corrigé (D11) ;
 *   - `accessValidUntil` — au-delà, l'appareil redemande le réseau avant de
 *     laisser commencer (D18).
 *
 * LE CORRIGÉ NE DESCEND TOUJOURS PAS. `stripAnswerFromExercise` est la même
 * fonction qu'en ligne ; seules des EMPREINTES s'y ajoutent.
 */
const OFFLINE_LEASE_MS = 14 * 24 * 60 * 60 * 1000;

export const getOfflineBundle = query({
  args: { palierAttemptId: v.id("palierAttempts") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId as string))
      .unique();
    if (!profile) return null;

    // On ne TÉLÉCHARGE pas quand l'accès est fermé. C'est cohérent avec D18,
    // qui protège le travail DÉJÀ FAIT : enregistrer toujours, ouvrir au cas
    // par cas. Ouvrir un nouveau lot est une ouverture.
    const access = await checkAccess(ctx, profile);
    if (!access.ok) return null;

    const attempt = await ctx.db.get(args.palierAttemptId);
    if (!attempt) return null;
    if (attempt.userId !== profile._id) return null;

    const exosByAttempt = await ctx.db
      .query("exercises")
      .withIndex("by_palierAttemptId", (q) =>
        q.eq("palierAttemptId", args.palierAttemptId),
      )
      .take(50);
    const variationOriginalIds = new Set(
      exosByAttempt
        .map((e) => e.originalExerciseId)
        .filter(Boolean) as Id<"exercises">[],
    );

    const exosByPalier = await ctx.db
      .query("exercises")
      .withIndex("by_palierId", (q) => q.eq("palierId", attempt.palierId))
      .take(50);

    const finalSet: Doc<"exercises">[] = [];
    for (const ex of exosByPalier) {
      if (!variationOriginalIds.has(ex._id)) finalSet.push(ex);
    }
    for (const ex of exosByAttempt) finalSet.push(ex);
    finalSet.sort((a, b) => a.order - b.order);

    const exercises = [];
    for (const ex of finalSet) {
      const salt = saltFor(args.palierAttemptId, ex._id);
      exercises.push({
        ...stripAnswerFromExercise(ex, args.palierAttemptId),
        hints: Array.isArray(ex.hints) ? ex.hints : [],
        verifier: {
          salt,
          digests: await buildDigests(ex.type, ex.payload, salt, sha256Hex),
        },
      });
    }

    return {
      palierAttemptId: args.palierAttemptId,
      // L'échéance la plus PROCHE des deux : on ne laisse pas un lot survivre
      // à l'abonnement de l'école, ni traîner deux mois sur une tablette.
      accessValidUntil: Math.min(access.endsAt, Date.now() + OFFLINE_LEASE_MS),
      exercises,
    };
  },
});

function stripAnswerFromExercise(
  ex: Doc<"exercises">,
  attemptId: Id<"palierAttempts">,
) {
  const safePayload = sanitizePayload(ex.type, ex.payload, ex._id, attemptId);
  return {
    _id: ex._id,
    type: ex.type,
    prompt: ex.prompt,
    payload: safePayload,
    hintsAvailable: Array.isArray(ex.hints) ? ex.hints.length : 0,
    palierAttemptId: attemptId,
    isVariation: ex.isVariation === true,
  };
}

/**
 * Build a client-safe payload that doesn't leak the answer.
 * Server-side deterministic shuffle (Decision 75) for match/order/drag-drop.
 */
function sanitizePayload(
  type: Doc<"exercises">["type"],
  payload: unknown,
  exerciseId: Id<"exercises">,
  attemptId: Id<"palierAttempts">,
): unknown {
  if (!payload || typeof payload !== "object") return {};
  const p = payload as Record<string, unknown>;

  switch (type) {
    case "qcm":
      return {
        options: p.options ?? [],
        // correctIndex stripped — submitted answers go through verifyAttempt
      };
    case "match": {
      const pairs = (p.pairs as Array<{ left: string; right: string }>) ?? [];
      const left = pairs.map((x) => x.left);
      const right = pairs.map((x) => x.right);
      // Shuffle right column with deterministic seed.
      const seed = `${attemptId}:${exerciseId}:right`;
      return { left, right: shuffleDeterministic(right, seed) };
    }
    case "order": {
      const seq = (p.correctSequence as string[]) ?? [];
      const seed = `${attemptId}:${exerciseId}:order`;
      return { items: shuffleDeterministic(seq, seed) };
    }
    case "drag-drop": {
      const items = (p.items as Array<{ text: string; correctZone: string }>) ?? [];
      const zones = (p.zones as string[]) ?? [];
      const seed = `${attemptId}:${exerciseId}:dd`;
      return {
        zones,
        items: shuffleDeterministic(
          items.map((it) => ({ text: it.text })),
          seed,
        ),
      };
    }
    case "short-answer":
      return {
        // No accepted answers exposed — verifyAttempt enforces.
        tolerance: p.tolerance ?? null,
      };
    default:
      return {};
  }
}

/**
 * Deterministic Fisher-Yates with a string-seeded PRNG (mulberry32 + FNV-1a).
 * Pure, no crypto imports. Decision 75.
 */
export function shuffleDeterministic<T>(arr: T[], seed: string): T[] {
  const rng = mulberry32(fnv1a(seed));
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// ===========================================================================
// MUTATIONS — palier row + exercises persistence
// ===========================================================================

export const upsertBucket = internalMutation({
  args: {
    subjectId: v.id("subjects"),
    class: classValidator,
    topicId: v.id("topics"),
    palierIndex: v.number(),
    status: v.union(
      v.literal("cached"),
      v.literal("stale"),
      v.literal("generating"),
    ),
    generationTraceId: v.optional(v.string()),
    qaStatus: v.optional(
      v.union(
        v.literal("auto_ok"),
        v.literal("pending_human"),
        v.literal("human_approved"),
        v.literal("rejected"),
      ),
    ),
    factCheckResults: v.optional(
      v.object({
        totalChecked: v.number(),
        divergences: v.number(),
      }),
    ),
    preGenerated: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("paliers")
      .withIndex("by_bucket", (q) =>
        q
          .eq("subjectId", args.subjectId)
          .eq("class", args.class)
          .eq("topicId", args.topicId)
          .eq("palierIndex", args.palierIndex),
      )
      .unique();

    const now = Date.now();
    const expiresAt = now + PALIER_TTL_MS;
    const shuffleSeed = `${args.topicId}-${args.class}-${args.palierIndex}-${now}`;

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: args.status,
        generatedAt: now,
        expiresAt,
        generationTraceId: args.generationTraceId,
        qaStatus: args.qaStatus,
        factCheckResults: args.factCheckResults,
        shuffleSeed,
        preGenerated: args.preGenerated,
      });
      return existing._id;
    }
    return await ctx.db.insert("paliers", {
      subjectId: args.subjectId,
      class: args.class,
      topicId: args.topicId,
      palierIndex: args.palierIndex,
      status: args.status,
      generatedAt: now,
      expiresAt,
      generationTraceId: args.generationTraceId,
      qaStatus: args.qaStatus,
      factCheckResults: args.factCheckResults,
      shuffleSeed,
      preGenerated: args.preGenerated,
    });
  },
});

export const insertGeneratedExercises = internalMutation({
  args: {
    palierId: v.id("paliers"),
    palierIndex: v.number(),
    topicId: v.id("topics"),
    exercises: v.array(
      v.object({
        type: exerciseTypeValidator,
        prompt: v.string(),
        payload: v.any(),
        answerKey: v.string(),
        hints: v.array(v.string()),
        order: v.number(),
        mathExpression: v.optional(v.union(v.string(), v.null())),
        needsManualReview: v.optional(v.boolean()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const ids: Id<"exercises">[] = [];
    const now = Date.now();
    for (const ex of args.exercises) {
      const id = await ctx.db.insert("exercises", {
        topicId: args.topicId,
        type: ex.type,
        prompt: ex.prompt,
        payload: ex.payload,
        answerKey: ex.answerKey,
        hints: ex.hints,
        order: ex.order,
        status: "published",
        version: 1,
        generatedBy: "ai",
        publishedAt: now,
        palierIndex: args.palierIndex,
        palierId: args.palierId,
        mathExpression: ex.mathExpression ?? undefined,
        needsManualReview: ex.needsManualReview === true,
      });
      ids.push(id);
    }
    return ids;
  },
});

export const replaceFailedWithVariations = internalMutation({
  args: {
    palierAttemptId: v.id("palierAttempts"),
    palierId: v.id("paliers"),
    topicId: v.id("topics"),
    variations: v.array(
      v.object({
        originalExerciseId: v.id("exercises"),
        type: exerciseTypeValidator,
        prompt: v.string(),
        payload: v.any(),
        answerKey: v.string(),
        hints: v.array(v.string()),
        order: v.number(),
        mathExpression: v.optional(v.union(v.string(), v.null())),
        needsManualReview: v.optional(v.boolean()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const ids: Id<"exercises">[] = [];
    for (const v of args.variations) {
      const id = await ctx.db.insert("exercises", {
        topicId: args.topicId,
        type: v.type,
        prompt: v.prompt,
        payload: v.payload,
        answerKey: v.answerKey,
        hints: v.hints,
        order: v.order,
        status: "published",
        version: 1,
        generatedBy: "ai",
        publishedAt: Date.now(),
        palierIndex: undefined,
        palierId: args.palierId,
        palierAttemptId: args.palierAttemptId,
        isVariation: true,
        originalExerciseId: v.originalExerciseId,
        mathExpression: v.mathExpression ?? undefined,
        needsManualReview: v.needsManualReview === true,
      });
      ids.push(id);
    }
    return ids;
  },
});

export const updateAttemptStatus = internalMutation({
  args: {
    palierAttemptId: v.id("palierAttempts"),
    status: v.union(
      v.literal("in_progress"),
      v.literal("validated"),
      v.literal("failed"),
      v.literal("regen_failed"),
      v.literal("abandoned"),
    ),
    averageScore: v.optional(v.number()),
    failedExerciseIds: v.optional(v.array(v.id("exercises"))),
    completedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = { status: args.status };
    if (args.averageScore !== undefined) patch.averageScore = args.averageScore;
    if (args.failedExerciseIds !== undefined) patch.failedExerciseIds = args.failedExerciseIds;
    if (args.completedAt !== undefined) patch.completedAt = args.completedAt;
    await ctx.db.patch(args.palierAttemptId, patch);
  },
});

export const upsertHistoryRegen = internalMutation({
  args: {
    userId: v.id("profiles"),
    palierId: v.id("paliers"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("palierAttemptHistory")
      .withIndex("by_user_palier", (q) =>
        q.eq("userId", args.userId).eq("palierId", args.palierId),
      )
      .unique();
    const now = Date.now();
    if (existing) {
      const within = now - existing.lastRegenAt < REGEN_WINDOW_MS;
      const newCount = within ? existing.regenCount + 1 : 1;
      await ctx.db.patch(existing._id, {
        regenCount: newCount,
        lastRegenAt: now,
      });
      return newCount;
    }
    await ctx.db.insert("palierAttemptHistory", {
      userId: args.userId,
      palierId: args.palierId,
      regenCount: 1,
      lastRegenAt: now,
      createdAt: now,
    });
    return 1;
  },
});

export const getRecentHistory = internalQuery({
  args: {
    userId: v.id("profiles"),
    palierId: v.id("paliers"),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("palierAttemptHistory")
      .withIndex("by_user_palier", (q) =>
        q.eq("userId", args.userId).eq("palierId", args.palierId),
      )
      .unique();
    if (!row) return null;
    const now = Date.now();
    if (now - row.lastRegenAt > REGEN_WINDOW_MS) {
      // Window expired — treat as zero.
      return { ...row, regenCount: 0 };
    }
    return row;
  },
});

// ===========================================================================
// ACTION — getBucket: lazy gen, validates JSON, persists, returns palier id.
// ===========================================================================

interface RawGenExercise {
  type: string;
  statement?: string;
  prompt?: string;
  payload?: unknown;
  correctAnswer?: unknown;
  mathExpression?: string | null;
  concept?: string;
  hints?: unknown;
}

interface RawGenResult {
  exercises: RawGenExercise[];
}

export const getBucket = action({
  args: {
    subjectId: v.id("subjects"),
    class: classValidator,
    topicId: v.id("topics"),
    palierIndex: v.number(),
  },
  handler: async (ctx, args): Promise<{
    palierId: Id<"paliers">;
    cacheHit: boolean;
    qaStatus: string;
  }> => {
    // Paywall (spec §5.4) — DOIT s'exécuter AVANT et EN DEHORS du bloc
    // `palierIndex > 1` ci-dessous. Ce bloc ne résout un profil que pour le
    // palier 2+, et son contrôle (checkPalierProgression) est pédagogique
    // — il vérifie la progression, pas le droit — pas financier. Le placer
    // à l'intérieur du bloc laisserait le palier 1 de chaque topic gratuit
    // pour tout le monde. Une action n'a pas de ctx.db : on résout le
    // profil de l'appelant via la requête interne (même motif que la
    // résolution un peu plus bas), puis on interroge getAccessStateForProfile
    // — la requête interne de la tâche 3.
    const callerUserId = await getAuthUserId(ctx);
    if (!callerUserId) throw new Error("Non authentifié");
    const callerProfile = await ctx.runQuery(
      internal.paliers.index.getProfileByUserId,
      { userId: callerUserId as string },
    );
    if (!callerProfile) throw new Error("Profil introuvable");
    const access = await ctx.runQuery(
      internal.access.getAccessStateForProfile,
      { profileId: callerProfile._id },
    );
    if (!access.ok) {
      throw new ConvexError({ code: "ACCESS_DENIED", reason: access.reason });
    }

    if (args.palierIndex > 1) {
      // `callerProfile` est déjà résolu ci-dessus : ce bloc refaisait
      // `getAuthUserId` + `getProfileByUserId` pour la MÊME session, soit une
      // résolution d'identité et un aller-retour de requête en trop sur le
      // chemin élève le plus chaud.
      const blocked = await ctx.runQuery(
        internal.paliers.index.checkPalierProgression,
        {
          profileId: callerProfile._id,
          subjectId: args.subjectId,
          class: args.class,
          topicId: args.topicId,
          palierIndex: args.palierIndex,
        },
      );
      if (blocked) {
        // `ConvexError` : cette phrase est écrite POUR L'ENFANT. En `Error`,
        // Convex l'occultait hors développement et l'écran n'en recevait qu'une
        // enveloppe — au point qu'il s'était doté d'une expression régulière
        // pour tenter de la désenvelopper. La rustine est partie avec la cause.
        throw new ConvexError(
          `Tu dois d'abord valider le palier ${blocked.blockedAt} avant de passer au suivant.`,
        );
      }
    }

    const existing = await ctx.runQuery(internal.paliers.index.findBucket, {
      subjectId: args.subjectId,
      class: args.class,
      topicId: args.topicId,
      palierIndex: args.palierIndex,
    });
    const now = Date.now();
    // `forceRegenerate` A DISPARU DES ARGUMENTS, il n'a pas été gardé.
    //
    // C'était un booléen PUBLIC qu'aucun écran n'envoyait : il n'existait que
    // comme surface d'attaque. Posé à `true`, il rendait cette branche de cache
    // INATTEIGNABLE, donc chaque appel relançait une génération `palier_base`
    // complète — l'appel le plus cher du produit. Avec `palierIndex: 1`, le
    // contrôle de progression est sauté par ailleurs, et rien ne limitait la
    // cadence : un seul compte en règle pouvait épuiser le budget IA MENSUEL de
    // toutes les écoles, le plafond budgétaire n'étant pas segmenté par école.
    //
    // Le régénérer à dessein reste possible et le restera : c'est `expiresAt`
    // qui décide, et la régénération personnalisée a sa propre voie
    // (`quotaScope: "system_regen"`, plus bas). Une fraîcheur ne se pilote pas
    // depuis le client.
    if (existing && existing.status === "cached" && existing.expiresAt > now) {
      return {
        palierId: existing._id,
        cacheHit: true,
        qaStatus: existing.qaStatus ?? "auto_ok",
      };
    }

    // Mark generating (or create row with status=generating).
    await ctx.runMutation(internal.paliers.index.upsertBucket, {
      subjectId: args.subjectId,
      class: args.class,
      topicId: args.topicId,
      palierIndex: args.palierIndex,
      status: "generating",
    });

    // Resolve subject + topic for prompt context.
    const subject = await ctx.runQuery(internal.paliers.index.getSubjectAndTopic, {
      subjectId: args.subjectId,
      topicId: args.topicId,
    });
    if (!subject || !subject.topic) {
      throw new Error("Subject or topic not found");
    }

    const systemPrompt = buildPalierBaseSystemPrompt({
      subject: subject.subjectName,
      topic: subject.topic.name,
      class: args.class,
      palierIndex: args.palierIndex,
    });
    const userPrompt = buildPalierBasePrompt({
      subject: subject.subjectName,
      topic: subject.topic.name,
      class: args.class,
      palierIndex: args.palierIndex,
    });

    const gen = await ctx.runAction(internal.aiGateway.index.generate, {
      purpose: "palier_base",
      prompt: userPrompt,
      systemPrompt,
      expectJson: true,
      // `userId` MANQUAIT, et c'est le plus gros dépensier du produit.
      //
      // `aiGateway.generate` saute son verrou d'accès quand `userId` est absent
      // — « aucun élève à vérifier, on laisse passer » — et n'impute alors la
      // dépense à personne, laissant `by_user_month` vide pour la génération de
      // paliers. Le paywall est bien contrôlé en tête de cette action, mais un
      // verrou qui ne couvre pas le plus gros dépensier ne vaut pas ce que sa
      // documentation promet.
      //
      // PAS DE `quotaScope` POUR AUTANT, à dessein : `kid_initiated` plafonne à
      // `dailyMoreLimitPerKid` (3 par jour), ce qui interdirait à un élève
      // d'ouvrir un quatrième palier dans sa journée. La cadence de CE chemin
      // est déjà bornée par le cache, pas par un quota.
      userId: callerProfile._id,
      metadata: {
        subjectId: args.subjectId,
        topicId: args.topicId,
        class: args.class,
        palierIndex: args.palierIndex,
      },
    });

    if (!gen.ok) {
      // Reset status — leave row as stale so retry can occur.
      await ctx.runMutation(internal.paliers.index.upsertBucket, {
        subjectId: args.subjectId,
        class: args.class,
        topicId: args.topicId,
        palierIndex: args.palierIndex,
        status: "stale",
      });
      throw new Error(gen.reason ?? "AI_GENERATION_FAILED");
    }

    const parsed = parseExercises(gen.result);
    const isMaths = subject.subjectName.toLowerCase().startsWith("math");
    const factCheck = isMaths
      ? verifyMathBatch(parsed)
      : {
          totalChecked: 0,
          divergences: 0,
          exos: parsed
            .map((ex, i) => toPersistedShape(ex, i))
            .filter((s): s is PersistedShape => s !== null),
        };

    // Persist palier row + exercises.
    const palierId: Id<"paliers"> = await ctx.runMutation(
      internal.paliers.index.upsertBucket,
      {
        subjectId: args.subjectId,
        class: args.class,
        topicId: args.topicId,
        palierIndex: args.palierIndex,
        status: "cached",
        generationTraceId: gen.traceId,
        qaStatus:
          factCheck.divergences > 0 && isMaths ? "pending_human" : "auto_ok",
        factCheckResults: {
          totalChecked: factCheck.totalChecked,
          divergences: factCheck.divergences,
        },
      },
    );

    await ctx.runMutation(internal.paliers.index.insertGeneratedExercises, {
      palierId,
      palierIndex: args.palierIndex,
      topicId: args.topicId,
      exercises: factCheck.exos,
    });

    return { palierId, cacheHit: false, qaStatus: factCheck.divergences > 0 && isMaths ? "pending_human" : "auto_ok" };
  },
});

export const getSubjectAndTopic = internalQuery({
  args: {
    subjectId: v.id("subjects"),
    topicId: v.id("topics"),
  },
  handler: async (ctx, args) => {
    const subject = await ctx.db.get(args.subjectId);
    const topic = await ctx.db.get(args.topicId);
    if (!subject || !topic) return null;
    return {
      subjectName: subject.name,
      topic: { _id: topic._id, name: topic.name },
    };
  },
});

// ===========================================================================
// ACTION — regenerateFailedExercises
// ===========================================================================

export const regenerateFailedExercises = action({
  args: {
    palierAttemptId: v.id("palierAttempts"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true; replacedCount: number; cumulativeRegens: number }
    | { ok: false; reason: string; kidMessage?: string }
  > => {
    // L'appelant est résolu depuis sa SESSION, jamais depuis les arguments :
    // `palierAttemptId` désigne une tentative, il ne prouve aucune identité.
    // Cette action dépense de la génération IA facturée à l'école et réécrit
    // les exercices de la tentative — le propriétaire de la tentative doit
    // donc être cet appelant. Une action n'a pas de ctx.db : le profil et le
    // droit d'accès passent par des requêtes internes.
    const callerUserId = await getAuthUserId(ctx);
    if (!callerUserId) {
      throw new ConvexError({
        code: "ACCESS_DENIED",
        reason: "not_authenticated",
      });
    }
    const callerProfile = await ctx.runQuery(
      internal.paliers.index.getProfileByUserId,
      { userId: callerUserId },
    );
    if (!callerProfile) {
      throw new ConvexError({
        code: "ACCESS_DENIED",
        reason: "not_authenticated",
      });
    }

    const ctxData = await ctx.runQuery(internal.paliers.index.loadRegenContext, {
      palierAttemptId: args.palierAttemptId,
    });
    if (!ctxData) {
      return { ok: false, reason: "ATTEMPT_NOT_FOUND" };
    }

    const { attempt, palier, topic, subject, failed } = ctxData;

    // Propriété : la tentative doit appartenir à l'appelant. Sans cette garde,
    // un identifiant de tentative valide suffisait à déclencher une dépense IA
    // sur le compte d'autrui.
    if (attempt.userId !== callerProfile._id) {
      throw new ConvexError({ code: "ACCESS_DENIED", reason: "not_owner" });
    }

    // Paywall (spec §5.4) — évalué sur le profil de l'appelant, désormais
    // prouvé propriétaire de la tentative.
    const access = await ctx.runQuery(internal.access.getAccessStateForProfile, {
      profileId: callerProfile._id,
    });
    if (!access.ok) {
      throw new ConvexError({ code: "ACCESS_DENIED", reason: access.reason });
    }

    if (failed.length === 0) {
      return { ok: false, reason: "NO_FAILED_EXOS" };
    }

    // Cumulative regen cap (Decision 60).
    const history = await ctx.runQuery(
      internal.paliers.index.getRecentHistory,
      { userId: attempt.userId, palierId: attempt.palierId },
    );
    const cumulative = history?.regenCount ?? 0;
    if (cumulative >= REGEN_HARD_CAP) {
      await ctx.runMutation(internal.paliers.index.scheduleRegenNotification, {
        studentId: attempt.userId,
        palierId: attempt.palierId,
        studentName: ctxData.studentName ?? "Votre enfant",
        topicName: topic.name,
        subjectName: subject.name,
      });
      return {
        ok: false,
        reason: "REGEN_CAP_REACHED",
        kidMessage: "On t'a vu galérer 💪. Voici trois pistes pour t'en sortir.",
      };
    }

    // ─────────────────────────────────────────────────────────────────────
    // CONSENTEMENT IA (tâche 6.4) — les deux invites construites ci-dessous
    // portent `studentAnswer`, c'est-à-dire ce que l'enfant a VRAIMENT écrit
    // sur chaque exercice raté. La garde se pose donc avant de les construire.
    //
    // ON NE LÈVE PAS : cette action rend déjà `{ ok: false, kidMessage }` sur
    // ses autres refus (plafond de régénération), et l'écran sait l'afficher.
    // Le refus emprunte le même chemin plutôt que d'en inventer un.
    const consent = await ctx.runQuery(
      internal.access.getAiConsentForProfile,
      { profileId: callerProfile._id },
    );
    if (!consent.allowed) {
      return {
        ok: false,
        reason: "AI_CONSENT_MISSING",
        kidMessage: AI_CONSENT_KID_MESSAGE,
      };
    }

    const systemPrompt = buildVariationSystemPrompt({
      class: assertVisibleClass(palier.class),
      failed: failed.map((f) => ({
        concept: f.concept,
        statement: f.statement,
        correctAnswer: f.correctAnswer,
        studentAnswer: f.studentAnswer,
      })),
      subject: subject.name,
      topic: topic.name,
    });
    const userPrompt = buildVariationPrompt({
      class: assertVisibleClass(palier.class),
      failed: failed.map((f) => ({
        concept: f.concept,
        statement: f.statement,
        correctAnswer: f.correctAnswer,
        studentAnswer: f.studentAnswer,
      })),
      subject: subject.name,
      topic: topic.name,
    });

    const gen = await ctx.runAction(internal.aiGateway.index.generate, {
      purpose: "palier_personalized",
      prompt: userPrompt,
      systemPrompt,
      expectJson: true,
      userId: attempt.userId,
      quotaScope: "system_regen",
      metadata: {
        palierAttemptId: args.palierAttemptId,
        regen: true,
      },
    });

    if (!gen.ok) {
      await ctx.runMutation(internal.paliers.index.updateAttemptStatus, {
        palierAttemptId: args.palierAttemptId,
        status: "regen_failed",
      });
      return {
        ok: false,
        reason: gen.reason ?? "AI_GENERATION_FAILED",
        kidMessage: gen.kidMessage,
      };
    }

    const parsed = parseExercises(gen.result);
    if (parsed.length === 0) {
      return { ok: false, reason: "EMPTY_VARIATIONS" };
    }
    const isMaths = subject.name.toLowerCase().startsWith("math");
    const factCheck = isMaths
      ? verifyMathBatch(parsed)
      : {
          totalChecked: 0,
          divergences: 0,
          exos: parsed
            .map((ex, i) => toPersistedShape(ex, i))
            .filter((s): s is PersistedShape => s !== null),
        };

    // Pair variations with originals (1-to-1, in order).
    const variations = factCheck.exos.slice(0, failed.length).map((v, i) => ({
      ...v,
      originalExerciseId: failed[i].exerciseId as Id<"exercises">,
    }));

    await ctx.runMutation(internal.paliers.index.replaceFailedWithVariations, {
      palierAttemptId: args.palierAttemptId,
      palierId: attempt.palierId,
      topicId: topic._id,
      variations,
    });

    const newCount: number = await ctx.runMutation(
      internal.paliers.index.upsertHistoryRegen,
      { userId: attempt.userId, palierId: attempt.palierId },
    );

    await ctx.runMutation(internal.paliers.index.updateAttemptStatus, {
      palierAttemptId: args.palierAttemptId,
      status: "in_progress",
    });

    return { ok: true, replacedCount: variations.length, cumulativeRegens: newCount };
  },
});

export const loadRegenContext = internalQuery({
  args: { palierAttemptId: v.id("palierAttempts") },
  handler: async (ctx, args) => {
    const attempt = await ctx.db.get(args.palierAttemptId);
    if (!attempt) return null;
    const palier = await ctx.db.get(attempt.palierId);
    if (!palier) return null;
    const topic = await ctx.db.get(palier.topicId);
    const subject = await ctx.db.get(palier.subjectId);
    if (!topic || !subject) return null;
    const studentProfile = await ctx.db.get(attempt.userId);

    // Failed exos = palierAttempt.failedExerciseIds
    const failedIds = attempt.failedExerciseIds ?? [];
    const failed: Array<{
      exerciseId: Id<"exercises">;
      concept: string;
      statement: string;
      correctAnswer: string;
      studentAnswer: string;
    }> = [];
    for (const exoId of failedIds) {
      const exo = await ctx.db.get(exoId);
      if (!exo) continue;
      // Pick the most recent attempt's submitted answer.
      const attempts = await ctx.db
        .query("attempts")
        .withIndex("by_palierAttempt_exercise", (q) =>
          q.eq("palierAttemptId", args.palierAttemptId).eq("exerciseId", exoId),
        )
        .take(100);
      const last = attempts.sort((a, b) => b.submittedAt - a.submittedAt)[0];
      failed.push({
        exerciseId: exoId,
        concept: extractConcept(exo) ?? topic.name,
        statement: exo.prompt,
        correctAnswer: exo.answerKey,
        studentAnswer: last?.submittedAnswer ?? "(pas de réponse)",
      });
    }

    return {
      attempt: {
        _id: attempt._id,
        userId: attempt.userId,
        palierId: attempt.palierId,
      },
      palier: { _id: palier._id, class: palier.class },
      topic: { _id: topic._id, name: topic.name },
      subject: { _id: subject._id, name: subject.name },
      studentName: studentProfile?.name ?? null,
      failed,
    };
  },
});

// ===========================================================================
// PUBLIC MUTATION — start a palier attempt
// ===========================================================================

export const startPalierAttempt = mutation({
  args: { palierId: v.id("paliers") },
  handler: async (ctx, args): Promise<Id<"palierAttempts">> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Non authentifié");
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId as string))
      .unique();
    if (!profile) throw new Error("Profil introuvable");

    // Paywall (spec §5.4) — une mutation lève, l'appelant attrape.
    await requireAccess(ctx, profile);

    const palier = await ctx.db.get(args.palierId);
    if (!palier) throw new Error("Palier introuvable");

    if (palier.palierIndex > 1) {
      for (let i = 1; i < palier.palierIndex; i++) {
        const prev = await ctx.db
          .query("paliers")
          .withIndex("by_bucket", (q) =>
            q
              .eq("subjectId", palier.subjectId)
              .eq("class", palier.class)
              .eq("topicId", palier.topicId)
              .eq("palierIndex", i),
          )
          .unique();

        if (!prev) {
          throw new Error(
            `Tu dois d'abord valider le palier ${i} avant de passer au suivant.`,
          );
        }

        const prevAttempts = await ctx.db
          .query("palierAttempts")
          .withIndex("by_user_palier", (q) =>
            q.eq("userId", profile._id).eq("palierId", prev._id),
          )
          .collect();
        if (!prevAttempts.some((a) => a.status === "validated")) {
          throw new Error(
            `Tu dois d'abord valider le palier ${i} avant de passer au suivant.`,
          );
        }
      }
    }

    const inProgressAttempts = (
      await ctx.db
        .query("palierAttempts")
        .withIndex("by_user_palier", (q) =>
          q.eq("userId", profile._id).eq("palierId", args.palierId),
        )
        .collect()
    ).filter((attempt) => attempt.status === "in_progress");

    if (inProgressAttempts.length > 0) {
      let best = inProgressAttempts[0];
      let bestActivityCount = -1;
      for (const attempt of inProgressAttempts) {
        const activity = await ctx.db
          .query("attempts")
          .withIndex("by_palierAttemptId", (q) =>
            q.eq("palierAttemptId", attempt._id),
          )
          .take(100);
        const activityCount = activity.length;
        if (
          activityCount > bestActivityCount ||
          (activityCount === bestActivityCount &&
            attempt.startedAt > best.startedAt)
        ) {
          best = attempt;
          bestActivityCount = activityCount;
        }
      }
      return best._id;
    }

    return await ctx.db.insert("palierAttempts", {
      userId: profile._id,
      palierId: args.palierId,
      startedAt: Date.now(),
      status: "in_progress",
      regenCount: 0,
    });
  },
});

// ===========================================================================
// INTERNAL — Parent notification on regen cap (Decision 88/96)
// ===========================================================================

const TWENTY_FOUR_H = 24 * 60 * 60 * 1000;

export const scheduleRegenNotification = internalMutation({
  args: {
    studentId: v.id("profiles"),
    palierId: v.id("paliers"),
    studentName: v.string(),
    topicName: v.string(),
    subjectName: v.string(),
  },
  handler: async (ctx, args) => {
    const history = await ctx.db
      .query("palierAttemptHistory")
      .withIndex("by_user_palier", (q) =>
        q.eq("userId", args.studentId).eq("palierId", args.palierId),
      )
      .unique();

    if (
      history?.parentNotifiedAt &&
      Date.now() - history.parentNotifiedAt < TWENTY_FOUR_H
    ) {
      return;
    }

    await ctx.scheduler.runAfter(
      0,
      internal.regenNotificationEmail.sendRegenCapEmail,
      {
        studentId: args.studentId,
        studentName: args.studentName,
        topicName: args.topicName,
        subjectName: args.subjectName,
      },
    );
  },
});

export const markParentNotified = internalMutation({
  args: { studentId: v.id("profiles") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("palierAttemptHistory")
      .withIndex("by_user_palier", (q) => q.eq("userId", args.studentId))
      .take(50);
    for (const row of rows) {
      if (!row.parentNotifiedAt || Date.now() - row.parentNotifiedAt > TWENTY_FOUR_H) {
        await ctx.db.patch(row._id, { parentNotifiedAt: Date.now() });
      }
    }
  },
});

export const getParentNotifSetting = internalQuery({
  args: {
    parentId: v.id("profiles"),
    kidId: v.id("profiles"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("parentSettings")
      .withIndex("by_parent_kid", (q) =>
        q.eq("parentId", args.parentId).eq("kidId", args.kidId),
      )
      .unique();
  },
});

// ===========================================================================
// HELPERS — JSON parsing + math fact-check
// ===========================================================================

function parseExercises(raw: unknown): RawGenExercise[] {
  if (!raw || typeof raw !== "object") return [];
  const r = raw as Partial<RawGenResult>;
  if (!Array.isArray(r.exercises)) return [];
  return r.exercises;
}

interface PersistedShape {
  type: "qcm" | "drag-drop" | "match" | "order" | "short-answer";
  prompt: string;
  payload: unknown;
  answerKey: string;
  hints: string[];
  order: number;
  mathExpression?: string | null;
  needsManualReview?: boolean;
}

function validatePayload(
  type: PersistedShape["type"],
  raw: unknown,
): { valid: boolean; payload: unknown } {
  if (!raw || typeof raw !== "object") return { valid: false, payload: raw };
  const p = raw as Record<string, unknown>;

  switch (type) {
    case "qcm": {
      const opts = Array.isArray(p.options) ? p.options.filter((o): o is string => typeof o === "string") : [];
      if (opts.length < 2) return { valid: false, payload: raw };
      if (typeof p.correctIndex !== "number" || p.correctIndex < 0 || p.correctIndex >= opts.length) return { valid: false, payload: raw };
      return { valid: true, payload: { ...p, options: opts } };
    }
    case "match": {
      const pairs = Array.isArray(p.pairs)
        ? p.pairs.filter(
            (pair): pair is { left: string; right: string } =>
              !!pair && typeof pair === "object" && typeof (pair as Record<string, unknown>).left === "string" && typeof (pair as Record<string, unknown>).right === "string",
          )
        : [];
      if (pairs.length < 2) return { valid: false, payload: raw };
      return { valid: true, payload: { ...p, pairs } };
    }
    case "order": {
      const seq = Array.isArray(p.correctSequence) ? p.correctSequence.filter((s): s is string => typeof s === "string") : [];
      if (seq.length < 2) return { valid: false, payload: raw };
      return { valid: true, payload: { ...p, correctSequence: seq } };
    }
    case "drag-drop": {
      const zones = Array.isArray(p.zones) ? p.zones.filter((z): z is string => typeof z === "string") : [];
      const items = Array.isArray(p.items)
        ? p.items.filter(
            (it): it is { text: string; correctZone: string } =>
              !!it && typeof it === "object" && typeof (it as Record<string, unknown>).text === "string" && typeof (it as Record<string, unknown>).correctZone === "string",
          )
        : [];
      if (zones.length < 2 || items.length < 2) return { valid: false, payload: raw };
      return { valid: true, payload: { ...p, zones, items } };
    }
    case "short-answer": {
      const accepted = Array.isArray(p.acceptedAnswers) ? p.acceptedAnswers.filter((a): a is string => typeof a === "string") : [];
      if (accepted.length === 0) return { valid: false, payload: raw };
      return { valid: true, payload: { ...p, acceptedAnswers: accepted } };
    }
    default:
      return { valid: false, payload: raw };
  }
}

function toPersistedShape(ex: RawGenExercise, idx?: number): PersistedShape | null {
  const t = (ex.type ?? "short-answer") as PersistedShape["type"];
  const allowed: PersistedShape["type"][] = [
    "qcm",
    "drag-drop",
    "match",
    "order",
    "short-answer",
  ];
  const safeType = allowed.includes(t) ? t : "short-answer";
  const prompt = ex.statement ?? ex.prompt ?? "";
  if (!prompt) return null;

  const { valid, payload } = validatePayload(safeType, ex.payload ?? {});
  if (!valid) return null;

  const answerKey = typeof ex.correctAnswer === "string" ? ex.correctAnswer : String(ex.correctAnswer ?? "");
  if (!answerKey) return null;

  const hintsArr = Array.isArray(ex.hints) ? (ex.hints as unknown[]).map(String) : [];
  return {
    type: safeType,
    prompt,
    payload,
    answerKey,
    hints: hintsArr.slice(0, 3),
    order: typeof idx === "number" ? idx + 1 : 1,
    mathExpression: ex.mathExpression ?? null,
    needsManualReview: false,
  };
}

function verifyMathBatch(parsed: RawGenExercise[]): {
  totalChecked: number;
  divergences: number;
  exos: PersistedShape[];
} {
  let totalChecked = 0;
  let divergences = 0;
  const exos: PersistedShape[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const raw = parsed[i];
    const shape = toPersistedShape(raw, i);
    if (!shape) continue;
    if (raw.mathExpression) {
      totalChecked++;
      const result = checkMathExercise(raw.mathExpression, shape.answerKey);
      if (!result.ok) {
        divergences++;
        shape.needsManualReview = true;
      }
    }
    exos.push(shape);
  }
  return { totalChecked, divergences, exos };
}

function extractConcept(exo: Doc<"exercises">): string | null {
  const p = exo.payload as Record<string, unknown> | undefined;
  if (p && typeof p.concept === "string") return p.concept;
  return null;
}

// Avoid unused import warning when computeExerciseScore is only referenced in tests.
export const _scoringRef = computeExerciseScore;
