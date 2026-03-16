/**
 * Token pricing for AI models.
 *
 * Prices are in USD per 1M tokens.
 *
 * Architecture:
 * - Static tables serve as built-in defaults (always available, zero latency).
 * - Database table `model_pricing` allows admins to override / add entries.
 * - `buildPricingMap()` merges DB rows on top of static defaults (server-side).
 * - Client pages fetch the merged map from `/api/pricing` and pass it to
 *   `lookupPricing()` for per-model resolution.
 * - `estimateCost()` and `formatCost()` are pure helpers, unchanged.
 *
 * Matching strategy: exact model ID → prefix match → source default → fallback.
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

/** A row from the model_pricing DB table */
export interface DbPricingRow {
  id: number;
  model: string;
  input: number;
  output: number;
  cached: number | null;
  source: string | null;
  note: string | null;
  updated_at: string;
  created_at: string;
}

/** Serialisable pricing map sent to clients via /api/pricing */
export interface PricingMap {
  models: Record<string, ModelPricing>;
  prefixes: Array<{ prefix: string; pricing: ModelPricing }>;
  sourceDefaults: Record<string, ModelPricing>;
  fallback: ModelPricing;
}

// ---------------------------------------------------------------------------
// Static pricing tables (built-in defaults)
// ---------------------------------------------------------------------------

/** Exact model ID → pricing */
export const DEFAULT_MODEL_PRICES: Record<string, ModelPricing> = {
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
export const DEFAULT_PREFIX_PRICES: Array<{ prefix: string; pricing: ModelPricing }> = [
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
export const DEFAULT_SOURCE_DEFAULTS: Record<string, ModelPricing> = {
  "claude-code": { input: 3, output: 15, cached: 0.3 },
  codex: { input: 2, output: 8, cached: 0.5 },
  "gemini-cli": { input: 1.25, output: 10, cached: 0.31 },
  opencode: { input: 2, output: 8, cached: 0.5 },
  openclaw: { input: 2, output: 8, cached: 0.5 },
  "vscode-copilot": { input: 3, output: 15, cached: 0.3 },
  "copilot-cli": { input: 3, output: 15, cached: 0.3 },
};

export const DEFAULT_FALLBACK: ModelPricing = { input: 3, output: 15, cached: 0.3 };

// ---------------------------------------------------------------------------
// Build a PricingMap (merge static defaults + DB overrides)
// ---------------------------------------------------------------------------

/**
 * Build the default PricingMap from static tables only.
 */
export function getDefaultPricingMap(): PricingMap {
  return {
    models: { ...DEFAULT_MODEL_PRICES },
    prefixes: [...DEFAULT_PREFIX_PRICES],
    sourceDefaults: { ...DEFAULT_SOURCE_DEFAULTS },
    fallback: DEFAULT_FALLBACK,
  };
}

/**
 * Merge database pricing rows on top of static defaults.
 * DB rows with `source` set override source defaults;
 * DB rows without `source` override exact model prices.
 */
export function buildPricingMap(dbRows: DbPricingRow[]): PricingMap {
  const map = getDefaultPricingMap();

  for (const row of dbRows) {
    const pricing: ModelPricing = {
      input: row.input,
      output: row.output,
      ...(row.cached != null ? { cached: row.cached } : {}),
    };

    if (row.source) {
      // Source-specific override: treated as a source default
      map.sourceDefaults[row.source] = pricing;
    }

    // Always add/override the exact model entry
    map.models[row.model] = pricing;
  }

  return map;
}

// ---------------------------------------------------------------------------
// Lookup (works with any PricingMap — static or merged)
// ---------------------------------------------------------------------------

/**
 * Look up pricing for a model from a PricingMap.
 * Tries exact match → prefix → source default → fallback.
 */
export function lookupPricing(
  pricingMap: PricingMap,
  model: string,
  source?: string
): ModelPricing {
  // Exact match
  const exact = pricingMap.models[model];
  if (exact) return exact;

  // Prefix match (Gemini models often include "models/" prefix)
  const cleanModel = model.replace(/^models\//, "");
  const prefixMatch = pricingMap.prefixes.find((p) =>
    cleanModel.startsWith(p.prefix)
  );
  if (prefixMatch) return prefixMatch.pricing;

  // Source default
  if (source) {
    const srcDefault = pricingMap.sourceDefaults[source];
    if (srcDefault) return srcDefault;
  }

  return pricingMap.fallback;
}

// ---------------------------------------------------------------------------
// Legacy lookup (uses static tables directly, no DB)
// ---------------------------------------------------------------------------

/**
 * Look up pricing for a model using static defaults only.
 * Kept for backward compatibility and for contexts where PricingMap
 * is not available (e.g. tests, server-side without DB).
 */
export function getModelPricing(model: string, source?: string): ModelPricing {
  return lookupPricing(getDefaultPricingMap(), model, source);
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
 * Format USD cost with appropriate precision and thousand separators.
 */
export function formatCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(2)}`;
  if (cost < 100) return `$${cost.toFixed(2)}`;
  return `$${cost.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}
