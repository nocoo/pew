"use client";

import {
  type PricingMap,
  getDefaultPricingMap,
  lookupPricing,
  estimateCost,
  formatCost,
} from "@/lib/pricing";
import { useFetchData } from "@/hooks/use-fetch-data";

interface UsePricingMapResult {
  /** Merged pricing map (DB overrides + static defaults). Falls back to static defaults while loading. */
  pricingMap: PricingMap;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Fetch the merged pricing map from /api/pricing.
 * Returns static defaults immediately while loading so cost calculations never block.
 */
export function usePricingMap(): UsePricingMapResult {
  const { data, loading, error, refetch } = useFetchData<PricingMap>("/api/pricing");

  return {
    pricingMap: data ?? getDefaultPricingMap(),
    loading,
    error,
    refetch,
  };
}

// Re-export helpers so pages can import everything from one place
export { lookupPricing, estimateCost, formatCost };
export type { PricingMap };
