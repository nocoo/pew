"use client";

import { useState, useEffect, useCallback } from "react";
import type { SeasonStatus } from "@pew/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AvailableSeason {
  id: string;
  name: string;
  slug: string;
  start_date: string;
  end_date: string;
  status: SeasonStatus;
  team_count: number;
  is_registered: boolean;
}

interface UseSeasonRegistrationOptions {
  teamId: string;
}

interface UseSeasonRegistrationResult {
  /** Upcoming + active seasons with registration status */
  seasons: AvailableSeason[];
  loading: boolean;
  error: string | null;
  /** Register team for a season */
  register: (seasonId: string) => Promise<boolean>;
  /** Withdraw team from a season (upcoming only) */
  withdraw: (seasonId: string) => Promise<boolean>;
  /** Re-fetch data */
  refetch: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSeasonRegistration(
  options: UseSeasonRegistrationOptions,
): UseSeasonRegistrationResult {
  const { teamId } = options;
  const [seasons, setSeasons] = useState<AvailableSeason[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Fetch available seasons + registration status
  // -------------------------------------------------------------------------

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch all seasons and team details (which includes registered_season_ids)
      const [seasonsRes, teamRes] = await Promise.all([
        fetch("/api/seasons"),
        fetch(`/api/teams/${teamId}`),
      ]);

      if (!seasonsRes.ok) {
        const body = await seasonsRes.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `HTTP ${seasonsRes.status}`,
        );
      }

      const seasonsData = (await seasonsRes.json()) as {
        seasons: Array<{
          id: string;
          name: string;
          slug: string;
          start_date: string;
          end_date: string;
          status: SeasonStatus;
          team_count: number;
        }>;
      };

      // Get registered season IDs from team details
      let registeredIds = new Set<string>();
      if (teamRes.ok) {
        const teamData = (await teamRes.json()) as {
          registered_season_ids?: string[];
        };
        registeredIds = new Set(teamData.registered_season_ids ?? []);
      }

      // Filter to upcoming + active, enrich with registration status
      const available = seasonsData.seasons
        .filter((s) => s.status === "upcoming" || s.status === "active")
        .map((s) => ({
          ...s,
          is_registered: registeredIds.has(s.id),
        }));

      setSeasons(available);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // -------------------------------------------------------------------------
  // Register
  // -------------------------------------------------------------------------

  const register = useCallback(
    async (seasonId: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/seasons/${seasonId}/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ team_id: teamId }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            (body as { error?: string }).error ?? `HTTP ${res.status}`,
          );
        }

        // Optimistic update
        setSeasons((prev) =>
          prev.map((s) =>
            s.id === seasonId
              ? { ...s, is_registered: true, team_count: s.team_count + 1 }
              : s,
          ),
        );
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Registration failed");
        return false;
      }
    },
    [teamId],
  );

  // -------------------------------------------------------------------------
  // Withdraw
  // -------------------------------------------------------------------------

  const withdraw = useCallback(
    async (seasonId: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/seasons/${seasonId}/register`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ team_id: teamId }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            (body as { error?: string }).error ?? `HTTP ${res.status}`,
          );
        }

        // Optimistic update
        setSeasons((prev) =>
          prev.map((s) =>
            s.id === seasonId
              ? { ...s, is_registered: false, team_count: Math.max(0, s.team_count - 1) }
              : s,
          ),
        );
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Withdrawal failed");
        return false;
      }
    },
    [teamId],
  );

  return { seasons, loading, error, register, withdraw, refetch: fetchData };
}
