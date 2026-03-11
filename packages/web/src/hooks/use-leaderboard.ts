"use client";

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LeaderboardPeriod = "week" | "month" | "all";

export interface LeaderboardEntry {
  rank: number;
  user: {
    name: string | null;
    image: string | null;
    slug: string | null;
    is_public?: boolean;
  };
  teams: { id: string; name: string }[];
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
}

export interface LeaderboardData {
  period: string;
  entries: LeaderboardEntry[];
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseLeaderboardOptions {
  period?: LeaderboardPeriod;
  limit?: number;
  teamId?: string | null;
  admin?: boolean;
}

interface UseLeaderboardResult {
  data: LeaderboardData | null;
  loading: boolean;
  /** True when refetching with stale data still visible */
  refreshing: boolean;
  error: string | null;
  refetch: () => void;
}

export function useLeaderboard(
  options: UseLeaderboardOptions = {},
): UseLeaderboardResult {
  const { period = "week", limit, teamId, admin } = options;
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    // Initial load → loading=true; subsequent fetches → refreshing=true
    if (data === null) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setError(null);

    try {
      const params = new URLSearchParams({ period });
      if (limit !== undefined) {
        params.set("limit", String(limit));
      }
      if (teamId) {
        params.set("team", teamId);
      }
      if (admin) {
        params.set("admin", "true");
      }

      const res = await fetch(`/api/leaderboard?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `HTTP ${res.status}`,
        );
      }

      const json = (await res.json()) as LeaderboardData;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, limit, teamId, admin]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, refreshing, error, refetch: fetchData };
}
