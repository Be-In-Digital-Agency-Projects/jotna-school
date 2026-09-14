/**
 * Paliers — bucket lifecycle (cache + lazy gen) + regen orchestration.
 *
 * Decisions: 3, 9, 10, 46, 50, 52, 53, 56, 60, 71, 75, 77, 78.
 */

import { v } from "convex/values";
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
  buildPalierBasePrompt,
  buildPalierBaseSystemPrompt,
  buildVariationPrompt,
  buildVariationSystemPrompt,
} from "./prompts";
import { checkMathExercise } from "../aiGateway/factCheck";
import { computeExerciseScore } from "./scoring";
import { getAuthUserId } from "@convex-dev/auth/server";
import { checkAccess, requireAccess } from "../access";

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const REGEN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const REGEN_HARD_CAP = 3;

const classValidator = v.union(
  v.literal("CI"),
  v.literal("CP"),
  v.literal("CE1"),
  v.literal("CE2"),
  v.literal("CM1"),
  v.literal("CM2"),
);

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
    const expiresAt = now + ONE_WEEK_MS;
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
    forceRegenerate: v.optional(v.boolean()),
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
      throw new Error(`ACCESS_DENIED:${access.reason}`);
    }

    if (args.palierIndex > 1) {
      const authUserId = await getAuthUserId(ctx);
      if (!authUserId) throw new Error("Non authentifié");
      const profile = await ctx.runQuery(
        internal.paliers.index.getProfileByUserId,
        { userId: authUserId as string },
      );
      if (!profile) throw new Error("Profil introuvable");
      const blocked = await ctx.runQuery(
        internal.paliers.index.checkPalierProgression,
        {
          profileId: profile._id,
          subjectId: args.subjectId,
          class: args.class,
          topicId: args.topicId,
          palierIndex: args.palierIndex,
        },
      );
      if (blocked) {
        throw new Error(
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
    if (
      existing &&
      existing.status === "cached" &&
      existing.expiresAt > now &&
      args.forceRegenerate !== true
    ) {
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
    const ctxData = await ctx.runQuery(internal.paliers.index.loadRegenContext, {
      palierAttemptId: args.palierAttemptId,
    });
    if (!ctxData) {
      return { ok: false, reason: "ATTEMPT_NOT_FOUND" };
    }

    const { attempt, palier, topic, subject, failed } = ctxData;

    // Paywall (spec §5.4) — cette action ne résout aucun profil appelant :
    // l'élève dont il faut vérifier le droit est le PROPRIÉTAIRE de la
    // tentative (attempt.userId), pas un appelant résolu par getAuthUserId.
    // Une action n'a pas de ctx.db, d'où le passage par la requête interne.
    const access = await ctx.runQuery(internal.access.getAccessStateForProfile, {
      profileId: attempt.userId,
    });
    if (!access.ok) {
      throw new Error(`ACCESS_DENIED:${access.reason}`);
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

    const systemPrompt = buildVariationSystemPrompt({
      class: palier.class,
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
      class: palier.class,
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
