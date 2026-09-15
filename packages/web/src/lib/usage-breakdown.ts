import type { DeviceTimelinePoint } from "@pew/core";
import { accountedTotal } from "./accounting";
import { fillDateRange } from "./date-helpers";
import { rankUsageByRecency } from "./usage-helpers";
import { toLocalDateStr, type UsageRow } from "./usage-transforms";

export type UsageDimension = "model" | "harness" | "device";

export interface UsageBreakdownSeries {
  key: string;
  /** null denotes the combined long tail, distinct from a model named "Other". */
  id: string | null;
  total: number;
}

export interface UsageBreakdownPoint {
  date: string;
  [key: string]: string | number;
}

/** One set of totals for daily stacks and period shares. Device data is projected by useDeviceData. */
export function toUsageBreakdown(
  records: UsageRow[],
  timeline: DeviceTimelinePoint[],
  dimension: UsageDimension,
  range: { start: string; end: string },
  tzOffset: number,
) {
  const from = new Date(range.start).getTime();
  const to = new Date(range.end).getTime();
  const samples = dimension === "device"
    ? timeline.map((r) => ({ date: toLocalDateStr(r.date, tzOffset), id: r.device_id, value: r.total_tokens }))
    : records.map((r) => ({ date: toLocalDateStr(r.hour_start, tzOffset),
      id: dimension === "model" ? r.model : r.source, value: accountedTotal(r) }));
  const selected = samples.filter((s) => {
    const time = new Date(s.date).getTime();
    return time >= from && time <= to && s.value > 0;
  });
  const totals = new Map<string, number>();
  for (const sample of selected) totals.set(sample.id, (totals.get(sample.id) ?? 0) + sample.value);
  const ranked = dimension === "model"
    ? rankUsageByRecency(selected).map((id) => [id, totals.get(id) ?? 0] as const)
    : [...totals].sort(([a, av], [b, bv]) => bv - av || a.localeCompare(b));
  // Generated keys keep dots, brackets and reserved names out of Recharts data paths.
  const series: UsageBreakdownSeries[] = ranked.slice(0, 5).map(([id, total], i) => ({ key: `s${i}`, id, total }));
  if (ranked.length > 5) series.push({ key: "other", id: null, total: ranked.slice(5).reduce((n, [, value]) => n + value, 0) });
  const keys = new Map(series.map((s) => [s.id, s.key]));
  const zero = (date: string): UsageBreakdownPoint => ({ date, ...Object.fromEntries(series.map((s) => [s.key, 0])) });
  const byDate = new Map<string, UsageBreakdownPoint>();
  for (const sample of selected) {
    const point = byDate.get(sample.date) ?? zero(sample.date);
    const key = keys.get(sample.id) ?? "other";
    point[key] = Number(point[key]) + sample.value;
    byDate.set(sample.date, point);
  }
  const daily = fillDateRange([zero(range.start), ...[...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))], "date", zero, range.end);
  return { daily, series, total: series.reduce((n, s) => n + s.total, 0) };
}
