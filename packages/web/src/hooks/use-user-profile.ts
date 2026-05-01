"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type {
  UsageRow,
  UsageSummary,
  DailyPoint,
  SourceAggregate,
  ModelAggregate,
  HeatmapPoint,
} from "@/hooks/use-usage-data";
import { toHeatmapData } from "@/hooks/use-usage-data";
import { useDerivedUsageData } from "@/hooks/use-derived-usage-data";
import { useTzOffset } from "@/hooks/use-tz-offset";
import type { BadgeIconType } from "@pew/core";
import { throwApiError } from "@/lib/api-error";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UserProfileBadge {
  text: string;
  icon: BadgeIconType;
  colorBg: string;
  colorText: string;
}

export interface UserProfileUser {
  name: string | null;
  nickname: string | null;
  image: string | null;
  slug: string;
  created_at: string;
  first_seen: string | null;
  badges?: UserProfileBadge[];
}

export interface UserProfileData {
  user: UserProfileUser;
  records: UsageRow[];
  summary: UsageSummary;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseUserProfileOptions {
  /** User slug (takes precedence over userId) */
  slug?: string;
  /** Number of days to look back (default 30, max 365) */
  days?: number;
  /** Start datetime (ISO 8601) - takes precedence over days */
  from?: string;
  /** End datetime (ISO 8601) - requires from */
  to?: string;
  /** Source filter (optional) */
  source?: string;
}

interface UseUserProfileResult {
  user: UserProfileUser | null;
  data: UserProfileData | null;
  daily: DailyPoint[];
  sources: SourceAggregate[];
  models: ModelAggregate[];
  heatmap: HeatmapPoint[];
  loading: boolean;
  error: string | null;
  notFound: boolean;
  refetch: () => void;
}

export function useUserProfile(
  options: UseUserProfileOptions,
): UseUserProfileResult {
  const { slug, days = 30, from, to, source } = options;
  const [data, setData] = useState<UserProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const fetchData = useCallback(async (signal?: AbortSignal) => {
    if (!slug) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setNotFound(false);

    try {
      const params = new URLSearchParams();

      // Use from/to if provided, otherwise use days
      if (from && to) {
        params.set("from", from);
        params.set("to", to);
      } else {
        params.set("days", String(days));
      }

      if (source) params.set("source", source);

      const res = await fetch(`/api/users/${slug}?${params.toString()}`, signal ? { signal } : undefined);

      if (signal?.aborted) return;

      if (res.status === 404) {
        setNotFound(true);
        return;
      }

      if (!res.ok) {
        await throwApiError(res);
      }

      const json = (await res.json()) as UserProfileData;

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
  }, [slug, days, from, to, source]);

  useEffect(() => {
    const controller = new AbortController();

    // Reset data when slug changes to avoid showing stale user's data
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data-fetching effect: setState before/after fetch is the standard React pattern
    setData(null);
    setNotFound(false);

    fetchData(controller.signal);

    return () => {
      controller.abort();
    };
  }, [fetchData]);

  // Memoize derived data to avoid recalculation on every render
  const tzOffset = useTzOffset();
  const { daily, sources, models } = useDerivedUsageData(data?.records ?? null, tzOffset);
  const heatmap = useMemo(() => toHeatmapData(daily), [daily]);

  return {
    user: data?.user ?? null,
    data,
    daily,
    sources,
    models,
    heatmap,
    loading,
    error,
    notFound,
    refetch: () => fetchData(),
  };
}
