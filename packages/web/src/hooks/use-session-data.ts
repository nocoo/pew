"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  toSessionOverview,
  toWorkingHoursGrid,
  toMessageDailyStats,
  toProjectBreakdown,
  type SessionRow,
  type SessionOverview,
  type WorkingHoursDay,
  type MessageDailyStat,
  type ProjectBreakdownItem,
} from "@/lib/session-helpers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UseSessionDataOptions {
  /** Explicit start date (ISO date string, e.g. "2026-01-01") */
  from?: string;
  /** Explicit end date (ISO date string). Defaults to today. */
  to?: string;
  /** Source filter (optional) */
  source?: string;
  /** When false, skip fetching entirely. Defaults to true. */
  enabled?: boolean;
}

interface UseSessionDataResult {
  records: SessionRow[];
  overview: SessionOverview;
  hoursGrid: WorkingHoursDay[];
  dailyMessages: MessageDailyStat[];
  projectBreakdown: ProjectBreakdownItem[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSessionData(
  options: UseSessionDataOptions = {}
): UseSessionDataResult {
  const { from: fromDate, to: toDate, source, enabled = true } = options;
  const [records, setRecords] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (signal?: AbortSignal) => {
    if (!enabled) return;
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);
      if (source) params.set("source", source);

      const qs = params.toString();
      const url = qs ? `/api/sessions?${qs}` : "/api/sessions";
      const res = await fetch(url, signal ? { signal } : undefined);

      if (signal?.aborted) return;

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `HTTP ${res.status}`
        );
      }

      const json = (await res.json()) as { records: SessionRow[] };

      if (signal?.aborted) return;

      setRecords(json.records);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [fromDate, toDate, source, enabled]);

  useEffect(() => {
    if (!enabled) return;

    const controller = new AbortController();

    // Clear records on filter change to avoid stale data
    setRecords([]);

    fetchData(controller.signal);

    return () => {
      controller.abort();
    };
  }, [fetchData, enabled]);

  // Reset state when disabled to avoid stale data
  useEffect(() => {
    if (!enabled) {
      setRecords([]);
      setLoading(false);
      setError(null);
    }
  }, [enabled]);

  const overview = toSessionOverview(records);
  const tzOffset = useMemo(() => new Date().getTimezoneOffset(), []); // frozen per mount — acceptable; page refresh handles DST changes
  const hoursGrid = toWorkingHoursGrid(records, tzOffset);
  const dailyMessages = toMessageDailyStats(records, tzOffset);
  const projectBreakdown = toProjectBreakdown(records);

  return {
    records,
    overview,
    hoursGrid,
    dailyMessages,
    projectBreakdown,
    loading,
    error,
    refetch: () => fetchData(),
  };
}
