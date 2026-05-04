"use client";

import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import type { SeasonStatus } from "@pew/core";
import { throwApiError } from "@/lib/api-error";
import { fetcher } from "@/lib/fetcher";

export interface AvailableSeason {
  id: string;
  name: string;
  slug: string;
  start_date: string;
  end_date: string;
  status: SeasonStatus;
  team_count: number;
  is_registered: boolean;
  allow_late_registration: boolean;
  allow_late_withdrawal: boolean;
}

interface UseSeasonRegistrationOptions {
  teamId: string;
}

interface UseSeasonRegistrationResult {
  seasons: AvailableSeason[];
  loading: boolean;
  error: string | null;
  register: (seasonId: string) => Promise<boolean>;
  withdraw: (seasonId: string) => Promise<boolean>;
  refetch: () => void;
}

interface SeasonsResponse {
  seasons: Array<{
    id: string;
    name: string;
    slug: string;
    start_date: string;
    end_date: string;
    status: SeasonStatus;
    team_count: number;
    allow_late_registration: boolean;
    allow_late_withdrawal: boolean;
  }>;
}

interface TeamResponse {
  registered_season_ids?: string[];
}

export function useSeasonRegistration(
  options: UseSeasonRegistrationOptions,
): UseSeasonRegistrationResult {
  const { teamId } = options;

  const {
    data: seasonsData,
    error: seasonsError,
    isLoading: seasonsLoading,
    mutate: mutateSeasons,
  } = useSWR<SeasonsResponse>("/api/seasons", fetcher);

  const {
    data: teamData,
    isLoading: teamLoading,
    mutate: mutateTeam,
  } = useSWR<TeamResponse>(`/api/teams/${teamId}`, fetcher);

  const [overrides, setOverrides] = useState<
    Map<string, { is_registered: boolean; delta: number }>
  >(new Map());
  const [mutationError, setMutationError] = useState<string | null>(null);

  const seasons = useMemo<AvailableSeason[]>(() => {
    if (!seasonsData) return [];
    const registeredIds = new Set(teamData?.registered_season_ids ?? []);
    return seasonsData.seasons
      .filter((s) => s.status === "upcoming" || s.status === "active")
      .map((s) => {
        const override = overrides.get(s.id);
        const baseRegistered = registeredIds.has(s.id);
        return {
          ...s,
          is_registered: override ? override.is_registered : baseRegistered,
          team_count: s.team_count + (override?.delta ?? 0),
        };
      });
  }, [seasonsData, teamData, overrides]);

  const refetch = useCallback(() => {
    setOverrides(new Map());
    void mutateSeasons();
    void mutateTeam();
  }, [mutateSeasons, mutateTeam]);

  const register = useCallback(
    async (seasonId: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/seasons/${seasonId}/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ team_id: teamId }),
        });
        if (!res.ok) await throwApiError(res);
        setOverrides((prev) => {
          const next = new Map(prev);
          next.set(seasonId, { is_registered: true, delta: 1 });
          return next;
        });
        return true;
      } catch (err) {
        setMutationError(err instanceof Error ? err.message : "Registration failed");
        return false;
      }
    },
    [teamId],
  );

  const withdraw = useCallback(
    async (seasonId: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/seasons/${seasonId}/register`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ team_id: teamId }),
        });
        if (!res.ok) await throwApiError(res);
        setOverrides((prev) => {
          const next = new Map(prev);
          next.set(seasonId, { is_registered: false, delta: -1 });
          return next;
        });
        return true;
      } catch (err) {
        setMutationError(err instanceof Error ? err.message : "Withdrawal failed");
        return false;
      }
    },
    [teamId],
  );

  return {
    seasons,
    loading: seasonsLoading || teamLoading,
    error:
      mutationError ??
      (seasonsError
        ? seasonsError instanceof Error
          ? seasonsError.message
          : String(seasonsError)
        : null),
    register,
    withdraw,
    refetch,
  };
}
