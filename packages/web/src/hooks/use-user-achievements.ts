"use client";

import { useState, useEffect, useCallback } from "react";
import type { AchievementTier, AchievementCategory } from "@/lib/achievement-helpers";

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

  const fetchData = useCallback(async () => {
    if (!slug) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/users/${encodeURIComponent(slug)}/achievements`);

      if (!res.ok) {
        if (res.status === 404) {
          // User not found or not public - not an error, just no data
          setData(null);
          return;
        }
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    if (slug) {
      fetchData();
    } else {
      setData(null);
    }
  }, [slug, fetchData]);

  return { data, loading, error, refetch: fetchData };
}
