"use client";

import { useMemo } from "react";
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
import { useFetchData } from "@/hooks/use-fetch-data";

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

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    if (source) params.set("source", source);
    const qs = params.toString();
    return qs ? `/api/sessions?${qs}` : "/api/sessions";
  }, [fromDate, toDate, source]);

  const { data, loading, error, refetch } = useFetchData<{ records: SessionRow[] }>(
    enabled ? url : null,
    { enabled, initialLoading: enabled },
  );

  const records = useMemo(() => data?.records ?? [], [data]);

  const tzOffset = useMemo(() => new Date().getTimezoneOffset(), []); // frozen per mount — acceptable; page refresh handles DST changes
  const overview = useMemo(() => toSessionOverview(records), [records]);
  const hoursGrid = useMemo(() => toWorkingHoursGrid(records, tzOffset), [records, tzOffset]);
  const dailyMessages = useMemo(() => toMessageDailyStats(records, tzOffset), [records, tzOffset]);
  const projectBreakdown = useMemo(() => toProjectBreakdown(records), [records]);

  return {
    records,
    overview,
    hoursGrid,
    dailyMessages,
    projectBreakdown,
    loading,
    error,
    refetch,
  };
}
