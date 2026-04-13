"use client";

import { useMemo } from "react";
import type { ByDeviceResponse } from "@pew/core";
import { useFetchData } from "@/hooks/use-fetch-data";

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

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    if (granularity) params.set("granularity", granularity);
    params.set("tzOffset", String(new Date().getTimezoneOffset()));

    const qs = params.toString();
    return `/api/usage/by-device${qs ? `?${qs}` : ""}`;
  }, [fromDate, toDate, granularity]);

  return useFetchData<ByDeviceResponse>(url);
}
