/**
 * AI Gateway — model registry.
 *
 * MVP-1 Plan B (Decision 76 + design §4): the design lists DeepSeek-V3 but the
 * environment ships only `OPENAI_API_KEY`, so every purpose routes to OpenAI
 * `gpt-4o-mini`. Admins can swap individual purposes via `settings.modelOverrides`
 * without redeploy.
 *
 * Pure module — no Convex imports. Can run in actions or queries.
 */

export type AiPurpose =
  | "palier_base"
  | "palier_personalized"
  | "verify_short_answer"
  | "explain_mistake"
  | "verify_math"
  | "pdf_extract";

export interface PurposeConfig {
  /** Default model id (when no override + no economy downgrade applies). */
  defaultModel: string;
  /** Output cap. Reduced by 30% in economy mode. */
  maxOutputTokens: number;
  /** Generation temperature. */
  temperature: number;
  /** Soft network timeout, ms. UX timeout (Decision 64) is enforced upstream. */
  requestTimeoutMs: number;
  /** Retry budget on 5xx / timeout. Decision §4. */
  retries: number;
  /** Cost ceilings per 1M tokens. */
  costPer1MInputUsd: number;
  costPer1MOutputUsd: number;
}

// gpt-4o-mini list price (Sept 2025): $0.15 / 1M input, $0.60 / 1M output.
const GPT_4O_MINI: Pick<PurposeConfig, "costPer1MInputUsd" | "costPer1MOutputUsd"> = {
  costPer1MInputUsd: 0.15,
  costPer1MOutputUsd: 0.6,
};

// gpt-4o list price (Sept 2025): $2.50 / 1M input, $10.00 / 1M output — soit
// ~16x le mini. Seule l'extraction PDF l'utilise.
const GPT_4O: Pick<PurposeConfig, "costPer1MInputUsd" | "costPer1MOutputUsd"> = {
  costPer1MInputUsd: 2.5,
  costPer1MOutputUsd: 10,
};

const REGISTRY: Record<AiPurpose, PurposeConfig> = {
  palier_base: {
    defaultModel: "gpt-4o-mini",
    maxOutputTokens: 6000,
    temperature: 0.7,
    requestTimeoutMs: 90_000, // 10 exos + hints + structured output = ~30-60s
    retries: 1,
    ...GPT_4O_MINI,
  },
  palier_personalized: {
    defaultModel: "gpt-4o-mini",
    maxOutputTokens: 6000,
    temperature: 0.8,
    requestTimeoutMs: 90_000,
    retries: 1,
    ...GPT_4O_MINI,
  },
  verify_short_answer: {
    defaultModel: "gpt-4o-mini",
    maxOutputTokens: 200,
    temperature: 0.0,
    requestTimeoutMs: 10_000,
    retries: 1,
    ...GPT_4O_MINI,
  },
  explain_mistake: {
    defaultModel: "gpt-4o-mini",
    maxOutputTokens: 800,
    temperature: 0.5,
    requestTimeoutMs: 10_000,
    retries: 1,
    ...GPT_4O_MINI,
  },
  verify_math: {
    defaultModel: "gpt-4o-mini",
    maxOutputTokens: 50,
    temperature: 0.0,
    requestTimeoutMs: 8_000,
    retries: 1,
    ...GPT_4O_MINI,
  },
  // Extraction d'exercices depuis un PDF (convex/pdfUploadsExtract.ts).
  //
  // Ce poste ne passe PAS par `generate` : il appelle l'API Responses avec un
  // fichier en base64 et une sortie structurée, forme que la passerelle ne
  // connaît pas. Il est ici pour deux raisons seulement : donner à
  // `estimateCostUsd` le tarif `gpt-4o`, et servir de source unique pour
  // l'identifiant du modèle, afin que le prix et l'appel ne puissent pas
  // diverger. Les autres champs décrivent l'appel réel mais ne sont pas
  // consommés aujourd'hui.
  //
  // Pour le router vraiment, il faudrait que `generate` accepte un mode
  // « fichier » (entrée `input_file` + `text.format.json_schema` de l'API
  // Responses) en plus de son mode chat, et que `resolveModel` soit contraint
  // aux modèles qui supportent les sorties structurées — sans quoi un
  // `modelOverrides` administrateur casserait l'extraction en silence.
  pdf_extract: {
    defaultModel: "gpt-4o",
    maxOutputTokens: 16_000,
    temperature: 0.2,
    requestTimeoutMs: 180_000,
    retries: 0,
    ...GPT_4O,
  },
};

export function getPurposeConfig(purpose: AiPurpose): PurposeConfig {
  return REGISTRY[purpose];
}

/**
 * Resolve the model id for a purpose, honouring admin overrides
 * (Decision 76) and economy mode (Decision 69).
 */
export function resolveModel(
  purpose: AiPurpose,
  overrides: Record<string, string> | undefined,
  economyMode: boolean,
): { model: string; maxOutputTokens: number; economyApplied: boolean } {
  const cfg = REGISTRY[purpose];
  const overridden = overrides?.[purpose];
  const model = overridden ?? cfg.defaultModel;
  const maxOutputTokens = economyMode
    ? Math.floor(cfg.maxOutputTokens * 0.7)
    : cfg.maxOutputTokens;
  return { model, maxOutputTokens, economyApplied: economyMode };
}

export function estimateCostUsd(
  purpose: AiPurpose,
  inputTokens: number,
  outputTokens: number,
): number {
  const cfg = REGISTRY[purpose];
  return (
    (inputTokens / 1_000_000) * cfg.costPer1MInputUsd +
    (outputTokens / 1_000_000) * cfg.costPer1MOutputUsd
  );
}

/**
 * Estimation grossière du nombre de jetons d'un texte, ~4 caractères par
 * jeton (ordre de grandeur usuel des tokenizers OpenAI sur du français).
 *
 * Sert uniquement de filet quand OpenAI a répondu — donc facturé — mais que
 * le bloc `usage` manque : le type SDK le déclare optionnel. Pour un
 * garde-fou de dépense, une estimation haute vaut mieux qu'un zéro faux, qui
 * rendrait la dépense invisible au plafond. Jamais utilisée quand `usage` est
 * présent.
 */
export function approximateTokenCount(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

export const ALL_PURPOSES: AiPurpose[] = Object.keys(REGISTRY) as AiPurpose[];
