/**
 * Pure types and aggregation helpers for usage data.
 *
 * Extracted from `hooks/use-usage-data.ts` to break the circular dependency
 * between `use-usage-data.ts` ↔ `use-derived-usage-data.ts`.
 *
 * This module has NO imports from `hooks/` — only from `lib/`.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
import type { AccountingAnnotation } from "@pew/core";
import { accountedTotal, displayCounters } from "./accounting";

export interface UsageRow {
  accounting?: AccountingAnnotation[];
  evidence_tokens?: number;
  approximate_tokens?: number;
  source: string;
  model: string;
  hour_start: string;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
}

export interface UsageSummary {
  evidence_tokens?: number;
  approximate_tokens?: number;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
}

/** Aggregated daily data point for charts */
export interface DailyPoint {
  date: string;
  input: number;
  output: number;
  cached: number;
  reasoning: number;
  total: number;
}

/** Source aggregate for donut chart */
export interface SourceAggregate {
  /** Raw source slug (e.g. "claude-code") */
  source: string;
  label: string;
  value: number;
}

/** Heatmap data point (date + total tokens) */
export interface HeatmapPoint {
  date: string;
  value: number;
}

/** Model aggregate for bar chart */
export interface ModelAggregate {
  accounting?: AccountingAnnotation[];
  model: string;
  source: string;
  input: number;
  output: number;
  cached: number;
  reasoning: number;
  total: number;
}

// ---------------------------------------------------------------------------
// Shared UTC→local date conversion
// ---------------------------------------------------------------------------

/**
 * Convert a UTC `hour_start` timestamp to a local date string "YYYY-MM-DD".
 *
 * Applies `tzOffset` (minutes, from `new Date().getTimezoneOffset()`) to shift
 * the timestamp from UTC to local time. When `tzOffset` is 0, this is
 * equivalent to `hourStart.slice(0, 10)`.
 *
 * When the input is already a bare date ("YYYY-MM-DD", length 10), it was
 * produced by `date(hour_start)` in a day-granularity query and is already
 * a UTC-aggregated bucket. Applying a timezone shift would move it to the
 * wrong day, so we return it as-is.
 */
export function toLocalDateStr(hourStart: string, tzOffset: number): string {
  // Bare date from day-granularity query — already aggregated, don't shift
  if (hourStart.length === 10) return hourStart;
  if (tzOffset === 0) return hourStart.slice(0, 10);
  const utcMs = new Date(hourStart).getTime();
  const localMs = utcMs - tzOffset * 60_000;
  return new Date(localMs).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

/** Aggregate records into daily points */
export function toDailyPoints(records: UsageRow[], tzOffset = 0): DailyPoint[] {
  const byDate = new Map<string, DailyPoint>();

  for (const r of records) {
    const date = toLocalDateStr(r.hour_start, tzOffset); // "2026-03-07"
    const d = displayCounters(r);
    const existing = byDate.get(date);
    if (existing) {
      existing.input += d.input_tokens;
      existing.output += d.output_tokens;
      existing.cached += d.cached_input_tokens;
      existing.reasoning += d.reasoning_output_tokens;
      existing.total += d.total_tokens;
    } else {
      byDate.set(date, {
        date,
        input: d.input_tokens,
        output: d.output_tokens,
        cached: d.cached_input_tokens,
        reasoning: d.reasoning_output_tokens,
        total: d.total_tokens,
      });
    }
  }

  return Array.from(byDate.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );
}

/** Aggregate records by source */
export function toSourceAggregates(records: UsageRow[]): SourceAggregate[] {
  const bySource = new Map<string, number>();

  for (const r of records) {
    bySource.set(r.source, (bySource.get(r.source) ?? 0) + accountedTotal(r));
  }

  return Array.from(bySource.entries())
    .map(([source, value]) => ({ source, label: source, value }))
    .sort((a, b) => b.value - a.value);
}

/** Convert daily points to heatmap-compatible data */
export function toHeatmapData(daily: DailyPoint[]): HeatmapPoint[] {
  return daily.map((d) => ({ date: d.date, value: d.total }));
}

/** Aggregate records by model */
export function toModelAggregates(records: UsageRow[]): ModelAggregate[] {
  const byModel = new Map<string, ModelAggregate>();

  for (const r of records) {
    const key = `${r.source}:${r.model}`;
    const existing = byModel.get(key);
    if (existing) {
      existing.input += r.input_tokens;
      existing.output += r.output_tokens;
      existing.cached += r.cached_input_tokens;
      existing.reasoning += r.reasoning_output_tokens;
      existing.total += accountedTotal(r);
      if (r.accounting) existing.accounting = [...(existing.accounting ?? []), ...r.accounting];
    } else {
      byModel.set(key, {
        model: r.model,
        source: r.source,
        input: r.input_tokens,
        output: r.output_tokens,
        cached: r.cached_input_tokens,
        reasoning: r.reasoning_output_tokens,
        total: accountedTotal(r),
        ...(r.accounting ? { accounting: [...r.accounting] } : {}),
      });
    }
  }

  return Array.from(byModel.values()).sort((a, b) => b.total - a.total);
}

// ---------------------------------------------------------------------------
// Pretty source names
// ---------------------------------------------------------------------------

const SOURCE_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  "copilot-cli": "GitHub Copilot CLI",
  "gemini-cli": "Gemini CLI",
  grok: "Grok",
  hermes: "Hermes Agent",
  kosmos: "Kosmos",
  omp: "Oh My Pi",
  opencode: "OpenCode",
  openclaw: "OpenClaw",
  pi: "Pi",
  pmstudio: "PM Studio",
  "vscode-copilot": "VS Code Copilot",
  zcode: "ZCode",
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}
