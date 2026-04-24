"use client";

import type { AchievementTier, AchievementCategory } from "@/lib/achievement-helpers";
import { useState, useEffect, useCallback } from "react";
import { throwApiError } from "@/lib/api-error";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UserAchievement {
  id: string;
  name: string;
  flavorText: string;
  icon: string;
  category: AchievementCategory;
  tier: AchievementTier;
  currentValue: number;
  tiers: readonly [number, number, number, number];
  progress: number;
  displayValue: string;
  displayThreshold: string;
  unit: string;
}

export interface UserAchievementSummary {
  totalUnlocked: number;
  totalAchievements: number;
  diamondCount: number;
  currentStreak: number;
}

export interface UserAchievementData {
  achievements: UserAchievement[];
  summary: UserAchievementSummary;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseUserAchievementsResult {
  data: UserAchievementData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useUserAchievements(slug: string | null): UseUserAchievementsResult {
  const [data, setData] = useState<UserAchievementData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (signal?: AbortSignal) => {
    if (!slug) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/users/${encodeURIComponent(slug)}/achievements`,
        signal ? { signal } : undefined,
      );

      if (signal?.aborted) return;

      if (!res.ok) {
        if (res.status === 404) {
          // User not found or not public - not an error, just no data
          setData(null);
          return;
        }
        await throwApiError(res);
      }

      const json = await res.json();

      if (signal?.aborted) return;

      setData(json);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [slug]);

  useEffect(() => {
    if (slug) {
      const controller = new AbortController();

      // Reset data when slug changes to avoid showing stale user's data
      // eslint-disable-next-line react-hooks/set-state-in-effect -- data-fetching effect: setState before/after fetch is the standard React pattern
      setData(null);

      fetchData(controller.signal);

      return () => {
        controller.abort();
      };
    } else {
      setData(null);
    }
  }, [slug, fetchData]);

  return { data, loading, error, refetch: () => fetchData() };
}
