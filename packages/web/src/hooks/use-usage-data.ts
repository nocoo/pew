"use client";

import { useMemo } from "react";
import { useDerivedUsageData } from "@/hooks/use-derived-usage-data";

import type { UsageRow, UsageSummary } from "@/lib/usage-transforms";
import type { DailyPoint, SourceAggregate, ModelAggregate } from "@/lib/usage-transforms";
import { useFetchData } from "@/hooks/use-fetch-data";
import { useTzOffset } from "@/hooks/use-tz-offset";

// ---------------------------------------------------------------------------
// Re-export types and helpers for backward compatibility
// ---------------------------------------------------------------------------

export type { UsageRow, UsageSummary, DailyPoint, SourceAggregate, HeatmapPoint, ModelAggregate } from "@/lib/usage-transforms";
export { toDailyPoints, toSourceAggregates, toHeatmapData, toModelAggregates, sourceLabel } from "@/lib/usage-transforms";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UsageData {
  records: UsageRow[];
  summary: UsageSummary;
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

  // Frozen per mount — acceptable; page refresh handles DST changes
  const tzOffset = useTzOffset();

  const url = useMemo(() => {
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
      params.set("tzOffset", String(tzOffset));
    }

    return `/api/usage?${params.toString()}`;
  }, [days, fromDate, toDate, source, deviceId, granularity, tzOffset]);

  const { data, loading, error, refetch } = useFetchData<UsageData>(url);

  // Memoize derived data to avoid recalculation on every render
  const { daily, sources, models } = useDerivedUsageData(data?.records ?? null, tzOffset);

  return { data, daily, sources, models, loading, error, refetch };
}
