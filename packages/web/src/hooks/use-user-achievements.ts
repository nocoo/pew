"use client";

import type { AchievementTier, AchievementCategory } from "@/lib/achievement-helpers";
import useSWR from "swr";
import { throwApiError } from "@/lib/api-error";

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

interface UseUserAchievementsResult {
  data: UserAchievementData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

async function userAchievementsFetcher(url: string): Promise<UserAchievementData | null> {
  const res = await fetch(url);
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    await throwApiError(res);
  }
  return res.json() as Promise<UserAchievementData>;
}

export function useUserAchievements(slug: string | null): UseUserAchievementsResult {
  const key = slug ? `/api/users/${encodeURIComponent(slug)}/achievements` : null;
  const { data, error, isLoading, mutate } = useSWR<UserAchievementData | null>(
    key,
    userAchievementsFetcher,
  );

  return {
    data: data ?? null,
    loading: key ? isLoading : false,
    error: error ? (error instanceof Error ? error.message : String(error)) : null,
    refetch: () => {
      void mutate();
    },
  };
}
