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
  /** Load members for a specific team (lazy, on-demand) */
  loadTeamMembers: (teamId: string) => Promise<void>;
  /** Set of team IDs currently loading members */
  loadingTeamIds: Set<string>;
}

export function useSeasonLeaderboard(
  seasonIdOrSlug: string | null,
): UseSeasonLeaderboardResult {
  const [data, setData] = useState<SeasonLeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingTeamIds, setLoadingTeamIds] = useState<Set<string>>(new Set());

  // Track if initial load has completed to avoid stale closure issues
  const hasLoadedRef = useRef(false);

  // Track which teams have already been fetched to avoid duplicate requests
  const fetchedTeamsRef = useRef<Set<string>>(new Set());

  // Track team IDs currently being loaded (ref for stable closure)
  const loadingTeamIdsRef = useRef<Set<string>>(new Set());

  // Initial fetch without expand=members for faster load
  const fetchData = useCallback(async (signal?: AbortSignal) => {
    if (!seasonIdOrSlug) return;

    if (!hasLoadedRef.current) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setError(null);
    // Reset fetched teams on full refetch
    fetchedTeamsRef.current = new Set();

    try {
      const res = await fetch(
        `/api/seasons/${seasonIdOrSlug}/leaderboard`,
        signal ? { signal } : undefined,
      );

      if (signal?.aborted) return;

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `HTTP ${res.status}`,
        );
      }

      const json = (await res.json()) as SeasonLeaderboardData;

      if (signal?.aborted) return;

      setData(json);
      hasLoadedRef.current = true;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [seasonIdOrSlug]);

  // Load members for a specific team on-demand
  const loadTeamMembers = useCallback(
    async (teamId: string) => {
      if (!seasonIdOrSlug || !data) return;
      // Skip if already fetched or currently loading (use ref for stable identity)
      if (fetchedTeamsRef.current.has(teamId) || loadingTeamIdsRef.current.has(teamId)) {
        return;
      }

      loadingTeamIdsRef.current.add(teamId);
      setLoadingTeamIds((prev) => new Set(prev).add(teamId));

      try {
        const res = await fetch(
          `/api/seasons/${seasonIdOrSlug}/leaderboard?expand=members&team=${teamId}`,
        );

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const json = (await res.json()) as SeasonLeaderboardData;
        // Find the team entry with members
        const teamWithMembers = json.entries.find(
          (e) => e.team.id === teamId,
        );

        if (teamWithMembers?.members) {
          const members = teamWithMembers.members;
          fetchedTeamsRef.current.add(teamId);
          setData((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              entries: prev.entries.map((entry): SeasonTeamEntry =>
                entry.team.id === teamId
                  ? { ...entry, members }
                  : entry,
              ),
            };
          });
        }
      } catch {
        // Silently fail — user can retry by collapsing/expanding again
      } finally {
        loadingTeamIdsRef.current.delete(teamId);
        setLoadingTeamIds((prev) => {
          const next = new Set(prev);
          next.delete(teamId);
          return next;
        });
      }
    },
    [seasonIdOrSlug, data],
  );

  useEffect(() => {
    const controller = new AbortController();

    fetchData(controller.signal);

    return () => {
      controller.abort();
    };
  }, [fetchData]);

  return {
    data,
    loading,
    refreshing,
    error,
    refetch: () => fetchData(),
    loadTeamMembers,
    loadingTeamIds,
  };
}
