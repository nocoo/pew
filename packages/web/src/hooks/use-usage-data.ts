"use client";

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UsageRow {
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
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
}

export interface UsageData {
  records: UsageRow[];
  summary: UsageSummary;
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
  label: string;
  value: number;
}

/** Heatmap data point (date + total tokens) */
export interface HeatmapPoint {
  date: string;
  value: number;
}

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

/** Aggregate records into daily points */
export function toDailyPoints(records: UsageRow[]): DailyPoint[] {
  const byDate = new Map<string, DailyPoint>();

  for (const r of records) {
    const date = r.hour_start.slice(0, 10); // "2026-03-07"
    const existing = byDate.get(date);
    if (existing) {
      existing.input += r.input_tokens;
      existing.output += r.output_tokens;
      existing.cached += r.cached_input_tokens;
      existing.reasoning += r.reasoning_output_tokens;
      existing.total += r.total_tokens;
    } else {
      byDate.set(date, {
        date,
        input: r.input_tokens,
        output: r.output_tokens,
        cached: r.cached_input_tokens,
        reasoning: r.reasoning_output_tokens,
        total: r.total_tokens,
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
    bySource.set(r.source, (bySource.get(r.source) ?? 0) + r.total_tokens);
  }

  return Array.from(bySource.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

/** Convert daily points to heatmap-compatible data */
export function toHeatmapData(daily: DailyPoint[]): HeatmapPoint[] {
  return daily.map((d) => ({ date: d.date, value: d.total }));
}

// ---------------------------------------------------------------------------
// Pretty source names
// ---------------------------------------------------------------------------

const SOURCE_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  "gemini-cli": "Gemini CLI",
  opencode: "OpenCode",
  openclaw: "OpenClaw",
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseUsageDataOptions {
  /** Number of days to look back (default 30) */
  days?: number;
  /** Source filter (optional) */
  source?: string;
}

interface UseUsageDataResult {
  data: UsageData | null;
  daily: DailyPoint[];
  sources: SourceAggregate[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useUsageData(
  options: UseUsageDataOptions = {}
): UseUsageDataResult {
  const { days = 30, source } = options;
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const from = new Date();
      from.setDate(from.getDate() - days);
      const params = new URLSearchParams({
        from: from.toISOString().slice(0, 10),
        granularity: "day",
      });
      if (source) params.set("source", source);

      const res = await fetch(`/api/usage?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `HTTP ${res.status}`
        );
      }

      const json = (await res.json()) as UsageData;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [days, source]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const daily = data ? toDailyPoints(data.records) : [];
  const sources = data
    ? toSourceAggregates(data.records).map((s) => ({
        ...s,
        label: sourceLabel(s.label),
      }))
    : [];

  return { data, daily, sources, loading, error, refetch: fetchData };
}
