/**
 * Step-by-step pedagogical explanation when a kid exhausts all 5 attempts on
 * an exercise. Cache-first by exerciseId — the first kid to ask pays the AI
 * cost, every subsequent kid with the same blocked exercise gets the cached
 * explanation. Quota-protected via the existing aiUserQuota system.
 *
 * Public action `explainExercise({ exerciseId })` is the only entry point.
 * The cached row in `exerciseExplanations` is structured as:
 *   { intro, steps[3-5], conclusion }
 * matching the JSON schema enforced in the AI prompt.
 */

import { internal } from "./_generated/api";
import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "./_generated/dataModel";
import { kidMessages } from "../lib/kidCopy";

// ---------------------------------------------------------------------------
// Types — match the JSON envelope the model is asked to return.
// ---------------------------------------------------------------------------

export type ExplanationPayload = {
  intro: string;
  steps: string[];
  conclusion: string;
};

const MIN_STEPS = 3;
const MAX_STEPS = 5;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

export const getCached = internalQuery({
  args: { exerciseId: v.id("exercises") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("exerciseExplanations")
      .withIndex("by_exercise", (q) => q.eq("exerciseId", args.exerciseId))
      .unique();
  },
});

export const getExercise = internalQuery({
  args: { exerciseId: v.id("exercises") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.exerciseId);
  },
});

export const getStudentProfileId = internalQuery({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId as string))
      .unique();
    if (!profile || profile.role !== "student") return null;
    return profile._id;
  },
});

export const saveExplanation = internalMutation({
  args: {
    exerciseId: v.id("exercises"),
    intro: v.string(),
    steps: v.array(v.string()),
    conclusion: v.string(),
    model: v.string(),
    traceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Idempotent — if another concurrent call beat us to it, keep the first.
    const existing = await ctx.db
      .query("exerciseExplanations")
      .withIndex("by_exercise", (q) => q.eq("exerciseId", args.exerciseId))
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("exerciseExplanations", {
      exerciseId: args.exerciseId,
      intro: args.intro,
      steps: args.steps,
      conclusion: args.conclusion,
      generatedAt: Date.now(),
      model: args.model,
      traceId: args.traceId,
    });
  },
});

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildPrompt(exercise: Doc<"exercises">): {
  system: string;
  user: string;
} {
  const system = [
    "Tu es Pio, un professeur adorable et patient pour un élève sénégalais de CE2 ou CM1 (8 à 10 ans).",
    "L'élève vient d'échouer 5 fois sur l'exercice ci-dessous. Il est découragé et se sent nul.",
    "Ton travail : lui faire comprendre le concept pour de bon, pour qu'il réussisse demain sans aide.",
    "",
    "Règles pédagogiques :",
    "- Commence TOUJOURS par une analogie tirée de la vie de tous les jours (le marché, le foot, la cuisine, la famille, les mangues, le bus…). L'analogie doit rendre le concept évident.",
    "- Ensuite, relie l'analogie à l'exercice concret, étape par étape.",
    "- Termine par la règle ou l'astuce à retenir, formulée comme un petit secret entre toi et l'élève.",
    "- Ton ton est chaleureux, jamais condescendant. Tu tutoies l'élève.",
    "- Phrases courtes (max 20 mots). Pas d'emoji, pas de Markdown.",
    "- L'explication doit être si claire que même un enfant qui n'a jamais vu le sujet comprendrait.",
    "",
    `Réponds UNIQUEMENT au format JSON suivant, rien d'autre :`,
    `{`,
    `  "intro": "1 phrase d'accroche rassurante (max 20 mots)",`,
    `  "steps": [`,
    `    "étape 1 : l'analogie de la vie quotidienne",`,
    `    "étape 2 : on fait le lien avec l'exercice",`,
    `    "étape 3 : on résout ensemble, pas à pas",`,
    `    "étape 4 (optionnelle) : détail supplémentaire si nécessaire",`,
    `    "étape 5 (optionnelle) : la règle / l'astuce à retenir"`,
    `  ],`,
    `  "conclusion": "1 phrase d'encouragement personnelle (max 20 mots)"`,
    `}`,
    "",
    `Le tableau steps doit contenir entre ${MIN_STEPS} et ${MAX_STEPS} étapes.`,
    `L'étape 1 est TOUJOURS une analogie concrète. L'avant-dernière ou dernière étape est TOUJOURS la règle à retenir.`,
  ].join("\n");

  const user = [
    `Type d'exercice : ${exercise.type}`,
    `Question : ${exercise.prompt}`,
    `Réponse correcte : ${exercise.answerKey}`,
  ].join("\n");

  return { system, user };
}

// ---------------------------------------------------------------------------
// Parser — defensive against bad model output
// ---------------------------------------------------------------------------

function parseExplanation(raw: unknown): ExplanationPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const intro = typeof obj.intro === "string" ? obj.intro.trim() : null;
  const conclusion =
    typeof obj.conclusion === "string" ? obj.conclusion.trim() : null;
  const stepsRaw = Array.isArray(obj.steps) ? obj.steps : null;
  if (!intro || !conclusion || !stepsRaw) return null;

  const steps = stepsRaw
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (steps.length < MIN_STEPS) return null;
  return {
    intro,
    steps: steps.slice(0, MAX_STEPS),
    conclusion,
  };
}

// ---------------------------------------------------------------------------
// Public action
// ---------------------------------------------------------------------------

type ExplainResult =
  | { ok: true; explanation: ExplanationPayload; cached: boolean }
  | { ok: false; reason: string; kidMessage: string };

export const explainExercise = action({
  args: { exerciseId: v.id("exercises") },
  handler: async (ctx, args): Promise<ExplainResult> => {
    // Auth check — student-only.
    const studentId: Id<"profiles"> | null = await ctx.runQuery(
      internal.explainMistake.getStudentProfileId,
      {},
    );
    if (!studentId) {
      return {
        ok: false,
        reason: "UNAUTHENTICATED",
        kidMessage: "Reconnecte-toi pour voir l'explication.",
      };
    }

    // Paywall (spec §5.4) — contrôle le droit du studentId dérivé ci-dessus,
    // AVANT toute lecture de cache et tout appel au gateway IA. Le but est
    // d'éviter la dépense en amont, pas de la rattraper après coup : le
    // verrou posé dans aiGateway.generate (tâche 4) reste le dernier
    // recours. Une action n'a pas de ctx.db, d'où le passage par la requête
    // interne de la tâche 3.
    //
    // Retourne la forme contractuelle (ok:false + kidMessage) plutôt que de
    // lever (correction ronde 1) : le composant appelant
    // (components/student/explain-step-by-step.tsx) catch les Error non
    // gérées et affiche un message de "connexion lente, réessaie" — un
    // élève bloqué par le paywall réessaierait alors en boucle sans jamais
    // alerter un adulte. kidMessages.accessNotOpen l'oriente vers son
    // maître, sans mentionner l'école ni l'abonnement (spec §5.8).
    const access = await ctx.runQuery(internal.access.getAccessStateForProfile, {
      profileId: studentId,
    });
    if (!access.ok) {
      return {
        ok: false,
        reason: "ACCESS_DENIED",
        kidMessage: kidMessages.accessNotOpen,
      };
    }

    // Cache check.
    const cached: Doc<"exerciseExplanations"> | null = await ctx.runQuery(
      internal.explainMistake.getCached,
      { exerciseId: args.exerciseId },
    );
    if (cached) {
      return {
        ok: true,
        cached: true,
        explanation: {
          intro: cached.intro,
          steps: cached.steps,
          conclusion: cached.conclusion,
        },
      };
    }

    // Load exercise context.
    const exercise: Doc<"exercises"> | null = await ctx.runQuery(
      internal.explainMistake.getExercise,
      { exerciseId: args.exerciseId },
    );
    if (!exercise) {
      return {
        ok: false,
        reason: "EXERCISE_NOT_FOUND",
        kidMessage: "Désolé, je n'arrive pas à retrouver l'exercice.",
      };
    }

    // Call AI gateway.
    const { system, user } = buildPrompt(exercise);
    const result: {
      ok: boolean;
      result?: unknown;
      traceId: string;
      modelUsed?: string;
      reason?: string;
      kidMessage?: string;
    } = await ctx.runAction(internal.aiGateway.index.generate, {
      purpose: "explain_mistake",
      prompt: user,
      systemPrompt: system,
      expectJson: true,
      userId: studentId,
      quotaScope: "kid_initiated",
      metadata: { exerciseId: args.exerciseId, kind: "explain_mistake" },
    });

    if (!result.ok) {
      return {
        ok: false,
        reason: result.reason ?? "AI_FAILED",
        kidMessage:
          result.kidMessage ??
          "L'aide est en pause. Réessaie dans un instant ou demande à un parent.",
      };
    }

    // Parse + validate.
    const parsed = parseExplanation(result.result);
    if (!parsed) {
      return {
        ok: false,
        reason: "AI_BAD_FORMAT",
        kidMessage: "Désolé, je n'ai pas bien préparé l'explication.",
      };
    }

    // Cache.
    await ctx.runMutation(internal.explainMistake.saveExplanation, {
      exerciseId: args.exerciseId,
      intro: parsed.intro,
      steps: parsed.steps,
      conclusion: parsed.conclusion,
      model: result.modelUsed ?? "unknown",
      traceId: result.traceId,
    });

    return { ok: true, cached: false, explanation: parsed };
  },
});
