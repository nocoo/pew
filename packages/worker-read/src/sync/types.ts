/**
 * Shared types for the dynamic pricing sync pipeline.
 *
 * All values stored in per-million-token units to match the existing
 * ModelPricing shape used by the web cost-calc layer.
 */

export interface DynamicPricingEntry {
  model: string;
  provider: string;
  displayName: string | null;
  inputPerMillion: number;
  outputPerMillion: number;
  cachedPerMillion: number | null;
  contextWindow: number | null;
  origin: "baseline" | "openrouter" | "models.dev";
  updatedAt: string;
  aliases?: string[];
}

export interface DynamicPricingMeta {
  lastSyncedAt: string;
  modelCount: number;
  baselineCount: number;
  openRouterCount: number;
  modelsDevCount: number;
  lastErrors?: Array<{
    source: "openrouter" | "models.dev" | "kv";
    at: string;
    message: string;
  }> | null;
}

export const PRICING_ORIGINS = [
  "baseline",
  "openrouter",
  "models.dev",
] as const;
