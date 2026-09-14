/**
 * Cost computation helpers extracted from page components.
 *
 * `computeTotalCost` was duplicated in dashboard/page.tsx and
 * profile-view.tsx — now it lives here as the single source of truth.
 */

import { estimateUsageCost, displayCounters, modelUsage, summarizeAccounting } from "@/lib/accounting";
import type { ModelAggregate } from "@/hooks/use-usage-data";
import type { UsageRow, UsageSummary } from "@/hooks/use-usage-data";
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
    const cost = estimateUsageCost(modelUsage(m), pricingMap);
    total += cost.totalCost;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Daily cost aggregation
// ---------------------------------------------------------------------------

/** A single day's cost breakdown for the cost trend chart. */
export interface DailyCostPoint {
  cacheWriteCost?: number;
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
  tzOffset = 0,
): DailyCostPoint[] {
  const byDate = new Map<string, DailyCostPoint>();

  for (const r of rows) {
    const date = toLocalDateStr(r.hour_start, tzOffset);
    const cost = estimateUsageCost(r, pricingMap);

    const existing = byDate.get(date);
    if (existing) {
      existing.inputCost += cost.inputCost;
      existing.outputCost += cost.outputCost + cost.reasoningCost;
      existing.cachedCost += cost.cachedCost;
      existing.totalCost += cost.totalCost;
      if (cost.cacheWriteCost > 0) existing.cacheWriteCost = (existing.cacheWriteCost ?? 0) + cost.cacheWriteCost;
    } else {
      byDate.set(date, {
        date,
        inputCost: cost.inputCost,
        outputCost: cost.outputCost + cost.reasoningCost,
        cachedCost: cost.cachedCost,
        totalCost: cost.totalCost,
        ...(cost.cacheWriteCost > 0 ? { cacheWriteCost: cost.cacheWriteCost } : {}),
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
  netSavings: number | null; // read discount minus write premium; null when incomplete
  savingsPercent: number | null;
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
  let net = 0;
  let complete = true;

  for (const m of models) {
    const cost = estimateUsageCost(modelUsage(m), pricingMap);
    savedDollars += cost.readDiscount + cost.cachedCost;
    actualCachedCost += cost.cachedCost;
    net += cost.netSavings ?? 0;
    complete &&= cost.complete;
  }

  const netSavings = complete ? net : null;
  const savingsPercent = netSavings === null ? null : savedDollars > 0 ? (netSavings / savedDollars) * 100 : 0;

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

    const cost = estimateUsageCost(modelUsage(m), pricingMap);

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
  coverage?: number;
  coveredInputTokens?: number;
  date: string;       // "2026-03-10"
  cacheRate: number | null;  // read tokens / input with known reads; null when unreported
  cachedTokens: number;
  inputTokens: number;
}

/**
 * Aggregate usage rows into daily cache hit rates.
 *
 * Groups rows by date (first 10 chars of `hour_start`), sums
 * `cached_input_tokens` and `input_tokens`, and computes the hit rate as
 * `cached / (cached + input)` — `input_tokens` stores uncached-only tokens
 * (mutually exclusive with cached), so the denominator is the total input.
 * Days with zero total input tokens get `cacheRate = 0`.
 * Returns sorted ascending by date.
 */
export function toDailyCacheRates(rows: UsageRow[], tzOffset = 0): DailyCacheRate[] {
  const byDate = new Map<string, UsageRow[]>();
  for (const r of rows) {
    const date = toLocalDateStr(r.hour_start, tzOffset);
    const day = byDate.get(date) ?? []; day.push(r); byDate.set(date, day);
  }
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, records]) => {
    const summary = summarizeAccounting(records);
    return { date, cacheRate: summary.readCoverage > 0 ? summary.cacheReadRate : null, cachedTokens: summary.cacheReadTokens,
      inputTokens: summary.inputTokens - summary.cacheReadTokens, coverage: summary.readCoverage,
      coveredInputTokens: summary.inputTokens * summary.readCoverage };
  });
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
export function computeReasoningRatio(summary: UsageSummary, rows?: UsageRow[]): ReasoningRatio {
  const { output_tokens, reasoning_output_tokens } = summary;
  const reasoning = rows ? rows.reduce((n, r) => n + displayCounters(r).reasoning_output_tokens, 0) : reasoning_output_tokens;
  const output = rows ? summarizeAccounting(rows).outputTokens : output_tokens + reasoning_output_tokens;
  return {
    reasoningTokens: reasoning,
    outputTokens: output,
    reasoningPercent:
      output > 0 ? (reasoning / output) * 100 : 0,
  };
}
