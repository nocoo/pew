/**
 * Cost computation helpers extracted from page components.
 *
 * `computeTotalCost` was duplicated in dashboard/page.tsx and
 * profile-view.tsx — now it lives here as the single source of truth.
 */

import type { ModelAggregate } from "@/hooks/use-usage-data";
import type { UsageRow } from "@/hooks/use-usage-data";
import { lookupPricing, estimateCost } from "@/lib/pricing";
import type { PricingMap } from "@/lib/pricing";

/** Sum estimated cost across an array of model aggregates. */
export function computeTotalCost(
  models: ModelAggregate[],
  pricingMap: PricingMap,
): number {
  let total = 0;
  for (const m of models) {
    const pricing = lookupPricing(pricingMap, m.model, m.source);
    const cost = estimateCost(m.input, m.output, m.cached, pricing);
    total += cost.totalCost;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Daily cost aggregation
// ---------------------------------------------------------------------------

/** A single day's cost breakdown for the cost trend chart. */
export interface DailyCostPoint {
  date: string;       // "2026-03-10"
  inputCost: number;  // USD
  outputCost: number; // USD
  cachedCost: number; // USD
  totalCost: number;  // USD
}

/**
 * Aggregate usage rows into daily cost points.
 *
 * Groups rows by `hour_start.slice(0, 10)` (date portion), computes
 * per-model cost via `lookupPricing` + `estimateCost`, and sums into
 * daily buckets. Returns sorted ascending by date.
 */
export function toDailyCostPoints(
  rows: UsageRow[],
  pricingMap: PricingMap,
): DailyCostPoint[] {
  const byDate = new Map<string, DailyCostPoint>();

  for (const r of rows) {
    const date = r.hour_start.slice(0, 10);
    const pricing = lookupPricing(pricingMap, r.model, r.source);
    const cost = estimateCost(
      r.input_tokens,
      r.output_tokens,
      r.cached_input_tokens,
      pricing,
    );

    const existing = byDate.get(date);
    if (existing) {
      existing.inputCost += cost.inputCost;
      existing.outputCost += cost.outputCost;
      existing.cachedCost += cost.cachedCost;
      existing.totalCost += cost.totalCost;
    } else {
      byDate.set(date, {
        date,
        inputCost: cost.inputCost,
        outputCost: cost.outputCost,
        cachedCost: cost.cachedCost,
        totalCost: cost.totalCost,
      });
    }
  }

  return Array.from(byDate.values()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}

// ---------------------------------------------------------------------------
// Cache savings
// ---------------------------------------------------------------------------

/** Breakdown of money saved by cache hits vs full input pricing. */
export interface CacheSavings {
  savedDollars: number;     // hypothetical full cost of cached tokens at input price
  actualCachedCost: number; // what user paid at cached price
  netSavings: number;       // savedDollars - actualCachedCost
  savingsPercent: number;   // netSavings / savedDollars * 100
}

/**
 * Compute how much money was saved by cache hits across all models.
 *
 * For each model: `savedDollars = cachedTokens / 1M * inputPrice`,
 * `actualCachedCost = cachedTokens / 1M * cachedPrice`.
 * `netSavings = savedDollars - actualCachedCost`.
 */
export function computeCacheSavings(
  models: ModelAggregate[],
  pricingMap: PricingMap,
): CacheSavings {
  let savedDollars = 0;
  let actualCachedCost = 0;

  for (const m of models) {
    const pricing = lookupPricing(pricingMap, m.model, m.source);
    const cachedPrice = pricing.cached ?? pricing.input * 0.1;
    savedDollars += (m.cached / 1_000_000) * pricing.input;
    actualCachedCost += (m.cached / 1_000_000) * cachedPrice;
  }

  const netSavings = savedDollars - actualCachedCost;
  const savingsPercent = savedDollars > 0 ? (netSavings / savedDollars) * 100 : 0;

  return { savedDollars, actualCachedCost, netSavings, savingsPercent };
}
