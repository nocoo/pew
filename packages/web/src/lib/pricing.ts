/**
 * Static pricing table for AI model token costs.
 *
 * Prices are in USD per 1M tokens.
 * Source: OpenRouter / official provider pricing (March 2026).
 *
 * Matching strategy: exact model ID → prefix match → source default.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelPricing {
  /** Price per 1M input tokens (USD) */
  input: number;
  /** Price per 1M output tokens (USD) */
  output: number;
  /** Price per 1M cached input tokens (USD), defaults to input * 0.1 */
  cached?: number;
}

// ---------------------------------------------------------------------------
// Pricing table
// ---------------------------------------------------------------------------

/** Exact model ID → pricing */
const MODEL_PRICES: Record<string, ModelPricing> = {
  // Anthropic (Claude Code)
  "claude-sonnet-4-20250514": { input: 3, output: 15, cached: 0.3 },
  "claude-opus-4-20250514": { input: 15, output: 75, cached: 1.5 },
  "claude-3.5-sonnet-20241022": { input: 3, output: 15, cached: 0.3 },
  "claude-3.5-haiku-20241022": { input: 0.8, output: 4, cached: 0.08 },

  // Google (Gemini CLI)
  "gemini-2.5-pro": { input: 1.25, output: 10, cached: 0.31 },
  "gemini-2.5-flash": { input: 0.15, output: 0.6, cached: 0.04 },
  "gemini-2.0-flash": { input: 0.1, output: 0.4, cached: 0.025 },

  // OpenAI (OpenCode / OpenClaw)
  "o3": { input: 10, output: 40, cached: 2.5 },
  "o4-mini": { input: 1.1, output: 4.4, cached: 0.275 },
  "gpt-4.1": { input: 2, output: 8, cached: 0.5 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6, cached: 0.1 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4, cached: 0.025 },
  "gpt-4o": { input: 2.5, output: 10, cached: 1.25 },
  "gpt-4o-mini": { input: 0.15, output: 0.6, cached: 0.075 },
};

/** Prefix patterns for fuzzy matching */
const PREFIX_PRICES: Array<{ prefix: string; pricing: ModelPricing }> = [
  { prefix: "claude-sonnet-4", pricing: { input: 3, output: 15, cached: 0.3 } },
  { prefix: "claude-opus-4", pricing: { input: 15, output: 75, cached: 1.5 } },
  { prefix: "claude-3.5-sonnet", pricing: { input: 3, output: 15, cached: 0.3 } },
  { prefix: "claude-3.5-haiku", pricing: { input: 0.8, output: 4, cached: 0.08 } },
  { prefix: "gemini-2.5-pro", pricing: { input: 1.25, output: 10, cached: 0.31 } },
  { prefix: "gemini-2.5-flash", pricing: { input: 0.15, output: 0.6, cached: 0.04 } },
  { prefix: "gemini-2.0", pricing: { input: 0.1, output: 0.4, cached: 0.025 } },
  { prefix: "o3", pricing: { input: 10, output: 40, cached: 2.5 } },
  { prefix: "o4-mini", pricing: { input: 1.1, output: 4.4, cached: 0.275 } },
  { prefix: "gpt-4.1-mini", pricing: { input: 0.4, output: 1.6, cached: 0.1 } },
  { prefix: "gpt-4.1-nano", pricing: { input: 0.1, output: 0.4, cached: 0.025 } },
  { prefix: "gpt-4.1", pricing: { input: 2, output: 8, cached: 0.5 } },
  { prefix: "gpt-4o-mini", pricing: { input: 0.15, output: 0.6, cached: 0.075 } },
  { prefix: "gpt-4o", pricing: { input: 2.5, output: 10, cached: 1.25 } },
];

/** Fallback pricing per source (conservative estimates) */
const SOURCE_DEFAULTS: Record<string, ModelPricing> = {
  "claude-code": { input: 3, output: 15, cached: 0.3 },
  "gemini-cli": { input: 1.25, output: 10, cached: 0.31 },
  opencode: { input: 2, output: 8, cached: 0.5 },
  openclaw: { input: 2, output: 8, cached: 0.5 },
};

const FALLBACK: ModelPricing = { input: 3, output: 15, cached: 0.3 };

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/**
 * Look up pricing for a model. Tries exact match → prefix → source default → fallback.
 */
export function getModelPricing(model: string, source?: string): ModelPricing {
  // Exact match
  const exact = MODEL_PRICES[model];
  if (exact) return exact;

  // Prefix match (Gemini models often include "models/" prefix)
  const cleanModel = model.replace(/^models\//, "");
  const prefixMatch = PREFIX_PRICES.find((p) => cleanModel.startsWith(p.prefix));
  if (prefixMatch) return prefixMatch.pricing;

  // Source default
  if (source) {
    const srcDefault = SOURCE_DEFAULTS[source];
    if (srcDefault) return srcDefault;
  }

  return FALLBACK;
}

// ---------------------------------------------------------------------------
// Cost calculation
// ---------------------------------------------------------------------------

export interface CostBreakdown {
  inputCost: number;
  outputCost: number;
  cachedCost: number;
  totalCost: number;
}

/**
 * Calculate estimated cost for a set of tokens.
 */
export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number,
  pricing: ModelPricing
): CostBreakdown {
  const M = 1_000_000;
  const cachedPrice = pricing.cached ?? pricing.input * 0.1;

  // Non-cached input = total input minus cached portion
  const nonCachedInput = Math.max(0, inputTokens - cachedTokens);

  const inputCost = (nonCachedInput / M) * pricing.input;
  const outputCost = (outputTokens / M) * pricing.output;
  const cachedCost = (cachedTokens / M) * cachedPrice;

  return {
    inputCost,
    outputCost,
    cachedCost,
    totalCost: inputCost + outputCost + cachedCost,
  };
}

/**
 * Format USD cost with appropriate precision.
 */
export function formatCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(2)}`;
  if (cost < 100) return `$${cost.toFixed(2)}`;
  return `$${cost.toFixed(0)}`;
}
