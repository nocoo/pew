import { estimateUsageCost, summarizeAccounting, type AccountedUsage } from "./accounting";
import { fillDateRange, type Period } from "./date-helpers";
import type { PricingMap } from "./pricing";
import { toLocalDateStr, type UsageRow } from "./usage-transforms";

export type OverviewMetric = "tokens" | "cost" | "cache";

export interface OverviewTotals {
  tokens: number;
  cost: number;
  /** Known reads + writes. Null means neither count was collected. */
  cache: number | null;
  input: number;
  output: number;
  cacheRead: number | null;
  cacheWrite: number | null;
  readCoverage: number;
  writeCoverage: number;
  costComplete: boolean;
}

export interface OverviewGroup extends OverviewTotals { id: string }
export interface OverviewDay extends OverviewTotals { date: string }

const DAY_MS = 86_400_000;
const dayMs = (date: string) => new Date(`${date}T00:00:00Z`).getTime();

/** Both endpoints receive the same exact UTC bounds; chart labels remain local. */
export function overviewDateRange(period: Period, today: string, tzOffset: number) {
  const day = new Date(dayMs(today));
  if (period === "month") day.setUTCDate(1);
  if (period === "week") day.setUTCDate(day.getUTCDate() - day.getUTCDay());
  const start = period === "all" ? null : day.toISOString().slice(0, 10);
  return {
    start,
    end: today,
    from: new Date(dayMs(start ?? "2020-01-01") + tzOffset * 60_000).toISOString(),
    to: new Date(dayMs(today) + DAY_MS + tzOffset * 60_000).toISOString(),
  };
}

function summarizeOverview(rows: AccountedUsage[], pricingMap: PricingMap): OverviewTotals {
  const summary = summarizeAccounting(rows);
  const costs = rows.map((row) => estimateUsageCost(row, pricingMap));
  const cacheRead = summary.inputTokens === 0 || summary.readCoverage > 0 ? summary.cacheReadTokens : null;
  const cacheWrite = summary.inputTokens === 0 || summary.writeCoverage > 0 ? summary.cacheWriteTokens : null;
  return {
    tokens: summary.totalTokens,
    input: summary.inputTokens,
    output: summary.outputTokens,
    cost: costs.reduce((sum, cost) => sum + cost.totalCost, 0),
    costComplete: costs.every((cost) => cost.complete),
    cache: cacheRead === null && cacheWrite === null ? null : (cacheRead ?? 0) + (cacheWrite ?? 0),
    cacheRead,
    cacheWrite,
    readCoverage: summary.readCoverage,
    writeCoverage: summary.writeCoverage,
  };
}

/** Group original bases, never counters that have already been projected for display. */
export function groupOverview<T extends AccountedUsage>(
  rows: T[], pricingMap: PricingMap, key: (row: T) => string,
): OverviewGroup[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    const group = groups.get(id);
    if (group) group.push(row);
    else groups.set(id, [row]);
  }
  return [...groups].map(([id, group]) => ({ id, ...summarizeOverview(group, pricingMap) }));
}

export function metricIsComplete(metric: OverviewMetric, totals: OverviewTotals): boolean {
  if (metric === "cost") return totals.costComplete;
  if (metric === "cache") return totals.input === 0 || (totals.readCoverage === 1 && totals.writeCoverage === 1);
  return true;
}

export function rankOverviewGroups(groups: OverviewGroup[], metric: OverviewMetric): OverviewGroup[] {
  return [...groups].sort((a, b) => (b[metric] ?? -1) - (a[metric] ?? -1) || a.id.localeCompare(b.id));
}

export function buildOverview(
  records: UsageRow[], pricingMap: PricingMap,
  range: ReturnType<typeof overviewDateRange>, tzOffset = 0,
) {
  const startMs = dayMs(range.start ?? "2020-01-01");
  const endMs = dayMs(range.end);
  const selected = records.filter((row) => {
    const date = dayMs(toLocalDateStr(row.hour_start, tzOffset));
    return date >= startMs && date <= endMs;
  });
  const sparse = groupOverview(selected, pricingMap, (r) => toLocalDateStr(r.hour_start, tzOffset))
    .map(({ id, ...totals }): OverviewDay => ({ date: id, ...totals }))
    .sort((a, b) => dayMs(a.date) - dayMs(b.date));
  const zero = summarizeOverview([], pricingMap);
  // Seed the period boundary so inactive days before the first request are included.
  const seeded = range.start ? [{ date: range.start, ...zero }, ...sparse] : sparse;
  const daily = fillDateRange(seeded, "date", (date) => ({ date, ...zero }), range.end);
  const summary = summarizeOverview(selected, pricingMap);
  return {
    records: selected,
    summary,
    daily,
    dailyAverageCost: daily.length > 0 ? summary.cost / daily.length : 0,
    models: groupOverview(selected, pricingMap, (r) => r.model),
    harnesses: groupOverview(selected, pricingMap, (r) => r.source),
  };
}
