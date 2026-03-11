"use client";

import { useState, useEffect, useCallback } from "react";
import type { SeasonStatus } from "@pew/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SeasonTeamEntry {
  rank: number;
  team: {
    id: string;
    name: string;
    slug: string;
  };
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  members?: SeasonMember[];
}

export interface SeasonMember {
  user_id: string;
  name: string;
  image: string | null;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
}

export interface SeasonLeaderboardData {
  season: {
    id: string;
    name: string;
    slug: string;
    start_date: string;
    end_date: string;
    status: SeasonStatus;
    is_snapshot: boolean;
  };
  entries: SeasonTeamEntry[];
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseSeasonLeaderboardResult {
  data: SeasonLeaderboardData | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refetch: () => void;
}

export function useSeasonLeaderboard(
  seasonId: string | null,
): UseSeasonLeaderboardResult {
  const [data, setData] = useState<SeasonLeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!seasonId) return;

    if (data === null) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setError(null);

    try {
      const res = await fetch(
        `/api/seasons/${seasonId}/leaderboard?expand=members`,
      );

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `HTTP ${res.status}`,
        );
      }

      const json = (await res.json()) as SeasonLeaderboardData;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasonId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, refreshing, error, refetch: fetchData };
}
