"use client";

import { useMemo } from "react";
import useSWR from "swr";
import type { SeasonStatus } from "@pew/core";
import { fetcher } from "@/lib/fetcher";

export interface SeasonListItem {
  id: string;
  name: string;
  slug: string;
  start_date: string;
  end_date: string;
  status: SeasonStatus;
  team_count: number;
  has_snapshot: boolean;
  created_at: string;
}

interface SeasonsData {
  seasons: SeasonListItem[];
}

interface UseSeasonsOptions {
  status?: SeasonStatus;
}

interface UseSeasonsResult {
  data: SeasonsData | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refetch: () => void;
}

export function useSeasons(
  options: UseSeasonsOptions = {},
): UseSeasonsResult {
  const { status } = options;

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    const qs = params.toString();
    return qs ? `/api/seasons?${qs}` : "/api/seasons";
  }, [status]);

  const { data, error, isLoading, isValidating, mutate } = useSWR<SeasonsData>(
    url,
    fetcher,
  );

  return {
    data: data ?? null,
    loading: isLoading,
    refreshing: isValidating && !isLoading,
    error: error ? (error instanceof Error ? error.message : String(error)) : null,
    refetch: () => {
      void mutate();
    },
  };
}
