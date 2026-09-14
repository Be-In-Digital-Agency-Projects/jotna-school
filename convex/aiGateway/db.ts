/**
 * AI Gateway — DB-only helpers (queries + mutations).
 *
 * Lives in the default V8 Convex runtime. The `index.ts` action ("use node")
 * cannot host these because Convex forbids mixing `internalMutation` /
 * `internalQuery` with `"use node"`.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";

const purposeValidator = v.union(
  v.literal("palier_base"),
  v.literal("palier_personalized"),
  v.literal("verify_short_answer"),
  v.literal("explain_mistake"),
  v.literal("verify_math"),
);

export const getMonthSpend = internalQuery({
  args: { month: v.string() },
  handler: async (ctx, { month }) => {
    const rows = await ctx.db
      .query("aiUsage")
      .withIndex("by_month_status", (q) =>
        q.eq("month", month).eq("status", "ok"),
      )
      .take(1000);
    let total = 0;
    for (const r of rows) total += r.costUsd;
    return total;
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

export const recordUsage = internalMutation({
  args: {
    userId: v.optional(v.id("profiles")),
    purpose: purposeValidator,
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
    return await ctx.db.insert("aiUsage", {
      ...args,
      createdAt: Date.now(),
    });
  },
});
