"use client";

import { useMemo } from "react";
import useSWR from "swr";
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

interface UseUserProfileOptions {
  slug?: string;
  days?: number;
  from?: string;
  to?: string;
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

type ProfileResult =
  | { kind: "ok"; data: UserProfileData }
  | { kind: "not_found" };

async function userProfileFetcher(url: string): Promise<ProfileResult> {
  const res = await fetch(url);
  if (res.status === 404) return { kind: "not_found" };
  if (!res.ok) {
    await throwApiError(res);
  }
  const data = (await res.json()) as UserProfileData;
  return { kind: "ok", data };
}

export function useUserProfile(
  options: UseUserProfileOptions,
): UseUserProfileResult {
  const { slug, days = 30, from, to, source } = options;

  const url = useMemo(() => {
    if (!slug) return null;
    const params = new URLSearchParams();
    if (from && to) {
      params.set("from", from);
      params.set("to", to);
    } else {
      params.set("days", String(days));
    }
    if (source) params.set("source", source);
    return `/api/users/${slug}?${params.toString()}`;
  }, [slug, days, from, to, source]);

  const { data: result, error, isLoading, mutate } = useSWR<ProfileResult>(
    url,
    userProfileFetcher,
  );

  const data = result?.kind === "ok" ? result.data : null;
  const notFound = result?.kind === "not_found";

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
    loading: url ? isLoading : false,
    error: error ? (error instanceof Error ? error.message : String(error)) : null,
    notFound,
    refetch: () => {
      void mutate();
    },
  };
}
