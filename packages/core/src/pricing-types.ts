/** Public list prices in USD / million tokens. Missing rates are unknown, including cache writes. */
export interface PublicPriceRates {
  inputPerMillion: number;
  outputPerMillion: number;
  cachedPerMillion: number | null;
  cacheWritePerMillion?: number | null;
  cacheWrite5mPerMillion?: number | null;
  cacheWrite1hPerMillion?: number | null;
  contextTiers?: PublicContextTier[];
}
export interface PublicContextTier extends Omit<PublicPriceRates, "contextTiers"> {
  /** Inclusive lower bound. An upstream 'over 272k' becomes 272001. */
  minInputTokens: number;
}
export interface CachePriceDetails {
  cacheWritePerMillion?: number | null;
  cacheWrite5mPerMillion?: number | null;
  cacheWrite1hPerMillion?: number | null;
  contextTiers?: PublicContextTier[];
  route?: "direct" | "openrouter";
  serviceTier?: string;
  routePrices?: Record<string, PublicPriceRates & { origin: string; updatedAt: string }>;
}
