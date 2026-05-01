"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  useUsageData,
  sourceLabel,
} from "@/hooks/use-usage-data";
import type { UsageRow } from "@/hooks/use-usage-data";
import { ErrorBanner } from "@/components/ui/error-banner";
import { useDeviceData } from "@/hooks/use-device-data";
import { TimelineInOutChart } from "@/components/dashboard/timeline-inout-chart";
import { TimelineDeviceChart } from "@/components/dashboard/timeline-device-chart";
import { TimelineAgentChart } from "@/components/dashboard/timeline-agent-chart";
import { TimelineModelChart } from "@/components/dashboard/timeline-model-chart";
import type { HalfHourPoint } from "@/components/dashboard/timeline-inout-chart";
import { HourlyAgentChart } from "@/components/dashboard/hourly-agent-chart";
import { HourlyModelChart } from "@/components/dashboard/hourly-model-chart";
import { HourlyDeviceChart } from "@/components/dashboard/hourly-device-chart";
import { DashboardSegment } from "@/components/dashboard/dashboard-segment";
import { ModelInfoTooltip } from "@/components/dashboard/model-info-tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTokens } from "@/lib/utils";
import { groupByDate, toHourlyByAgent, toHourlyByModel, toHourlyByDevice } from "@/lib/usage-helpers";
import type { DailyGroup } from "@/lib/usage-helpers";
import { usePricingMap, lookupPricing, estimateCost, formatCost } from "@/hooks/use-pricing";
import type { PricingMap } from "@/hooks/use-pricing";
import { formatDate, getLocalToday } from "@/lib/date-helpers";

// ---------------------------------------------------------------------------
// Transform UsageRow[] → HalfHourPoint[] (zero-filled 144 slots)
// ---------------------------------------------------------------------------

/** Format a local-adjusted Date into the slot label "Mar 12 09:00". */
function formatSlotLabel(d: Date): string {
  const mon = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const day = d.getUTCDate();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${mon} ${day} ${hh}:${mm}`;
}

/**
 * Build a complete 144-slot (72 h × 2 slots/h) timeline, zero-filling gaps.
 *
 * `fromISO` / `toISO` define the exact UTC window the page requested.
 * Each slot is snapped to the 30-min boundary (floor).
 */
function toHalfHourPoints(
  records: UsageRow[],
  tzOffset: number,
  fromISO: string,
  toISO: string,
): HalfHourPoint[] {
  const SLOT_MS = 30 * 60_000;

  // --- 1. aggregate records by their UTC 30-min key -------------------------
  const byUtcKey = new Map<
    number,
    { input: number; output: number; total: number }
  >();
  for (const r of records) {
    // Floor to 30-min boundary in UTC
    const ms = new Date(r.hour_start).getTime();
    const key = ms - (ms % SLOT_MS);

    const existing = byUtcKey.get(key);
    if (existing) {
      existing.input += r.input_tokens;
      existing.output += r.output_tokens;
      existing.total += r.total_tokens;
    } else {
      byUtcKey.set(key, {
        input: r.input_tokens,
        output: r.output_tokens,
        total: r.total_tokens,
      });
    }
  }

  // --- 2. generate every 30-min slot in the window --------------------------
  const startMs = new Date(fromISO).getTime();
  const endMs = new Date(toISO).getTime();
  // Snap start down, end up so we cover the full range
  let cursor = startMs - (startMs % SLOT_MS);
  const result: HalfHourPoint[] = [];

  while (cursor <= endMs) {
    const localDate = new Date(cursor - tzOffset * 60_000);
    const slot = formatSlotLabel(localDate);
    const hourStart = new Date(cursor).toISOString();
    const vals = byUtcKey.get(cursor);

    result.push({
      slot,
      hourStart,
      input: vals?.input ?? 0,
      output: vals?.output ?? 0,
      total: vals?.total ?? 0,
    });

    cursor += SLOT_MS;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Expandable day row (mirrors daily-usage pattern)
// ---------------------------------------------------------------------------

function DayRow({
  group,
  pricingMap,
}: {
  group: DailyGroup;
  pricingMap: PricingMap;
}) {
  const [expanded, setExpanded] = useState(false);

  const modelRows = useMemo(() => {
    const byKey = new Map<
      string,
      {
        source: string;
        model: string;
        input: number;
        output: number;
        cached: number;
        total: number;
        cost: number;
      }
    >();

    for (const r of group.records) {
      const key = `${r.source}:${r.model}`;
      const existing = byKey.get(key);
      const pricing = lookupPricing(pricingMap, r.model, r.source);
      const cost = estimateCost(
        r.input_tokens,
        r.output_tokens,
        r.cached_input_tokens,
        pricing,
      );

      if (existing) {
        existing.input += r.input_tokens;
        existing.output += r.output_tokens;
        existing.cached += r.cached_input_tokens;
        existing.total += r.total_tokens;
        existing.cost += cost.totalCost;
      } else {
        byKey.set(key, {
          source: r.source,
          model: r.model,
          input: r.input_tokens,
          output: r.output_tokens,
          cached: r.cached_input_tokens,
          total: r.total_tokens,
          cost: cost.totalCost,
        });
      }
    }

    return Array.from(byKey.values()).sort((a, b) => b.total - a.total);
  }, [group.records, pricingMap]);

  return (
    <>
      <tr
        className="border-b border-border/50 last:border-0 hover:bg-accent/50 transition-colors cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="px-4 py-3 text-sm">
          <div className="flex items-center gap-2">
            {expanded ? (
              <ChevronDown
                className="h-3.5 w-3.5 text-muted-foreground shrink-0"
                strokeWidth={1.5}
              />
            ) : (
              <ChevronRight
                className="h-3.5 w-3.5 text-muted-foreground shrink-0"
                strokeWidth={1.5}
              />
            )}
            <span className="font-medium">{formatDate(group.date)}</span>
          </div>
        </td>
        <td className="px-4 py-3 text-sm text-right tabular-nums">
          {formatTokens(group.inputTokens)}
        </td>
        <td className="px-4 py-3 text-sm text-right tabular-nums">
          {formatTokens(group.outputTokens)}
        </td>
        <td className="px-4 py-3 text-sm text-right tabular-nums hidden md:table-cell">
          {formatTokens(group.cachedTokens)}
        </td>
        <td className="px-4 py-3 text-sm text-right tabular-nums font-medium">
          {formatTokens(group.totalTokens)}
        </td>
        <td className="px-4 py-3 text-sm text-right tabular-nums hidden sm:table-cell">
          {formatCost(group.estimatedCost)}
        </td>
      </tr>
      {expanded &&
        modelRows.map((row) => (
          <tr
            key={`${row.source}:${row.model}`}
            className="border-b border-border/30 last:border-0 bg-accent/30"
          >
            <td className="pl-10 pr-4 py-2.5 text-xs text-muted-foreground">
              <span className="text-foreground/70">
                {sourceLabel(row.source)}
              </span>
              <span className="mx-1.5 text-border">/</span>
              <span className="font-mono text-foreground/60">{row.model}</span>
              <ModelInfoTooltip model={row.model} className="ml-1.5" />
            </td>
            <td className="px-4 py-2.5 text-xs text-right tabular-nums text-muted-foreground">
              {formatTokens(row.input)}
            </td>
            <td className="px-4 py-2.5 text-xs text-right tabular-nums text-muted-foreground">
              {formatTokens(row.output)}
            </td>
            <td className="px-4 py-2.5 text-xs text-right tabular-nums text-muted-foreground hidden md:table-cell">
              {formatTokens(row.cached)}
            </td>
            <td className="px-4 py-2.5 text-xs text-right tabular-nums text-muted-foreground">
              {formatTokens(row.total)}
            </td>
            <td className="px-4 py-2.5 text-xs text-right tabular-nums text-muted-foreground hidden sm:table-cell">
              {formatCost(row.cost)}
            </td>
          </tr>
        ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function ChartSkeleton() {
  return (
    <div className="rounded-card bg-secondary p-4 md:p-5">
      <div className="mb-4 flex items-center justify-between">
        <Skeleton className="h-3 w-20" />
        <div className="flex items-center gap-4">
          <Skeleton className="h-2 w-2 rounded-full" />
          <Skeleton className="h-2 w-12" />
        </div>
      </div>
      <Skeleton className="h-[200px] w-full rounded-lg" />
    </div>
  );
}

function CompactChartSkeleton() {
  return (
    <div className="rounded-card bg-secondary p-4 md:p-5">
      <div className="mb-4 flex items-center justify-between">
        <Skeleton className="h-3 w-20" />
        <div className="flex items-center gap-4">
          <Skeleton className="h-2 w-2 rounded-full" />
          <Skeleton className="h-2 w-12" />
        </div>
      </div>
      <Skeleton className="h-[160px] w-full rounded-lg" />
    </div>
  );
}

function RecentSkeleton() {
  return (
    <div className="grid gap-4 md:gap-6 xl:grid-cols-4">
      {/* Left column skeleton: 4 charts + table */}
      <div className="xl:col-span-3 space-y-4 md:space-y-6">
        <div className="rounded-card border border-secondary bg-background p-4 md:p-5">
          <div className="flex items-center gap-2 mb-4">
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="space-y-4">
            <ChartSkeleton />
            <ChartSkeleton />
            <ChartSkeleton />
            <ChartSkeleton />
          </div>
          {/* Table skeleton */}
          <div className="mt-6 rounded-xl bg-background/50 p-1 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-left"><Skeleton className="h-3 w-12" /></th>
                  <th className="px-4 py-3 text-right"><Skeleton className="h-3 w-10 ml-auto" /></th>
                  <th className="px-4 py-3 text-right"><Skeleton className="h-3 w-10 ml-auto" /></th>
                  <th className="px-4 py-3 text-right hidden md:table-cell"><Skeleton className="h-3 w-10 ml-auto" /></th>
                  <th className="px-4 py-3 text-right"><Skeleton className="h-3 w-10 ml-auto" /></th>
                  <th className="px-4 py-3 text-right hidden sm:table-cell"><Skeleton className="h-3 w-10 ml-auto" /></th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="px-4 py-3"><Skeleton className="h-4 w-20" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-12 ml-auto" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-12 ml-auto" /></td>
                    <td className="px-4 py-3 hidden md:table-cell"><Skeleton className="h-4 w-12 ml-auto" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-12 ml-auto" /></td>
                    <td className="px-4 py-3 hidden sm:table-cell"><Skeleton className="h-4 w-12 ml-auto" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Right column skeleton: 3 pattern charts */}
      <div className="xl:col-span-1 space-y-4 md:space-y-6">
        <div className="rounded-card border border-secondary bg-background p-4 md:p-5">
          <div className="flex items-center gap-2 mb-4">
            <Skeleton className="h-4 w-28" />
          </div>
          <div className="space-y-4">
            <CompactChartSkeleton />
            <CompactChartSkeleton />
            <CompactChartSkeleton />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function RecentPage() {
  // Recent: last 72 hours — use full ISO timestamps so the API applies
  // exact millisecond boundaries instead of bare-date expansion (+1 day
  // on `to`) which would widen the window to ~96 hours.
  const recentFrom = useMemo(() => {
    const d = new Date();
    d.setTime(d.getTime() - 72 * 60 * 60_000);
    return d.toISOString();
  }, []);
  const recentTo = useMemo(() => {
    return new Date().toISOString();
  }, []);

  const { data, loading: usageLoading, error } = useUsageData({
    from: recentFrom,
    to: recentTo,
    granularity: "half-hour",
  });

  // Fetch device timeline with half-hour granularity for the main chart
  const { data: recentDeviceData, loading: deviceLoading } = useDeviceData({
    from: recentFrom.slice(0, 10), // API expects date string
    to: recentTo.slice(0, 10),
    granularity: "half-hour",
  });

  // Wait for both data sources before showing content to avoid double animation
  const loading = usageLoading || deviceLoading;

  // For hourly pattern charts, fetch last 30 days of half-hour data
  const tzOffset = useMemo(() => new Date().getTimezoneOffset(), []); // frozen per mount — acceptable; page refresh handles DST changes
  const { patternFrom, patternTo } = useMemo(() => {
    const today = getLocalToday(tzOffset);
    const fromDate = new Date(today + "T00:00:00Z");
    fromDate.setUTCDate(fromDate.getUTCDate() - 30);
    return {
      patternFrom: fromDate.toISOString().slice(0, 10),
      patternTo: today,
    };
  }, [tzOffset]);

  const { data: patternData, loading: patternLoading } = useUsageData({
    from: patternFrom,
    to: patternTo,
    granularity: "half-hour",
  });

  // Fetch device data for the same period (day granularity for pattern charts)
  const { data: deviceData, loading: patternDeviceLoading } = useDeviceData({
    from: patternFrom,
    to: patternTo,
  });

  // Pattern charts wait for both data sources to avoid double animation
  const patternChartsLoading = patternLoading || patternDeviceLoading;

  // Wait for ALL data before showing content to avoid staggered animations
  const allLoading = loading || patternChartsLoading;

  const { pricingMap } = usePricingMap();

  const halfHourPoints = useMemo(() => {
    return data
      ? toHalfHourPoints(data.records, tzOffset, recentFrom, recentTo)
      : [];
  }, [data, tzOffset, recentFrom, recentTo]);

  const dailyGroups = useMemo(
    () => (data ? groupByDate(data.records, pricingMap, tzOffset) : []),
    [data, pricingMap, tzOffset],
  );

  // Compute hourly breakdowns from 30-day data
  const dateRange = useMemo(
    () => ({ from: patternFrom, to: patternTo }),
    [patternFrom, patternTo],
  );

  const hourlyByAgent = useMemo(
    () =>
      patternData
        ? toHourlyByAgent(patternData.records, dateRange, tzOffset)
        : [],
    [patternData, dateRange, tzOffset],
  );

  const hourlyByModel = useMemo(
    () =>
      patternData
        ? toHourlyByModel(patternData.records, dateRange, tzOffset, 5)
        : [],
    [patternData, dateRange, tzOffset],
  );

  const hourlyByDevice = useMemo(
    () =>
      patternData && deviceData
        ? toHourlyByDevice(
            patternData.records,
            deviceData.deviceDetails,
            dateRange,
            tzOffset,
          )
        : [],
    [patternData, deviceData, dateRange, tzOffset],
  );

  // Device details for labels
  const devices = useMemo(() => deviceData?.devices ?? [], [deviceData]);

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold font-display tracking-tight">
          Hourly Usage
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Token usage over the last 72 hours.
        </p>
      </div>

      {/* Error */}
      <ErrorBanner messagePrefix="Failed to load usage data" error={error} />

      {/* Loading */}
      {allLoading && <RecentSkeleton />}

      {/* Content */}
      {!allLoading && data && (
        <>
          {data.summary.total_tokens > 0 ? (
            <div className="grid gap-4 md:gap-6 xl:grid-cols-4">
              {/* Left column: Timeline charts + Detail table (3/4) */}
              <div className="xl:col-span-3 space-y-4 md:space-y-6">
                <DashboardSegment title="72-Hour Timeline">
                  <div className="space-y-4">
                    {/* Input / Output */}
                    <TimelineInOutChart data={halfHourPoints} />

                    {/* By Device */}
                    {recentDeviceData?.timeline && recentDeviceData?.devices && (
                      <TimelineDeviceChart
                        deviceTimeline={recentDeviceData.timeline}
                        devices={recentDeviceData.devices}
                      />
                    )}

                    {/* By Agent */}
                    <TimelineAgentChart
                      records={data.records}
                      tzOffset={tzOffset}
                      fromISO={recentFrom}
                      toISO={recentTo}
                    />

                    {/* By Model */}
                    <TimelineModelChart
                      records={data.records}
                      tzOffset={tzOffset}
                      fromISO={recentFrom}
                      toISO={recentTo}
                      topN={5}
                    />
                  </div>

                  {/* Per-day detail table */}
                  {dailyGroups.length > 0 && (
                    <div className="mt-6 rounded-xl bg-background/50 p-1 overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-border">
                            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                              Date
                            </th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">
                              Input
                            </th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">
                              Output
                            </th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground hidden md:table-cell">
                              Cached
                            </th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">
                              Total
                            </th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground hidden sm:table-cell">
                              Est. Cost
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {dailyGroups.map((group) => (
                            <DayRow
                              key={group.date}
                              group={group}
                              pricingMap={pricingMap}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </DashboardSegment>
              </div>

              {/* Right column: Hourly pattern charts (1/4) */}
              <div className="xl:col-span-1 space-y-4 md:space-y-6">
                <DashboardSegment title="Hourly Patterns">
                  <div className="space-y-4">
                    <HourlyAgentChart data={hourlyByAgent} compact />
                    <HourlyModelChart data={hourlyByModel} compact />
                    {devices.length > 0 && (
                      <HourlyDeviceChart data={hourlyByDevice} deviceDetails={devices} compact />
                    )}
                  </div>
                </DashboardSegment>
              </div>
            </div>
          ) : (
            <div className="rounded-card bg-secondary p-8 text-center text-sm text-muted-foreground">
              No usage data in the last 72 hours.
            </div>
          )}
        </>
      )}
    </div>
  );
}
