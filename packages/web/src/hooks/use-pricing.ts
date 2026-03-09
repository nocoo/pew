"use client";

import { useState, useEffect, useCallback } from "react";
import {
  type PricingMap,
  getDefaultPricingMap,
  lookupPricing,
  estimateCost,
  formatCost,
} from "@/lib/pricing";

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
  const [pricingMap, setPricingMap] = useState<PricingMap>(
    getDefaultPricingMap
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMap = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/pricing");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `HTTP ${res.status}`
        );
      }
      const json = (await res.json()) as PricingMap;
      setPricingMap(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      // Keep using static defaults on error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMap();
  }, [fetchMap]);

  return { pricingMap, loading, error, refetch: fetchMap };
}

// Re-export helpers so pages can import everything from one place
export { lookupPricing, estimateCost, formatCost };
export type { PricingMap };
