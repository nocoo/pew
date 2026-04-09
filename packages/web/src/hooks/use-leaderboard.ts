"use client";

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LeaderboardPeriod = "week" | "month" | "all";
export type LeaderboardScope = "global" | "org" | "team";

export interface LeaderboardEntry {
  rank: number;
  user: {
    id: string;
    name: string | null;
    image: string | null;
    slug: string | null;
  };
  teams: { id: string; name: string; logo_url: string | null }[];
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  session_count: number;
  total_duration_seconds: number;
}

export interface LeaderboardData {
  period: string;
  scope: LeaderboardScope;
  scopeId?: string;
  entries: LeaderboardEntry[];
  hasMore: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseLeaderboardOptions {
  period?: LeaderboardPeriod;
  limit?: number;
  offset?: number;
  teamId?: string | null;
  orgId?: string | null;
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
  const { period = "week", limit, offset, teamId, orgId } = options;
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
      if (offset !== undefined && offset > 0) {
        params.set("offset", String(offset));
      }
      if (teamId) {
        params.set("team", teamId);
      }
      if (orgId) {
        params.set("org", orgId);
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
  }, [period, limit, offset, teamId, orgId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, refreshing, error, refetch: fetchData };
}
