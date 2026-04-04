"use client";

import { useState, useEffect, useCallback } from "react";
import type { AchievementTier, AchievementCategory } from "@/lib/achievement-helpers";

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
}

export interface AchievementData {
  achievements: Achievement[];
  summary: AchievementSummary;
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

export function useAchievements(): UseAchievementsResult {
  const [data, setData] = useState<AchievementData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const tzOffset = new Date().getTimezoneOffset();
      const params = new URLSearchParams({ tzOffset: String(tzOffset) });
      const res = await fetch(`/api/achievements?${params}`);

      if (!res.ok) {
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
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
