"use node";

import { v } from "convex/values";
import OpenAI from "openai";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  type AiPurpose,
  ALL_PURPOSES,
  estimateCostUsd,
  getPurposeConfig,
  resolveModel,
} from "./registry";
import { evaluateBudget } from "./budget";
import { dayKey, endOfDayUtc, evaluateQuota, type QuotaScope } from "./quota";

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

const purposeValidator = v.union(
  v.literal("palier_base"),
  v.literal("palier_personalized"),
  v.literal("verify_short_answer"),
  v.literal("explain_mistake"),
  v.literal("verify_math"),
);

const quotaScopeValidator = v.union(
  v.literal("kid_initiated"),
  v.literal("system_regen"),
  v.literal("system"),
);

interface GenerateResult {
  ok: boolean;
  result?: unknown;
  traceId: string;
  modelUsed?: string;
  costUsd?: number;
  latencyMs?: number;
  reason?: string;
  kidMessage?: string;
}

// ---------------------------------------------------------------------------
// Public action: aiGateway.generate
// ---------------------------------------------------------------------------

export const generate = internalAction({
  args: {
    purpose: purposeValidator,
    prompt: v.string(),
    systemPrompt: v.optional(v.string()),
    expectJson: v.optional(v.boolean()),
    userId: v.optional(v.id("profiles")),
    quotaScope: v.optional(quotaScopeValidator),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args): Promise<GenerateResult> => {
    const traceId = `tr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const purpose = args.purpose as AiPurpose;
    const cfg = getPurposeConfig(purpose);
    const month = currentMonthKey();
    const dKey = dayKey();
    const scope: QuotaScope | "system" = args.quotaScope ?? "system";

    // 1) Settings (auto-init).
    await ctx.runMutation(internal.aiGateway.db.ensureSettings, {});
    const settings = await ctx.runQuery(internal.aiGateway.db.getSettings, {});
    if (!settings) {
      return { ok: false, traceId, reason: "SETTINGS_MISSING" };
    }

    // 1bis) Droit d'accès — verrou sur la dépense.
    //
    // generate est le seul chemin par lequel de l'argent se dépense. Le
    // contrôle est ici pour qu'une fonction future qui oublierait son propre
    // contrôle d'entrée ne puisse pas facturer une école qui n'a pas payé.
    //
    // Sans userId, l'appel est système ou administrateur : aucun élève à
    // vérifier, on laisse passer.
    if (args.userId) {
      const access = await ctx.runQuery(
        internal.access.getAccessStateForProfile,
        { profileId: args.userId },
      );
      if (!access.ok) {
        await ctx.runMutation(internal.aiGateway.db.recordUsage, {
          userId: args.userId,
          purpose,
          modelUsed: cfg.defaultModel,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          latencyMs: 0,
          status: "rejected_access",
          traceId,
          month,
          errorMessage: `access:${access.reason}`,
        });
        return { ok: false, traceId, reason: "NO_ACCESS" };
      }
    }

    // 2) Daily quota (kid_initiated only — system_regen is unbounded here).
    if (args.userId && (scope === "kid_initiated" || scope === "system_regen")) {
      const currentCount: number = await ctx.runQuery(
        internal.aiGateway.db.getUserDailyQuota,
        { userId: args.userId, scope, dayKey: dKey },
      );
      const decision = evaluateQuota({
        scope,
        currentCount,
        dailyCap: settings.dailyMoreLimitPerKid,
      });
      if (!decision.allowed) {
        await ctx.runMutation(internal.aiGateway.db.recordUsage, {
          userId: args.userId,
          purpose,
          modelUsed: cfg.defaultModel,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          latencyMs: 0,
          status: "rejected_quota",
          traceId,
          metadata: args.metadata,
          month,
          errorMessage: decision.reason,
        });
        return {
          ok: false,
          traceId,
          reason: decision.reason,
          kidMessage: decision.kidMessage,
        };
      }
    }

    // 3) Budget enforcement.
    const spendUsd: number = await ctx.runQuery(
      internal.aiGateway.db.getMonthSpend,
      { month },
    );
    const budgetDecision = evaluateBudget(purpose, scope, {
      spendUsd,
      budgetUsd: settings.aiMonthlyBudgetUsd,
      economyForced: settings.economyMode,
    });
    if (!budgetDecision.allowed) {
      await ctx.runMutation(internal.aiGateway.db.recordUsage, {
        userId: args.userId,
        purpose,
        modelUsed: cfg.defaultModel,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        latencyMs: 0,
        status: "rejected_budget",
        traceId,
        metadata: { ...(args.metadata ?? {}), tier: budgetDecision.tier },
        month,
        errorMessage: budgetDecision.reason,
      });
      return {
        ok: false,
        traceId,
        reason: budgetDecision.reason,
        kidMessage: budgetDecision.kidMessage,
      };
    }

    // 4) Resolve model + economy-mode token cap.
    const resolved = resolveModel(
      purpose,
      settings.modelOverrides ?? undefined,
      budgetDecision.applyEconomy,
    );

    // 5) Increment quota counter BEFORE the network call, decrement on failure.
    if (args.userId && scope === "kid_initiated") {
      await ctx.runMutation(internal.aiGateway.db.incrementUserDailyQuota, {
        userId: args.userId,
        scope,
        purpose,
        dayKey: dKey,
        resetAt: endOfDayUtc(),
      });
    }

    // 6) Call OpenAI with retry on 5xx/timeout.
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      if (args.userId && scope === "kid_initiated") {
        await ctx.runMutation(internal.aiGateway.db.decrementUserDailyQuota, {
          userId: args.userId,
          scope,
          dayKey: dKey,
        });
      }
      await ctx.runMutation(internal.aiGateway.db.recordUsage, {
        userId: args.userId,
        purpose,
        modelUsed: resolved.model,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        latencyMs: 0,
        status: "failed",
        traceId,
        metadata: args.metadata,
        month,
        errorMessage: "OPENAI_API_KEY missing",
      });
      return {
        ok: false,
        traceId,
        reason: "AI_PROVIDER_UNAVAILABLE",
        kidMessage: "Petit souci ! On essaie autre chose 🔧",
      };
    }

    const openai = new OpenAI({ apiKey });
    const t0 = Date.now();
    let lastError: unknown = null;
    let attempts = 0;
    const maxAttempts = cfg.retries + 1;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        const completion = await openai.chat.completions.create(
          {
            model: resolved.model,
            temperature: cfg.temperature,
            max_tokens: resolved.maxOutputTokens,
            messages: [
              ...(args.systemPrompt
                ? [{ role: "system" as const, content: args.systemPrompt }]
                : []),
              { role: "user" as const, content: args.prompt },
            ],
            response_format: args.expectJson
              ? { type: "json_object" as const }
              : undefined,
          },
          { timeout: cfg.requestTimeoutMs },
        );

        const latencyMs = Date.now() - t0;
        const text = completion.choices[0]?.message?.content ?? "";
        const inputTokens = completion.usage?.prompt_tokens ?? 0;
        const outputTokens = completion.usage?.completion_tokens ?? 0;
        const costUsd = estimateCostUsd(purpose, inputTokens, outputTokens);

        let parsed: unknown = text;
        if (args.expectJson) {
          try {
            parsed = JSON.parse(text);
          } catch (err) {
            throw new Error(
              `Model emitted invalid JSON: ${(err as Error).message}`,
            );
          }
        }

        await ctx.runMutation(internal.aiGateway.db.recordUsage, {
          userId: args.userId,
          purpose,
          modelUsed: resolved.model,
          inputTokens,
          outputTokens,
          costUsd,
          latencyMs,
          status: "ok",
          traceId,
          metadata: args.metadata,
          month,
        });

        return {
          ok: true,
          result: parsed,
          traceId,
          modelUsed: resolved.model,
          costUsd,
          latencyMs,
        };
      } catch (err) {
        lastError = err;
        const msg = (err as Error)?.message ?? String(err);
        const retryable =
          /timeout|ECONNRESET|ETIMEDOUT|fetch failed|5\d{2}/i.test(msg);
        if (!retryable || attempts >= maxAttempts) break;
        await sleep(500);
      }
    }

    // Decrement quota on failure (transactional rollback).
    if (args.userId && scope === "kid_initiated") {
      await ctx.runMutation(internal.aiGateway.db.decrementUserDailyQuota, {
        userId: args.userId,
        scope,
        dayKey: dKey,
      });
    }

    const latencyMs = Date.now() - t0;
    const errorMessage =
      lastError instanceof Error ? lastError.message : String(lastError);
    await ctx.runMutation(internal.aiGateway.db.recordUsage, {
      userId: args.userId,
      purpose,
      modelUsed: resolved.model,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      latencyMs,
      status: "failed",
      traceId,
      metadata: args.metadata,
      month,
      errorMessage,
    });

    return {
      ok: false,
      traceId,
      reason: "AI_CALL_FAILED",
      kidMessage:
        "Ça prend un peu de temps... attends-moi ou réessaie dans quelques secondes.",
    };
  },
});

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

export { ALL_PURPOSES };
