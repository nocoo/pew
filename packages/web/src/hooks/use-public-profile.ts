"use client";

import { useState, useEffect, useCallback } from "react";
import type {
  UsageRow,
  UsageSummary,
  DailyPoint,
  SourceAggregate,
  ModelAggregate,
  HeatmapPoint,
} from "@/hooks/use-usage-data";
import {
  toDailyPoints,
  toSourceAggregates,
  toHeatmapData,
  toModelAggregates,
  sourceLabel,
} from "@/hooks/use-usage-data";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PublicUser {
  name: string | null;
  image: string | null;
  slug: string;
  created_at: string;
}

export interface PublicProfileData {
  user: PublicUser;
  records: UsageRow[];
  summary: UsageSummary;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UsePublicProfileOptions {
  slug: string;
  /** Number of days to look back (default 30, max 365) */
  days?: number;
  /** Source filter (optional) */
  source?: string;
}

interface UsePublicProfileResult {
  user: PublicUser | null;
  data: PublicProfileData | null;
  daily: DailyPoint[];
  sources: SourceAggregate[];
  models: ModelAggregate[];
  heatmap: HeatmapPoint[];
  loading: boolean;
  error: string | null;
  notFound: boolean;
  refetch: () => void;
}

export function usePublicProfile(
  options: UsePublicProfileOptions,
): UsePublicProfileResult {
  const { slug, days = 30, source } = options;
  const [data, setData] = useState<PublicProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);

    try {
      const params = new URLSearchParams({ days: String(days) });
      if (source) params.set("source", source);

      const res = await fetch(`/api/users/${slug}?${params.toString()}`);

      if (res.status === 404) {
        setNotFound(true);
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `HTTP ${res.status}`,
        );
      }

      const json = (await res.json()) as PublicProfileData;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [slug, days, source]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const daily = data ? toDailyPoints(data.records) : [];
  const sources = data
    ? toSourceAggregates(data.records).map((s) => ({
        ...s,
        label: sourceLabel(s.label),
      }))
    : [];
  const models = data ? toModelAggregates(data.records) : [];
  const heatmap = toHeatmapData(daily);

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
    refetch: fetchData,
  };
}
