/**
 * AI Gateway — DB-only helpers (queries + mutations).
 *
 * Lives in the default V8 Convex runtime. The `index.ts` action ("use node")
 * cannot host these because Convex forbids mixing `internalMutation` /
 * `internalQuery` with `"use node"`.
 */

import { v } from "convex/values";
import type {
  DatabaseReader,
  DatabaseWriter,
} from "../_generated/server";
import { internalMutation, internalQuery } from "../_generated/server";
import {
  addSpendCounters,
  emptySpendCounters,
  foldSpendShards,
  pickSpendShard,
  SPEND_SHARD_COUNT,
  type SpendCounters,
  usageDelta,
} from "./spendShards";

/** Usages routés par `aiGateway.generate`. */
const purposeValidator = v.union(
  v.literal("palier_base"),
  v.literal("palier_personalized"),
  v.literal("verify_short_answer"),
  v.literal("explain_mistake"),
  v.literal("verify_math"),
);

/**
 * Usages qui dépensent, donc qui se comptent. Sur-ensemble du précédent :
 * `pdf_extract` ne passe pas par la passerelle mais paie quand même.
 */
const usagePurposeValidator = v.union(
  purposeValidator,
  v.literal("pdf_extract"),
);

/**
 * Lit l'agrégat du mois : au plus `SPEND_SHARD_COUNT` documents, quel que
 * soit le nombre d'appels IA passés dans le mois.
 *
 * La borne du `.take` n'est pas un espoir, c'est l'invariante de la table :
 * il ne peut pas exister plus de `SPEND_SHARD_COUNT` lignes pour un mois
 * (voir `spendShards.ts`). Aucune troncature possible, donc.
 */
export async function readMonthSpend(
  db: DatabaseReader,
  month: string,
): Promise<SpendCounters> {
  const shards = await db
    .query("aiSpendShards")
    .withIndex("by_month_shard", (q) => q.eq("month", month))
    .take(SPEND_SHARD_COUNT);
  return foldSpendShards(shards);
}

/**
 * Ajoute une ligne d'usage à l'agrégat, dans la transaction de l'appelant.
 *
 * L'écriture vise un seul fragment tiré au sort : deux écritures concurrentes
 * qui tombent sur des fragments différents lisent des points d'index
 * disjoints et ne se conflictent pas. `.unique()` ne peut pas lever ici —
 * l'index (month, shard) et la sérialisabilité des mutations Convex
 * garantissent au plus une ligne par couple — mais s'il levait, ce serait le
 * bon comportement : une mutation lève, et l'invariante serait rompue.
 */
async function addToMonthSpend(
  db: DatabaseWriter,
  month: string,
  delta: SpendCounters,
): Promise<void> {
  const shard = pickSpendShard(Math.random());
  const existing = await db
    .query("aiSpendShards")
    .withIndex("by_month_shard", (q) =>
      q.eq("month", month).eq("shard", shard),
    )
    .unique();
  const merged = addSpendCounters(existing ?? emptySpendCounters(), delta);
  if (existing) {
    await db.patch(existing._id, { ...merged, updatedAt: Date.now() });
    return;
  }
  await db.insert("aiSpendShards", {
    month,
    shard,
    ...merged,
    updatedAt: Date.now(),
  });
}

export const getMonthSpend = internalQuery({
  args: { month: v.string() },
  handler: async (ctx, { month }) => {
    const totals = await readMonthSpend(ctx.db, month);
    return totals.costUsd;
  },
});

export const getSettings = internalQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("settings")
      .withIndex("by_singleton", (q) => q.eq("singleton", "settings"))
      .unique();
    return row ?? null;
  },
});

export const ensureSettings = internalMutation({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("settings")
      .withIndex("by_singleton", (q) => q.eq("singleton", "settings"))
      .unique();
    if (row) return row._id;
    return await ctx.db.insert("settings", {
      singleton: "settings",
      aiMonthlyBudgetUsd: 100,
      economyMode: false,
      dailyMoreLimitPerKid: 3,
      modelOverrides: undefined,
      updatedAt: Date.now(),
    });
  },
});

export const getUserDailyQuota = internalQuery({
  args: {
    userId: v.id("profiles"),
    scope: v.union(v.literal("kid_initiated"), v.literal("system_regen")),
    dayKey: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("aiUserQuota")
      .withIndex("by_user_scope_day", (q) =>
        q.eq("userId", args.userId).eq("quotaScope", args.scope).eq("dayKey", args.dayKey),
      )
      .unique();
    return row?.count ?? 0;
  },
});

export const incrementUserDailyQuota = internalMutation({
  args: {
    userId: v.id("profiles"),
    scope: v.union(v.literal("kid_initiated"), v.literal("system_regen")),
    purpose: purposeValidator,
    dayKey: v.string(),
    resetAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("aiUserQuota")
      .withIndex("by_user_scope_day", (q) =>
        q.eq("userId", args.userId).eq("quotaScope", args.scope).eq("dayKey", args.dayKey),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { count: existing.count + 1 });
      return existing.count + 1;
    }
    await ctx.db.insert("aiUserQuota", {
      userId: args.userId,
      purpose: args.purpose,
      quotaScope: args.scope,
      count: 1,
      dayKey: args.dayKey,
      resetAt: args.resetAt,
    });
    return 1;
  },
});

export const decrementUserDailyQuota = internalMutation({
  args: {
    userId: v.id("profiles"),
    scope: v.union(v.literal("kid_initiated"), v.literal("system_regen")),
    dayKey: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("aiUserQuota")
      .withIndex("by_user_scope_day", (q) =>
        q.eq("userId", args.userId).eq("quotaScope", args.scope).eq("dayKey", args.dayKey),
      )
      .unique();
    if (existing && existing.count > 0) {
      await ctx.db.patch(existing._id, { count: existing.count - 1 });
    }
  },
});

/**
 * Enregistre un appel IA : la ligne de télémétrie ET l'agrégat du mois, dans
 * la même transaction. Ils ne peuvent donc pas diverger — c'est la propriété
 * qui rend l'agrégat digne de porter le plafond.
 */
export const recordUsage = internalMutation({
  args: {
    userId: v.optional(v.id("profiles")),
    purpose: usagePurposeValidator,
    modelUsed: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    costUsd: v.number(),
    latencyMs: v.number(),
    status: v.union(
      v.literal("ok"),
      v.literal("failed"),
      v.literal("rejected_budget"),
      v.literal("rejected_quota"),
      v.literal("rejected_access"),
    ),
    traceId: v.string(),
    metadata: v.optional(v.any()),
    month: v.string(),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("aiUsage", {
      ...args,
      createdAt: Date.now(),
    });
    await addToMonthSpend(
      ctx.db,
      args.month,
      usageDelta({
        status: args.status,
        purpose: args.purpose,
        costUsd: args.costUsd,
      }),
    );
    return id;
  },
});
