"use client";

import { useMemo, useCallback } from "react";

import { useUserProfile } from "@/hooks/use-user-profile";
import {
  useUsageData,
  type UsageRow,
  type UsageSummary,
  type SourceAggregate,
  type ModelAggregate,
  toSourceAggregates,
  toModelAggregates,
  sourceLabel,
} from "@/hooks/use-usage-data";
import { usePricingMap } from "@/hooks/use-pricing";
import { computeTotalCost } from "@/lib/cost-helpers";
import {
  buildMetric,
  compareSummaries,
  compareSources,
  compareModels,
  type CompareMetric,
  type SummaryComparison,
  type SourceCompareRow,
  type ModelCompareRow,
} from "@/lib/compare-helpers";
import { getLocalToday } from "@/lib/date-helpers";
import { toLocalDateStr, toLocalDailyBuckets } from "@/lib/usage-helpers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompareWindow {
  /** Inclusive lower bound local date, e.g. "2026-03-01" */
  from: string;
  /** Exclusive upper bound local date, e.g. "2026-04-01" */
  to: string;
  /** Days used for the viewed-user profile API fetch window */
  days: number;
}

export interface ProfileCompareSummary extends SummaryComparison {
  activeDays: CompareMetric;
}

export interface ProfileCompareSide {
  summary: UsageSummary;
  estimatedCost: number;
  activeDays: number;
}

export interface ProfileCompareData {
  /** Viewed profile user (A side). */
  viewedUserId: string;
  /** Side A: viewed profile user. */
  a: ProfileCompareSide;
  /** Side B: currently signed-in user. */
  b: ProfileCompareSide;
  summary: ProfileCompareSummary;
  sources: SourceCompareRow[];
  models: ModelCompareRow[];
  window: CompareWindow;
}

interface UseProfileCompareOptions {
  slug: string;
  /** Number of days to compare when no explicit from/to is provided. */
  days?: number;
  /** Inclusive lower bound (date or datetime). */
  from?: string;
  /** Exclusive upper bound (date or datetime). */
  to?: string;
  /** Optional source filter shared by both users. */
  source?: string;
}

interface UseProfileCompareResult {
  data: ProfileCompareData | null;
  loading: boolean;
  error: string | null;
  notFound: boolean;
  hasAnyData: boolean;
  refetch: () => void;
}

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;

// ---------------------------------------------------------------------------
// Window normalization
// ---------------------------------------------------------------------------

function toDateOnly(input: string): string | null {
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function addDays(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function diffDays(from: string, toExclusive: string): number {
  const fromMs = new Date(`${from}T00:00:00.000Z`).getTime();
  const toMs = new Date(`${toExclusive}T00:00:00.000Z`).getTime();
  const days = Math.ceil((toMs - fromMs) / 86_400_000);
  return Math.max(1, days);
}

function buildCompareWindow(
  options: Pick<UseProfileCompareOptions, "days" | "from" | "to">,
): CompareWindow {
  const tzOffset = new Date().getTimezoneOffset();

  const normalizedFrom = options.from ? toDateOnly(options.from) : null;
  const normalizedTo = options.to ? toDateOnly(options.to) : null;

  if (normalizedFrom) {
    const to =
      normalizedTo ??
      addDays(getLocalToday(tzOffset), 1);

    const from = normalizedFrom <= to ? normalizedFrom : to;
    const days = Math.min(MAX_DAYS, diffDays(from, to));
    return { from, to, days };
  }

  const days = Math.min(MAX_DAYS, Math.max(1, options.days ?? DEFAULT_DAYS));
  const to = addDays(getLocalToday(tzOffset), 1);
  const from = addDays(to, -days);
  return { from, to, days };
}

// ---------------------------------------------------------------------------
// Derivation helpers
// ---------------------------------------------------------------------------

function filterRecordsToWindow(
  records: UsageRow[],
  window: CompareWindow,
  tzOffset: number,
): UsageRow[] {
  return records.filter((r) => {
    const day = toLocalDateStr(r.hour_start, tzOffset);
    return day >= window.from && day < window.to;
  });
}

function summarize(records: UsageRow[]): UsageSummary {
  return records.reduce(
    (acc, r) => ({
      input_tokens: acc.input_tokens + r.input_tokens,
      cached_input_tokens: acc.cached_input_tokens + r.cached_input_tokens,
      output_tokens: acc.output_tokens + r.output_tokens,
      reasoning_output_tokens:
        acc.reasoning_output_tokens + r.reasoning_output_tokens,
      total_tokens: acc.total_tokens + r.total_tokens,
    }),
    {
      input_tokens: 0,
      cached_input_tokens: 0,
      output_tokens: 0,
      reasoning_output_tokens: 0,
      total_tokens: 0,
    },
  );
}

function toLabeledSources(records: UsageRow[]): SourceAggregate[] {
  return toSourceAggregates(records).map((s) => ({
    ...s,
    label: sourceLabel(s.label),
  }));
}

function activeDays(records: UsageRow[], tzOffset: number): number {
  return toLocalDailyBuckets(records, tzOffset).length;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useProfileCompare(
  options: UseProfileCompareOptions,
): UseProfileCompareResult {
  const window = buildCompareWindow(options);

  const viewed = useUserProfile({
    slug: options.slug,
    from: window.from,
    to: window.to,
    ...(options.source ? { source: options.source } : {}),
  });

  const current = useUsageData({
    from: window.from,
    to: window.to,
    ...(options.source ? { source: options.source } : {}),
  });

  const { pricingMap, loading: pricingLoading, error: pricingError, refetch: refetchPricing } =
    usePricingMap();

  const data = useMemo<ProfileCompareData | null>(() => {
    if (!viewed.data || !current.data) return null;

    const tzOffset = new Date().getTimezoneOffset();

    const aRecords = filterRecordsToWindow(viewed.data.records, window, tzOffset);
    const bRecords = filterRecordsToWindow(current.data.records, window, tzOffset);

    const aSummary = summarize(aRecords);
    const bSummary = summarize(bRecords);

    const aModels: ModelAggregate[] = toModelAggregates(aRecords);
    const bModels: ModelAggregate[] = toModelAggregates(bRecords);

    const aSources = toLabeledSources(aRecords);
    const bSources = toLabeledSources(bRecords);

    const aCost = computeTotalCost(aModels, pricingMap);
    const bCost = computeTotalCost(bModels, pricingMap);

    const aActiveDays = activeDays(aRecords, tzOffset);
    const bActiveDays = activeDays(bRecords, tzOffset);

    return {
      viewedUserId: viewed.data.viewed_user_id ?? "",
      a: {
        summary: aSummary,
        estimatedCost: aCost,
        activeDays: aActiveDays,
      },
      b: {
        summary: bSummary,
        estimatedCost: bCost,
        activeDays: bActiveDays,
      },
      summary: {
        ...compareSummaries(aSummary, bSummary, aCost, bCost),
        activeDays: buildMetric(aActiveDays, bActiveDays),
      },
      sources: compareSources(aSources, bSources),
      models: compareModels(aModels, bModels),
      window,
    };
  }, [current.data, pricingMap, viewed.data, window]);

  const loading = viewed.loading || current.loading || pricingLoading;
  const error = viewed.error ?? current.error ?? pricingError;
  const hasAnyData =
    (data?.a.summary.total_tokens ?? 0) > 0 ||
    (data?.b.summary.total_tokens ?? 0) > 0;

  const refetch = useCallback(() => {
    viewed.refetch();
    current.refetch();
    refetchPricing();
  }, [current, refetchPricing, viewed]);

  return {
    data,
    loading,
    error,
    notFound: viewed.notFound,
    hasAnyData,
    refetch,
  };
}
