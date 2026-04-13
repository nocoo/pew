"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { SeasonStatus } from "@pew/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SeasonListItem {
  id: string;
  name: string;
  slug: string;
  start_date: string;
  end_date: string;
  status: SeasonStatus;
  team_count: number;
  has_snapshot: boolean;
  created_at: string;
}

interface SeasonsData {
  seasons: SeasonListItem[];
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseSeasonsOptions {
  status?: SeasonStatus;
}

interface UseSeasonsResult {
  data: SeasonsData | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refetch: () => void;
}

export function useSeasons(
  options: UseSeasonsOptions = {},
): UseSeasonsResult {
  const { status } = options;
  const [data, setData] = useState<SeasonsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track if initial load has completed to avoid stale closure issues
  const hasLoadedRef = useRef(false);

  const fetchData = useCallback(async () => {
    if (!hasLoadedRef.current) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setError(null);

    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);

      const qs = params.toString();
      const url = qs ? `/api/seasons?${qs}` : "/api/seasons";
      const res = await fetch(url);

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `HTTP ${res.status}`,
        );
      }

      const json = (await res.json()) as SeasonsData;
      setData(json);
      hasLoadedRef.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [status]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, refreshing, error, refetch: fetchData };
}
