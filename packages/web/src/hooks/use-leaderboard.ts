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
  };
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
}

interface UseLeaderboardResult {
  data: LeaderboardData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useLeaderboard(
  options: UseLeaderboardOptions = {},
): UseLeaderboardResult {
  const { period = "week", limit = 50 } = options;
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        period,
        limit: String(limit),
      });

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
    }
  }, [period, limit]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
