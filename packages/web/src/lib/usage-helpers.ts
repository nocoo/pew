/**
 * Usage data aggregation helpers extracted from page components.
 *
 * These pure functions group UsageRow[] into higher-level aggregates
 * (by model, by app/source, by date) for the dashboard views.
 */

import type { UsageRow } from "@/hooks/use-usage-data";
import { sourceLabel } from "@/hooks/use-usage-data";
import { lookupPricing, estimateCost } from "@/lib/pricing";
import type { PricingMap } from "@/lib/pricing";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelGroup {
  model: string;
  sources: string[];
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
  estimatedCost: number;
  pctOfTotal: number;
}

export interface ModelRow {
  model: string;
  input: number;
  output: number;
  cached: number;
  total: number;
  cost: number;
}

export interface AppGroup {
  source: string;
  label: string;
  records: UsageRow[];
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
  estimatedCost: number;
  models: ModelRow[];
}

export interface DailyGroup {
  date: string;
  records: UsageRow[];
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

/** Local-day bucket with aggregated token counts. */
export interface LocalDailyBucket {
  /** Local date string "YYYY-MM-DD" */
  date: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
}

/** Weekday vs weekend comparison stats. */
export interface WeekdayWeekendStats {
  weekday: { avgTokens: number; avgCost: number; totalDays: number };
  weekend: { avgTokens: number; avgCost: number; totalDays: number };
  /** weekday.avgTokens / weekend.avgTokens (0 if either side has 0 days) */
  ratio: number;
}

/** Month-over-month comparison stats. */
export interface MoMComparison {
  currentMonth: { tokens: number; cost: number; days: number };
  previousMonth: { tokens: number; cost: number; days: number };
  /** Percentage change in tokens: (current - previous) / previous * 100 */
  tokenGrowth: number;
  /** Percentage change in cost: (current - previous) / previous * 100 */
  costGrowth: number;
}

/** Consecutive usage day streak info. */
export interface StreakInfo {
  /** Consecutive days ending today (or yesterday) */
  currentStreak: number;
  /** Longest streak within available data */
  longestStreak: number;
  /** Start date of longest streak ("YYYY-MM-DD") */
  longestStreakStart: string;
  /** End date of longest streak ("YYYY-MM-DD") */
  longestStreakEnd: string;
  /** Whether there is usage today */
  isActiveToday: boolean;
}

export interface SourceTrendPoint {
  date: string;
  sources: Record<string, number>;
}

export interface DailyDominantSource {
  date: string;
  /** Source with highest total_tokens that day */
  dominantSource: string;
  /** Percentage of daily total (0–100) */
  dominantShare: number;
  /** Per-source token totals for the day */
  sources: Record<string, number>;
}

// ---------------------------------------------------------------------------
// groupByModel
// ---------------------------------------------------------------------------

/** Group usage records by model, compute per-model aggregates. */
export function groupByModel(records: UsageRow[], pricingMap: PricingMap): ModelGroup[] {
  const byModel = new Map<string, {
    sources: Set<string>;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    totalTokens: number;
    estimatedCost: number;
  }>();

  let grandTotal = 0;

  for (const r of records) {
    grandTotal += r.total_tokens;
    const existing = byModel.get(r.model);
    const pricing = lookupPricing(pricingMap, r.model, r.source);
    const cost = estimateCost(r.input_tokens, r.output_tokens, r.cached_input_tokens, pricing);

    if (existing) {
      existing.sources.add(r.source);
      existing.inputTokens += r.input_tokens;
      existing.outputTokens += r.output_tokens;
      existing.cachedTokens += r.cached_input_tokens;
      existing.totalTokens += r.total_tokens;
      existing.estimatedCost += cost.totalCost;
    } else {
      byModel.set(r.model, {
        sources: new Set([r.source]),
        inputTokens: r.input_tokens,
        outputTokens: r.output_tokens,
        cachedTokens: r.cached_input_tokens,
        totalTokens: r.total_tokens,
        estimatedCost: cost.totalCost,
      });
    }
  }

  return Array.from(byModel.entries())
    .map(([model, data]) => ({
      model,
      sources: Array.from(data.sources),
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      cachedTokens: data.cachedTokens,
      totalTokens: data.totalTokens,
      estimatedCost: data.estimatedCost,
      pctOfTotal: grandTotal > 0 ? (data.totalTokens / grandTotal) * 100 : 0,
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens);
}

// ---------------------------------------------------------------------------
// groupByApp
// ---------------------------------------------------------------------------

/** Group usage records by source (app), with nested per-model breakdown. */
export function groupByApp(records: UsageRow[], pricingMap: PricingMap): AppGroup[] {
  const bySource = new Map<string, UsageRow[]>();

  for (const r of records) {
    const existing = bySource.get(r.source);
    if (existing) {
      existing.push(r);
    } else {
      bySource.set(r.source, [r]);
    }
  }

  return Array.from(bySource.entries())
    .map(([source, recs]) => {
      let inputTokens = 0;
      let outputTokens = 0;
      let cachedTokens = 0;
      let totalTokens = 0;
      let estimatedCost = 0;

      const byModel = new Map<string, ModelRow>();

      for (const r of recs) {
        inputTokens += r.input_tokens;
        outputTokens += r.output_tokens;
        cachedTokens += r.cached_input_tokens;
        totalTokens += r.total_tokens;

        const pricing = lookupPricing(pricingMap, r.model, r.source);
        const cost = estimateCost(r.input_tokens, r.output_tokens, r.cached_input_tokens, pricing);
        estimatedCost += cost.totalCost;

        const existing = byModel.get(r.model);
        if (existing) {
          existing.input += r.input_tokens;
          existing.output += r.output_tokens;
          existing.cached += r.cached_input_tokens;
          existing.total += r.total_tokens;
          existing.cost += cost.totalCost;
        } else {
          byModel.set(r.model, {
            model: r.model,
            input: r.input_tokens,
            output: r.output_tokens,
            cached: r.cached_input_tokens,
            total: r.total_tokens,
            cost: cost.totalCost,
          });
        }
      }

      const models = Array.from(byModel.values()).sort((a, b) => b.total - a.total);

      return {
        source,
        label: sourceLabel(source),
        records: recs,
        inputTokens,
        outputTokens,
        cachedTokens,
        totalTokens,
        estimatedCost,
        models,
      };
    })
    .sort((a, b) => b.totalTokens - a.totalTokens);
}

// ---------------------------------------------------------------------------
// groupByDate
// ---------------------------------------------------------------------------

/** Group usage records by date (YYYY-MM-DD), sorted newest-first. */
export function groupByDate(records: UsageRow[], pricingMap: PricingMap): DailyGroup[] {
  const byDate = new Map<string, UsageRow[]>();

  for (const r of records) {
    const date = r.hour_start.slice(0, 10);
    const existing = byDate.get(date);
    if (existing) {
      existing.push(r);
    } else {
      byDate.set(date, [r]);
    }
  }

  return Array.from(byDate.entries())
    .map(([date, recs]) => {
      let inputTokens = 0;
      let outputTokens = 0;
      let cachedTokens = 0;
      let totalTokens = 0;
      let cost = 0;

      for (const r of recs) {
        inputTokens += r.input_tokens;
        outputTokens += r.output_tokens;
        cachedTokens += r.cached_input_tokens;
        totalTokens += r.total_tokens;
        const pricing = lookupPricing(pricingMap, r.model, r.source);
        const c = estimateCost(
          r.input_tokens,
          r.output_tokens,
          r.cached_input_tokens,
          pricing,
        );
        cost += c.totalCost;
      }

      return {
        date,
        records: recs,
        inputTokens,
        outputTokens,
        cachedTokens,
        totalTokens,
        estimatedCost: cost,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

// ---------------------------------------------------------------------------
// Extract helpers
// ---------------------------------------------------------------------------

/** Extract unique source values from records, sorted alphabetically. */
export function extractSources(records: UsageRow[]): string[] {
  const set = new Set<string>();
  for (const r of records) set.add(r.source);
  return Array.from(set).sort();
}

/** Extract unique model values from records, sorted alphabetically. */
export function extractModels(records: UsageRow[]): string[] {
  const set = new Set<string>();
  for (const r of records) set.add(r.model);
  return Array.from(set).sort();
}

// ---------------------------------------------------------------------------
// toLocalDailyBuckets
// ---------------------------------------------------------------------------

/**
 * Re-bucket half-hour UsageRow[] into local-day totals.
 *
 * Applies `tzOffset` (minutes, from `new Date().getTimezoneOffset()`) to shift
 * each row's `hour_start` from UTC to local time, then groups by local date.
 * Results are sorted ascending by date.
 *
 * @param rows     — raw UsageRow[] (should be half-hour granularity for accuracy)
 * @param tzOffset — minutes offset from UTC (positive = west, e.g. 480 for PST)
 */
export function toLocalDailyBuckets(
  rows: UsageRow[],
  tzOffset: number = 0,
): LocalDailyBucket[] {
  const byDate = new Map<string, LocalDailyBucket>();

  for (const r of rows) {
    // Shift UTC time by tzOffset to get local time
    const utcMs = new Date(r.hour_start).getTime();
    const localMs = utcMs - tzOffset * 60_000;
    const localDate = new Date(localMs);
    const date = localDate.toISOString().slice(0, 10);

    const existing = byDate.get(date);
    if (existing) {
      existing.inputTokens += r.input_tokens;
      existing.outputTokens += r.output_tokens;
      existing.cachedTokens += r.cached_input_tokens;
      existing.totalTokens += r.total_tokens;
    } else {
      byDate.set(date, {
        date,
        inputTokens: r.input_tokens,
        outputTokens: r.output_tokens,
        cachedTokens: r.cached_input_tokens,
        totalTokens: r.total_tokens,
      });
    }
  }

  return Array.from(byDate.values()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}

// ---------------------------------------------------------------------------
// compareWeekdayWeekend
// ---------------------------------------------------------------------------

/**
 * Compare average daily token usage and cost between weekdays and weekends.
 *
 * Generates a complete calendar between `dateRange.from` and `dateRange.to`
 * (inclusive), left-joins with local-day buckets (zero-filling missing days),
 * then partitions by local day-of-week (0/6 = weekend, 1-5 = weekday).
 * Averages are divided by **calendar days**, not active days.
 *
 * @param rows       — raw UsageRow[] (half-hour granularity for timezone accuracy)
 * @param dateRange  — period boundaries for calendar fill (local dates "YYYY-MM-DD")
 * @param pricingMap — pricing map for cost estimation
 * @param tzOffset   — minutes from UTC (positive = west), default 0
 */
export function compareWeekdayWeekend(
  rows: UsageRow[],
  dateRange: { from: string; to: string },
  pricingMap: PricingMap,
  tzOffset: number = 0,
): WeekdayWeekendStats {
  // 1. Re-bucket rows into local-day totals
  const buckets = toLocalDailyBuckets(rows, tzOffset);
  const bucketMap = new Map(buckets.map((b) => [b.date, b]));

  // 2. Also compute per-local-day cost from raw rows
  const costByDate = new Map<string, number>();
  for (const r of rows) {
    const utcMs = new Date(r.hour_start).getTime();
    const localMs = utcMs - tzOffset * 60_000;
    const localDate = new Date(localMs).toISOString().slice(0, 10);
    const pricing = lookupPricing(pricingMap, r.model, r.source);
    const cost = estimateCost(
      r.input_tokens,
      r.output_tokens,
      r.cached_input_tokens,
      pricing,
    );
    costByDate.set(localDate, (costByDate.get(localDate) ?? 0) + cost.totalCost);
  }

  // 3. Generate complete calendar and partition
  let weekdayTokens = 0;
  let weekdayCost = 0;
  let weekdayDays = 0;
  let weekendTokens = 0;
  let weekendCost = 0;
  let weekendDays = 0;

  const startMs = new Date(dateRange.from + "T00:00:00Z").getTime();
  const endMs = new Date(dateRange.to + "T00:00:00Z").getTime();
  const DAY_MS = 86_400_000;

  for (let ms = startMs; ms <= endMs; ms += DAY_MS) {
    const d = new Date(ms);
    const dateStr = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay(); // 0=Sun, 6=Sat

    const bucket = bucketMap.get(dateStr);
    const tokens = bucket?.totalTokens ?? 0;
    const cost = costByDate.get(dateStr) ?? 0;

    if (dow === 0 || dow === 6) {
      weekendTokens += tokens;
      weekendCost += cost;
      weekendDays++;
    } else {
      weekdayTokens += tokens;
      weekdayCost += cost;
      weekdayDays++;
    }
  }

  // 4. Compute averages
  const weekdayAvgTokens = weekdayDays > 0 ? weekdayTokens / weekdayDays : 0;
  const weekdayAvgCost = weekdayDays > 0 ? weekdayCost / weekdayDays : 0;
  const weekendAvgTokens = weekendDays > 0 ? weekendTokens / weekendDays : 0;
  const weekendAvgCost = weekendDays > 0 ? weekendCost / weekendDays : 0;

  // ratio: 0 if either side has 0 days
  const ratio =
    weekdayDays > 0 && weekendDays > 0 && weekendAvgTokens > 0
      ? weekdayAvgTokens / weekendAvgTokens
      : 0;

  return {
    weekday: { avgTokens: weekdayAvgTokens, avgCost: weekdayAvgCost, totalDays: weekdayDays },
    weekend: { avgTokens: weekendAvgTokens, avgCost: weekendAvgCost, totalDays: weekendDays },
    ratio,
  };
}

// ---------------------------------------------------------------------------
// computeMoMGrowth
// ---------------------------------------------------------------------------

/**
 * Compute month-over-month growth for tokens and cost.
 *
 * Splits rows by `hour_start` into current month and previous month,
 * computes totals, and calculates percentage change.
 * Returns 0 growth when previous month has no data (avoids Infinity).
 *
 * @param rows       — raw UsageRow[]
 * @param pricingMap — pricing map for cost estimation
 * @param now        — reference date (defaults to current date)
 */
export function computeMoMGrowth(
  rows: UsageRow[],
  pricingMap: PricingMap,
  now?: Date,
): MoMComparison {
  const ref = now ?? new Date();
  const currentYear = ref.getFullYear();
  const currentMonth = ref.getMonth(); // 0-indexed

  // Previous month (handles January → December of previous year)
  const prevYear = currentMonth === 0 ? currentYear - 1 : currentYear;
  const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;

  let curTokens = 0;
  let curCost = 0;
  const curDays = new Set<string>();

  let prevTokens = 0;
  let prevCost = 0;
  const prevDays = new Set<string>();

  for (const r of rows) {
    const d = new Date(r.hour_start);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const dateStr = r.hour_start.slice(0, 10);

    const pricing = lookupPricing(pricingMap, r.model, r.source);
    const cost = estimateCost(
      r.input_tokens,
      r.output_tokens,
      r.cached_input_tokens,
      pricing,
    );

    if (y === currentYear && m === currentMonth) {
      curTokens += r.total_tokens;
      curCost += cost.totalCost;
      curDays.add(dateStr);
    } else if (y === prevYear && m === prevMonth) {
      prevTokens += r.total_tokens;
      prevCost += cost.totalCost;
      prevDays.add(dateStr);
    }
  }

  // Growth: (current - previous) / previous * 100; 0 if no previous
  const tokenGrowth = prevTokens > 0
    ? ((curTokens - prevTokens) / prevTokens) * 100
    : 0;
  const costGrowth = prevCost > 0
    ? ((curCost - prevCost) / prevCost) * 100
    : 0;

  return {
    currentMonth: { tokens: curTokens, cost: curCost, days: curDays.size },
    previousMonth: { tokens: prevTokens, cost: prevCost, days: prevDays.size },
    tokenGrowth,
    costGrowth,
  };
}

// ---------------------------------------------------------------------------
// computeStreak
// ---------------------------------------------------------------------------

/**
 * Compute consecutive-day usage streaks, similar to GitHub contribution streaks.
 *
 * Re-buckets rows into local days using `toLocalDailyBuckets()`, then walks
 * the sorted dates to find current and longest streaks.
 *
 * Current streak: consecutive days ending at `today` or `yesterday`.
 * Longest streak: maximum consecutive run in available data.
 *
 * @param rows     — raw UsageRow[] (half-hour granularity for timezone accuracy)
 * @param today    — local date string "YYYY-MM-DD" (defaults to today)
 * @param tzOffset — minutes from UTC (positive = west), default 0
 */
export function computeStreak(
  rows: UsageRow[],
  today?: string,
  tzOffset: number = 0,
): StreakInfo {
  const buckets = toLocalDailyBuckets(rows, tzOffset);
  const activeDates = new Set(buckets.map((b) => b.date));

  if (activeDates.size === 0) {
    return {
      currentStreak: 0,
      longestStreak: 0,
      longestStreakStart: "",
      longestStreakEnd: "",
      isActiveToday: false,
    };
  }

  const todayStr = today ?? new Date().toISOString().slice(0, 10);
  const isActiveToday = activeDates.has(todayStr);
  const DAY_MS = 86_400_000;

  // Helper: get date string N days before a given date
  const dayBefore = (dateStr: string, n: number = 1): string => {
    const ms = new Date(dateStr + "T00:00:00Z").getTime() - n * DAY_MS;
    return new Date(ms).toISOString().slice(0, 10);
  };

  // Current streak: walk backwards from today (or yesterday if not active today)
  let currentStreak = 0;
  let checkDate = isActiveToday ? todayStr : dayBefore(todayStr);

  // If not active today and not active yesterday, current streak is 0
  if (!isActiveToday && !activeDates.has(checkDate)) {
    currentStreak = 0;
  } else {
    while (activeDates.has(checkDate)) {
      currentStreak++;
      checkDate = dayBefore(checkDate);
    }
  }

  // Longest streak: sort all dates and walk forward
  const sortedDates = Array.from(activeDates).sort();
  let longestStreak = 0;
  let longestStart = "";
  let longestEnd = "";
  let runLength = 1;
  let runStart = sortedDates[0]!;

  for (let i = 1; i < sortedDates.length; i++) {
    const prevDate = sortedDates[i - 1]!;
    const currDate = sortedDates[i]!;
    const prevMs = new Date(prevDate + "T00:00:00Z").getTime();
    const currMs = new Date(currDate + "T00:00:00Z").getTime();

    if (currMs - prevMs === DAY_MS) {
      runLength++;
    } else {
      if (runLength > longestStreak) {
        longestStreak = runLength;
        longestStart = runStart;
        longestEnd = prevDate;
      }
      runLength = 1;
      runStart = currDate;
    }
  }

  // Check the last run
  if (runLength > longestStreak) {
    longestStreak = runLength;
    longestStart = runStart;
    longestEnd = sortedDates[sortedDates.length - 1]!;
  }

  return {
    currentStreak,
    longestStreak,
    longestStreakStart: longestStart,
    longestStreakEnd: longestEnd,
    isActiveToday,
  };
}

// ---------------------------------------------------------------------------
// toSourceTrendPoints
// ---------------------------------------------------------------------------

/**
 * Group UsageRow[] by (date, source) and pivot into per-date records
 * with one key per source. Sources missing on a given date are zero-filled
 * so all dates have the same set of keys (needed for Recharts stacking).
 */
export function toSourceTrendPoints(rows: UsageRow[]): SourceTrendPoint[] {
  if (rows.length === 0) return [];

  // Collect all unique sources and accumulate by (date, source)
  const allSources = new Set<string>();
  const byDate = new Map<string, Map<string, number>>();

  for (const r of rows) {
    const date = r.hour_start.slice(0, 10);
    allSources.add(r.source);

    let dateMap = byDate.get(date);
    if (!dateMap) {
      dateMap = new Map<string, number>();
      byDate.set(date, dateMap);
    }
    dateMap.set(r.source, (dateMap.get(r.source) ?? 0) + r.total_tokens);
  }

  // Build result with zero-fill for missing sources
  const dates = Array.from(byDate.keys()).sort();
  const sourceKeys = Array.from(allSources);

  return dates.map((date) => {
    const dateMap = byDate.get(date)!;
    const sources: Record<string, number> = {};
    for (const s of sourceKeys) {
      sources[s] = dateMap.get(s) ?? 0;
    }
    return { date, sources };
  });
}

// ---------------------------------------------------------------------------
// toDominantSourceTimeline
// ---------------------------------------------------------------------------

/**
 * Group rows by date and identify the dominant source per day.
 * Ties are broken alphabetically by source name.
 */
export function toDominantSourceTimeline(rows: UsageRow[]): DailyDominantSource[] {
  if (rows.length === 0) return [];

  // Accumulate tokens per (date, source)
  const byDate = new Map<string, Map<string, number>>();

  for (const r of rows) {
    const date = r.hour_start.slice(0, 10);
    let dateMap = byDate.get(date);
    if (!dateMap) {
      dateMap = new Map<string, number>();
      byDate.set(date, dateMap);
    }
    dateMap.set(r.source, (dateMap.get(r.source) ?? 0) + r.total_tokens);
  }

  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dateMap]) => {
      const sources: Record<string, number> = {};
      let dayTotal = 0;
      let maxTokens = -1;
      let dominant = "";

      for (const [source, tokens] of dateMap.entries()) {
        sources[source] = tokens;
        dayTotal += tokens;
        if (tokens > maxTokens || (tokens === maxTokens && source < dominant)) {
          maxTokens = tokens;
          dominant = source;
        }
      }

      return {
        date,
        dominantSource: dominant,
        dominantShare: dayTotal > 0 ? (maxTokens / dayTotal) * 100 : 0,
        sources,
      };
    });
}
