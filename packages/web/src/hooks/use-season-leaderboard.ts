"use client";

import { useCallback, useRef, useState } from "react";
import useSWR from "swr";
import type { SeasonStatus } from "@pew/core";
import { fetcher } from "@/lib/fetcher";

export interface SeasonTeamEntry {
  rank: number;
  team: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
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
  const key = seasonIdOrSlug ? `/api/seasons/${seasonIdOrSlug}/leaderboard` : null;
  const { data, error, isLoading, isValidating, mutate } =
    useSWR<SeasonLeaderboardData>(key, fetcher);

  const fetchedTeamsRef = useRef<Set<string>>(new Set());
  const loadingTeamIdsRef = useRef<Set<string>>(new Set());
  const [loadingTeamIds, setLoadingTeamIds] = useState<Set<string>>(new Set());

  const loadTeamMembers = useCallback(
    async (teamId: string) => {
      if (!seasonIdOrSlug || !data) return;
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
        const teamWithMembers = json.entries.find((e) => e.team.id === teamId);

        if (teamWithMembers?.members) {
          const members = teamWithMembers.members;
          fetchedTeamsRef.current.add(teamId);
          await mutate(
            (prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                entries: prev.entries.map((entry): SeasonTeamEntry =>
                  entry.team.id === teamId ? { ...entry, members } : entry,
                ),
              };
            },
            { revalidate: false },
          );
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
    [seasonIdOrSlug, data, mutate],
  );

  return {
    data: data ?? null,
    loading: isLoading,
    refreshing: isValidating && !isLoading,
    error: error ? (error instanceof Error ? error.message : String(error)) : null,
    refetch: () => {
      fetchedTeamsRef.current = new Set();
      void mutate();
    },
    loadTeamMembers,
    loadingTeamIds,
  };
}
