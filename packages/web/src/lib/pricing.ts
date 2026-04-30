/**
 * Token pricing for AI models.
 *
 * Prices are in USD per 1M tokens.
 *
 * Architecture:
 * - Dynamic dataset (worker-read KV, baseline JSON underneath) provides the
 *   exact-match table; admin DB rows in `model_pricing` overlay on top.
 * - `buildPricingMap({ dynamic, dbRows })` projects both into a `PricingMap`.
 * - Static prefix / source / fallback tables remain as the safety net beneath
 *   dynamic data and admin overrides.
 * - Client pages fetch the merged map from `/api/pricing` and pass it to
 *   `lookupPricing()` for per-model resolution.
 *
 * Matching strategy (first hit wins): (source, model) admin override →
 * exact model ID → prefix match → source default → fallback.
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
  | "models.dev"
  | "admin";

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
  /**
   * Per-(source, model) overrides from admin rows whose `source != null`.
   * Beats `models[model]` only when the lookup carries a matching source.
   * Optional on the wire for backward compatibility with older clients.
   */
  sourceModels?: Record<string, Record<string, ModelPricing>>;
  prefixes: Array<{ prefix: string; pricing: ModelPricing }>;
  sourceDefaults: Record<string, ModelPricing>;
  fallback: ModelPricing;
}

// ---------------------------------------------------------------------------
// Static pricing tables (safety net beneath dynamic + admin)
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
// Build a PricingMap (merge static defaults + DB overrides)
// ---------------------------------------------------------------------------

/**
 * Build the safety-net PricingMap (no dynamic, no DB).
 * Exact-match table is empty — exact prices come from dynamic data.
 */
export function getDefaultPricingMap(): PricingMap {
  return {
    models: {},
    sourceModels: {},
    prefixes: [...DEFAULT_PREFIX_PRICES],
    sourceDefaults: { ...DEFAULT_SOURCE_DEFAULTS },
    fallback: DEFAULT_FALLBACK,
  };
}

export interface BuildPricingMapInput {
  dynamic: DynamicPricingEntry[];
  dbRows: DbPricingRow[];
}

/**
 * Project the dynamic dataset + admin DB rows into a PricingMap.
 *
 * Layering (later wins, evaluated by `lookupPricing`):
 *   1. dynamic entries (already merged baseline → openrouter → models.dev → admin
 *      in the worker-read sync layer); aliases share the same pricing pointer.
 *      All written into `models[model]`.
 *   2. admin DB rows (`model_pricing`):
 *        - row.source == null → write `models[model]` (global model override)
 *        - row.source != null → write `sourceModels[source][model]` ONLY
 *          (scoped override; does NOT pollute the global `models[model]` table
 *          and does NOT redefine the model-agnostic `sourceDefaults[source]`
 *          fallback). This gives admins a precise "this source uses a different
 *          price for this model" knob without leaking into other sources or
 *          into source-less lookups.
 */
export function buildPricingMap({
  dynamic,
  dbRows,
}: BuildPricingMapInput): PricingMap {
  const map: PricingMap = {
    models: {},
    sourceModels: {},
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

  for (const row of dbRows) {
    const pricing: ModelPricing = {
      input: row.input,
      output: row.output,
      ...(row.cached != null ? { cached: row.cached } : {}),
    };

    if (row.source) {
      // Source-scoped override: store under (source, model) only. Do NOT mutate
      // map.models[row.model] (would leak the price into source-less lookups
      // and into other sources) and do NOT mutate sourceDefaults[row.source]
      // (that table is the model-agnostic fallback per source).
      if (!map.sourceModels) map.sourceModels = {};
      const bucket = (map.sourceModels[row.source] ??= {});
      bucket[row.model] = pricing;
    } else {
      map.models[row.model] = pricing;
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// Lookup (works with any PricingMap — static or merged)
// ---------------------------------------------------------------------------

/**
 * Look up pricing for a model from a PricingMap.
 *
 * Resolution order (first hit wins):
 *   1. (source, model) override from `sourceModels[source][model]` (admin row
 *      with non-null source and matching model).
 *   2. exact match in `models[model]` (dynamic dataset or admin row with
 *      `source == null`).
 *   3. prefix match against `prefixes`.
 *   4. source default `sourceDefaults[source]` (model-agnostic per source).
 *   5. global `fallback`.
 *
 * Note: source-scoped admin overrides (#1) are deliberately checked BEFORE the
 * global exact-match (#2) so they can override even a globally-priced model.
 */
export function lookupPricing(
  pricingMap: PricingMap,
  model: string,
  source?: string
): ModelPricing {
  // Source-scoped admin override (highest priority when both keys match)
  if (source) {
    const sourceBucket = pricingMap.sourceModels?.[source];
    const scoped = sourceBucket?.[model];
    if (scoped) return scoped;
  }

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
 * Look up pricing for a model using the prefix/source map only — no DB.
 * Reserved for contexts where a `db` handle isn't available (tests, simple
 * scripts). Server request paths must use `loadPricingMap(db)` so admin
 * overrides and the dynamic-pricing dataset are honoured.
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
