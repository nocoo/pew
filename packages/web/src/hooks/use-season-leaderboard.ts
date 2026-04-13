"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
    logo_url: string | null;
  };
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  session_count: number;
  total_duration_seconds: number;
  members?: SeasonMember[];
}

export interface SeasonMember {
  user_id: string;
  slug: string | null;
  name: string;
  image: string | null;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  session_count: number;
  total_duration_seconds: number;
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
  seasonIdOrSlug: string | null,
): UseSeasonLeaderboardResult {
  const [data, setData] = useState<SeasonLeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track if initial load has completed to avoid stale closure issues
  const hasLoadedRef = useRef(false);

  const fetchData = useCallback(async () => {
    if (!seasonIdOrSlug) return;

    if (!hasLoadedRef.current) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setError(null);

    try {
      const res = await fetch(
        `/api/seasons/${seasonIdOrSlug}/leaderboard?expand=members`,
      );

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `HTTP ${res.status}`,
        );
      }

      const json = (await res.json()) as SeasonLeaderboardData;
      setData(json);
      hasLoadedRef.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [seasonIdOrSlug]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, refreshing, error, refetch: fetchData };
}
