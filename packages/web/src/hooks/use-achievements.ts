"use client";

import type { AchievementTier, AchievementCategory } from "@/lib/achievement-helpers";
import { useFetchData } from "@/hooks/use-fetch-data";
import { useTzOffset } from "@/hooks/use-tz-offset";
import { useCallback, useMemo } from "react";
import useSWRInfinite from "swr/infinite";
import { fetcher } from "@/lib/fetcher";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EarnedByUser {
  id: string;
  name: string;
  image: string | null;
  slug: string | null;
  tier: AchievementTier;
}

export interface Achievement {
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
  earnedBy: EarnedByUser[];
  totalEarned: number;
}

export interface AchievementSummary {
  totalUnlocked: number;
  totalAchievements: number;
  diamondCount: number;
  currentStreak: number;
  longestStreak: number;
  activeDays: number;
}

export interface AchievementData {
  achievements: Achievement[];
  summary: AchievementSummary;
}

export interface AchievementMember {
  id: string;
  name: string;
  image: string | null;
  slug: string | null;
  tier: AchievementTier;
  earnedAt: string;
  currentValue: number;
}

export interface AchievementMembersData {
  members: AchievementMember[];
  cursor: string | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseAchievementsResult {
  data: AchievementData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

interface UseAchievementsOptions {
  /** Limit to top N achievements (3, 6, or 9). Omit for full list with earnedBy data. */
  limit?: 3 | 6 | 9;
}

export function useAchievements(options?: UseAchievementsOptions): UseAchievementsResult {
  const limit = options?.limit;
  const tzOffset = useTzOffset();

  const url = useMemo(() => {
    const params = new URLSearchParams({ tzOffset: String(tzOffset) });
    if (limit) params.set("limit", String(limit));
    return `/api/achievements?${params}`;
  }, [limit, tzOffset]);

  return useFetchData<AchievementData>(url);
}

// ---------------------------------------------------------------------------
// useAchievementMembers Hook
// ---------------------------------------------------------------------------

interface UseAchievementMembersResult {
  data: AchievementMembersData | null;
  loading: boolean;
  error: string | null;
  loadMore: () => void;
  hasMore: boolean;
}

export function useAchievementMembers(
  achievementId: string | null,
  limit = 20
): UseAchievementMembersResult {
  const getKey = useCallback(
    (pageIndex: number, previousPageData: AchievementMembersData | null) => {
      if (!achievementId) return null;
      if (previousPageData && previousPageData.cursor === null) return null;
      const params = new URLSearchParams({ limit: String(limit) });
      if (pageIndex > 0 && previousPageData?.cursor) {
        params.set("cursor", previousPageData.cursor);
      }
      return `/api/achievements/${achievementId}/members?${params}`;
    },
    [achievementId, limit],
  );

  const { data, error, isLoading, isValidating, size, setSize } =
    useSWRInfinite<AchievementMembersData>(getKey, fetcher, {
      revalidateFirstPage: false,
    });

  const lastCursor = data && data.length > 0 ? data[data.length - 1]?.cursor ?? null : null;
  const combined: AchievementMembersData | null = data
    ? {
        members: data.flatMap((d) => d.members),
        cursor: lastCursor,
      }
    : null;

  const loadMore = useCallback(() => {
    if (lastCursor && !isValidating) {
      void setSize(size + 1);
    }
  }, [lastCursor, isValidating, setSize, size]);

  return {
    data: combined,
    loading: isLoading || (isValidating && size > 1),
    error: error ? (error instanceof Error ? error.message : String(error)) : null,
    loadMore,
    hasMore: lastCursor !== null,
  };
}
