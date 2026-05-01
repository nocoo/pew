/**
 * Cost computation helpers extracted from page components.
 *
 * `computeTotalCost` was duplicated in dashboard/page.tsx and
 * profile-view.tsx — now it lives here as the single source of truth.
 */

import type { ModelAggregate } from "@/hooks/use-usage-data";
import type { UsageRow, UsageSummary } from "@/hooks/use-usage-data";
import { lookupPricing, estimateCost } from "@/lib/pricing";
import { sumBy } from "@/lib/array-helpers";
import type { PricingMap } from "@/lib/pricing";
import { toLocalDateStr } from "@/lib/usage-helpers";

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
  tzOffset: number = 0,
): DailyCostPoint[] {
  const byDate = new Map<string, DailyCostPoint>();

  for (const r of rows) {
    const date = toLocalDateStr(r.hour_start, tzOffset);
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

// ---------------------------------------------------------------------------
// Monthly cost forecast
// ---------------------------------------------------------------------------

/** Projected end-of-month cost based on linear extrapolation. */
export interface CostForecast {
  currentMonthCost: number;
  projectedMonthCost: number;
  daysElapsed: number;
  daysInMonth: number;
  dailyAverage: number;
}

/**
 * Forecast end-of-month cost via linear extrapolation.
 *
 * Filters `dailyCosts` to the month of `now`, computes daily average,
 * and projects to the full month. Returns `null` if fewer than 3 days
 * of data exist (too early to extrapolate reliably).
 */
export function forecastMonthlyCost(
  dailyCosts: DailyCostPoint[],
  now?: Date,
): CostForecast | null {
  const ref = now ?? new Date();
  const year = ref.getFullYear();
  const month = ref.getMonth(); // 0-indexed
  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;

  // Filter to current month only
  const thisMonth = dailyCosts.filter((p) => p.date.startsWith(monthPrefix));

  // Days elapsed = day-of-month of `now`
  const daysElapsed = ref.getDate();

  if (daysElapsed < 3 || thisMonth.length === 0) return null;

  const currentMonthCost = sumBy(thisMonth, "totalCost");
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const dailyAverage = currentMonthCost / daysElapsed;
  const projectedMonthCost = dailyAverage * daysInMonth;

  return { currentMonthCost, projectedMonthCost, daysElapsed, daysInMonth, dailyAverage };
}

// ---------------------------------------------------------------------------
// Current-month token total
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Cost-per-token comparison
// ---------------------------------------------------------------------------

/** Effective cost efficiency for a single model/source pair. */
export interface ModelCostEfficiency {
  model: string;
  source: string;
  totalCost: number;
  totalTokens: number;
  costPer1K: number; // totalCost / totalTokens * 1000
}

/**
 * Compute cost-per-1K-tokens for each model aggregate.
 *
 * Filters out models with zero total tokens, computes estimated cost via
 * `lookupPricing` + `estimateCost`, and returns sorted by `costPer1K`
 * descending (most expensive first).
 */
export function computeCostPerToken(
  models: ModelAggregate[],
  pricingMap: PricingMap,
): ModelCostEfficiency[] {
  const results: ModelCostEfficiency[] = [];

  for (const m of models) {
    if (m.total === 0) continue;

    const pricing = lookupPricing(pricingMap, m.model, m.source);
    const cost = estimateCost(m.input, m.output, m.cached, pricing);

    results.push({
      model: m.model,
      source: m.source,
      totalCost: cost.totalCost,
      totalTokens: m.total,
      costPer1K: (cost.totalCost / m.total) * 1000,
    });
  }

  return results.sort((a, b) => b.costPer1K - a.costPer1K);
}

// ---------------------------------------------------------------------------
// Daily cache rate trend
// ---------------------------------------------------------------------------

/** A single day's cache hit rate for the cache rate trend chart. */
export interface DailyCacheRate {
  date: string;       // "2026-03-10"
  cacheRate: number;  // cached_input_tokens / input_tokens * 100
  cachedTokens: number;
  inputTokens: number;
}

/**
 * Aggregate usage rows into daily cache hit rates.
 *
 * Groups rows by date (first 10 chars of `hour_start`), sums
 * `cached_input_tokens` and `input_tokens`, and computes the ratio.
 * Days with zero input tokens get `cacheRate = 0`.
 * Returns sorted ascending by date.
 */
export function toDailyCacheRates(rows: UsageRow[], tzOffset: number = 0): DailyCacheRate[] {
  const byDate = new Map<string, { cachedTokens: number; inputTokens: number }>();

  for (const r of rows) {
    const date = toLocalDateStr(r.hour_start, tzOffset);
    const existing = byDate.get(date);
    if (existing) {
      existing.cachedTokens += r.cached_input_tokens;
      existing.inputTokens += r.input_tokens;
    } else {
      byDate.set(date, {
        cachedTokens: r.cached_input_tokens,
        inputTokens: r.input_tokens,
      });
    }
  }

  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { cachedTokens, inputTokens }]) => ({
      date,
      cacheRate: inputTokens > 0 ? (cachedTokens / inputTokens) * 100 : 0,
      cachedTokens,
      inputTokens,
    }));
}

// ---------------------------------------------------------------------------
// Reasoning ratio
// ---------------------------------------------------------------------------

export interface ReasoningRatio {
  reasoningTokens: number;
  outputTokens: number;
  reasoningPercent: number;  // reasoning / output * 100
}

/**
 * Compute the percentage of output tokens that are reasoning (thinking) tokens.
 *
 * Indicates "thinking depth" for reasoning models (o3, claude-opus, etc.).
 * Returns 0% when output_tokens is 0.
 */
export function computeReasoningRatio(summary: UsageSummary): ReasoningRatio {
  const { output_tokens, reasoning_output_tokens } = summary;
  return {
    reasoningTokens: reasoning_output_tokens,
    outputTokens: output_tokens,
    reasoningPercent:
      output_tokens > 0 ? (reasoning_output_tokens / output_tokens) * 100 : 0,
  };
}
