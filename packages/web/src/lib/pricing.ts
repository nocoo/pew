/**
 * Token pricing for AI models.
 *
 * Prices are in USD per 1M tokens.
 *
 * Architecture:
 * - Dynamic dataset (worker-read KV, baseline JSON underneath) provides the
 *   exact-match table.
 * - `buildPricingMap({ dynamic })` projects dynamic entries into a `PricingMap`.
 * - Static prefix / source / fallback tables remain as the safety net beneath
 *   dynamic data.
 * - Client pages fetch the merged map from `/api/pricing` and pass it to
 *   `lookupPricing()` for per-model resolution.
 *
 * Matching strategy (first hit wins): exact model ID → prefix match →
 * source default → fallback.
 *
 * Client-safe: this module must not import any server-only code so client
 * bundles (e.g. use-pricing.ts → getDefaultPricingMap) stay free of db-worker.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Origin of a dynamic pricing entry, in priority order. */
export type DynamicPricingOrigin =
  | "baseline"
  | "openrouter"
  | "models.dev";

/**
 * Client-safe DTO for one dynamic pricing entry. Mirrors worker-read's
 * sync/types but lives here so callers don't pull server code transitively.
 */
export interface DynamicPricingEntry {
  model: string;
  provider: string | null;
  displayName: string | null;
  inputPerMillion: number;
  outputPerMillion: number;
  cachedPerMillion: number | null;
  contextWindow: number | null;
  origin: DynamicPricingOrigin;
  updatedAt: string;
  aliases?: string[];
}

export interface ModelPricing {
  /** Price per 1M input tokens (USD) */
  input: number;
  /** Price per 1M output tokens (USD) */
  output: number;
  /** Price per 1M cached input tokens (USD), defaults to input * 0.1 */
  cached?: number;
}

/** Serialisable pricing map sent to clients via /api/pricing */
export interface PricingMap {
  models: Record<string, ModelPricing>;
  prefixes: Array<{ prefix: string; pricing: ModelPricing }>;
  sourceDefaults: Record<string, ModelPricing>;
  fallback: ModelPricing;
}

// ---------------------------------------------------------------------------
// Static pricing tables (safety net beneath dynamic)
// ---------------------------------------------------------------------------

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

/** Fallback pricing per source (conservative estimates, alphabetical order) */
export const DEFAULT_SOURCE_DEFAULTS: Record<string, ModelPricing> = {
  "claude-code": { input: 3, output: 15, cached: 0.3 },
  codex: { input: 2, output: 8, cached: 0.5 },
  "copilot-cli": { input: 3, output: 15, cached: 0.3 },
  "gemini-cli": { input: 1.25, output: 10, cached: 0.31 },
  hermes: { input: 3, output: 15, cached: 0.3 },
  kosmos: { input: 3, output: 15, cached: 0.3 },
  opencode: { input: 2, output: 8, cached: 0.5 },
  openclaw: { input: 2, output: 8, cached: 0.5 },
  pi: { input: 3, output: 15, cached: 0.3 },
  pmstudio: { input: 3, output: 15, cached: 0.3 },
  "vscode-copilot": { input: 3, output: 15, cached: 0.3 },
};

export const DEFAULT_FALLBACK: ModelPricing = { input: 3, output: 15, cached: 0.3 };

// ---------------------------------------------------------------------------
// Build a PricingMap (project the dynamic dataset onto static safety net)
// ---------------------------------------------------------------------------

/**
 * Build the safety-net PricingMap (no dynamic data).
 * Exact-match table is empty — exact prices come from dynamic data.
 */
export function getDefaultPricingMap(): PricingMap {
  return {
    models: {},
    prefixes: [...DEFAULT_PREFIX_PRICES],
    sourceDefaults: { ...DEFAULT_SOURCE_DEFAULTS },
    fallback: DEFAULT_FALLBACK,
  };
}

export interface BuildPricingMapInput {
  dynamic: DynamicPricingEntry[];
}

/**
 * Project the dynamic dataset into a PricingMap.
 *
 * Dynamic entries (already merged baseline → openrouter → models.dev in the
 * worker-read sync layer) are written into `models[model]`; aliases share
 * the same pricing pointer.
 */
export function buildPricingMap({
  dynamic,
}: BuildPricingMapInput): PricingMap {
  const map: PricingMap = {
    models: {},
    prefixes: [...DEFAULT_PREFIX_PRICES],
    sourceDefaults: { ...DEFAULT_SOURCE_DEFAULTS },
    fallback: DEFAULT_FALLBACK,
  };

  for (const entry of dynamic) {
    const pricing: ModelPricing = {
      input: entry.inputPerMillion,
      output: entry.outputPerMillion,
      ...(entry.cachedPerMillion != null
        ? { cached: entry.cachedPerMillion }
        : {}),
    };
    map.models[entry.model] = pricing;
    if (entry.aliases) {
      for (const alias of entry.aliases) {
        if (!(alias in map.models)) map.models[alias] = pricing;
      }
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// Lookup (works with any PricingMap)
// ---------------------------------------------------------------------------

/**
 * Look up pricing for a model from a PricingMap.
 *
 * Resolution order (first hit wins):
 *   1. exact match in `models[model]` (dynamic dataset).
 *   2. prefix match against `prefixes`.
 *   3. source default `sourceDefaults[source]` (model-agnostic per source).
 *   4. global `fallback`.
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

  // Source default (model-agnostic)
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
 * Look up pricing for a model using the prefix/source map only — no dynamic.
 * Reserved for contexts where a `db` handle isn't available (tests, simple
 * scripts). Server request paths must use `loadPricingMap(db)` so the
 * dynamic-pricing dataset is honoured.
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
