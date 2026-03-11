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
  /** Project filter — project name, or "_unassigned" for no-project sessions */
  project?: string;
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
  const { from: fromDate, to: toDate, source, project, enabled = true } = options;
  const [records, setRecords] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);
      if (source) params.set("source", source);
      if (project) {
        // The breakdown helper labels unassigned sessions as "Unassigned";
        // the API uses the sentinel "_unassigned" for null-project filtering.
        params.set("project", project === "Unassigned" ? "_unassigned" : project);
      }

      const qs = params.toString();
      const url = qs ? `/api/sessions?${qs}` : "/api/sessions";
      const res = await fetch(url);

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `HTTP ${res.status}`
        );
      }

      const json = (await res.json()) as { records: SessionRow[] };
      setRecords(json.records);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
    }, [fromDate, toDate, source, project, enabled]);

  useEffect(() => {
    if (!enabled) return;
    fetchData();
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
  const tzOffset = useMemo(() => new Date().getTimezoneOffset(), []);
  const hoursGrid = toWorkingHoursGrid(records, tzOffset);
  const dailyMessages = toMessageDailyStats(records);
  const projectBreakdown = toProjectBreakdown(records);

  return {
    records,
    overview,
    hoursGrid,
    dailyMessages,
    projectBreakdown,
    loading,
    error,
    refetch: fetchData,
  };
}
