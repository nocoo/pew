"use client";

import { useState, useEffect, useCallback } from "react";
import type { ByDeviceResponse } from "@pew/core";

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseDeviceDataOptions {
  /** Explicit start date (ISO date string, e.g. "2026-01-01") */
  from?: string;
  /** Explicit end date (ISO date string). Defaults to today. */
  to?: string;
  /** Timeline granularity: "half-hour" or "day" (default: "day") */
  granularity?: "half-hour" | "day";
}

interface UseDeviceDataResult {
  data: ByDeviceResponse | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Fetch per-device usage analytics from GET /api/usage/by-device.
 * Same pattern as useUsageData.
 */
export function useDeviceData(
  options: UseDeviceDataOptions = {}
): UseDeviceDataResult {
  const { from: fromDate, to: toDate, granularity } = options;
  const [data, setData] = useState<ByDeviceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);
      if (granularity) params.set("granularity", granularity);

      const qs = params.toString();
      const url = `/api/usage/by-device${qs ? `?${qs}` : ""}`;
      const res = await fetch(url, signal ? { signal } : undefined);

      if (signal?.aborted) return;

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `HTTP ${res.status}`
        );
      }

      const json = (await res.json()) as ByDeviceResponse;

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
  }, [fromDate, toDate, granularity]);

  useEffect(() => {
    const controller = new AbortController();

    // Clear data on filter change to avoid stale data
    setData(null);

    fetchData(controller.signal);

    return () => {
      controller.abort();
    };
  }, [fetchData]);

  return { data, loading, error, refetch: () => fetchData() };
}
