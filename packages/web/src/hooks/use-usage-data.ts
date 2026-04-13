"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

import { toLocalDateStr } from "@/lib/usage-helpers";

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
  model: string;
  source: string;
  input: number;
  output: number;
  cached: number;
  total: number;
}

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

/** Aggregate records into daily points */
export function toDailyPoints(records: UsageRow[], tzOffset: number = 0): DailyPoint[] {
  const byDate = new Map<string, DailyPoint>();

  for (const r of records) {
    const date = toLocalDateStr(r.hour_start, tzOffset); // "2026-03-07"
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
      existing.total += r.total_tokens;
    } else {
      byModel.set(key, {
        model: r.model,
        source: r.source,
        input: r.input_tokens,
        output: r.output_tokens,
        cached: r.cached_input_tokens,
        total: r.total_tokens,
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
  hermes: "Hermes Agent",
  kosmos: "Kosmos",
  opencode: "OpenCode",
  openclaw: "OpenClaw",
  pi: "Pi",
  pmstudio: "PM Studio",
  "vscode-copilot": "VS Code Copilot",
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseUsageDataOptions {
  /** Number of days to look back (default 30). Ignored when `from` is set. */
  days?: number;
  /** Explicit start date (ISO date string, e.g. "2026-01-01") */
  from?: string;
  /** Explicit end date (ISO date string). Defaults to today. */
  to?: string;
  /** Source filter (optional) */
  source?: string;
  /** Device filter (optional) */
  deviceId?: string;
  /** Granularity for the API query (default "day"). Use "half-hour" for time-of-day analysis. */
  granularity?: "day" | "half-hour";
}

interface UseUsageDataResult {
  data: UsageData | null;
  daily: DailyPoint[];
  sources: SourceAggregate[];
  models: ModelAggregate[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useUsageData(
  options: UseUsageDataOptions = {}
): UseUsageDataResult {
  const { days = 30, from: fromDate, to: toDate, source, deviceId, granularity = "day" } = options;
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);

    try {
      // When explicit `from` is provided, use it directly; otherwise compute from `days`
      let fromStr: string;
      if (fromDate) {
        fromStr = fromDate;
      } else {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() - days);
        fromStr = d.toISOString().slice(0, 10);
      }

      const params = new URLSearchParams({
        from: fromStr,
        granularity,
      });
      if (toDate) params.set("to", toDate);
      if (source) params.set("source", source);
      if (deviceId) params.set("deviceId", deviceId);
      if (granularity === "day") {
        params.set("tzOffset", String(new Date().getTimezoneOffset()));
      }

      const res = await fetch(`/api/usage?${params.toString()}`, signal ? { signal } : undefined);

      if (signal?.aborted) return;

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `HTTP ${res.status}`
        );
      }

      const json = (await res.json()) as UsageData;

      if (signal?.aborted) return;

      setData(json);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [days, fromDate, toDate, source, deviceId, granularity]);

  useEffect(() => {
    const controller = new AbortController();

    // Clear data on filter change to avoid stale data
    setData(null);

    fetchData(controller.signal);

    return () => {
      controller.abort();
    };
  }, [fetchData]);

  // Memoize derived data to avoid recalculation on every render
  const tzOffset = useMemo(() => new Date().getTimezoneOffset(), []); // frozen per mount — acceptable; page refresh handles DST changes
  const daily = useMemo(
    () => (data ? toDailyPoints(data.records, tzOffset) : []),
    [data, tzOffset],
  );
  const sources = useMemo(
    () =>
      data
        ? toSourceAggregates(data.records).map((s) => ({
            ...s,
            label: sourceLabel(s.label),
          }))
        : [],
    [data],
  );
  const models = useMemo(
    () => (data ? toModelAggregates(data.records) : []),
    [data],
  );

  return { data, daily, sources, models, loading, error, refetch: () => fetchData() };
}
