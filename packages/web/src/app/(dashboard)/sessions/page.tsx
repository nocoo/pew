"use client";

import { useState, useMemo } from "react";
import { Zap, Brain } from "lucide-react";
import { useSessionData } from "@/hooks/use-session-data";
import { useUsageData } from "@/hooks/use-usage-data";
import { useDeviceData } from "@/hooks/use-device-data";
import { SessionOverview } from "@/components/dashboard/session-overview";
import { StatCard, StatGrid } from "@/components/dashboard/stat-card";
import { WorkingHoursHeatmap } from "@/components/dashboard/working-hours-heatmap";
import { DailyActivityChart } from "@/components/dashboard/daily-activity-chart";
import { PeakHoursCard } from "@/components/dashboard/peak-hours-card";
import { ChartCardSkeleton } from "@/components/dashboard/chart-card-skeleton";
import { StatCardSkeleton } from "@/components/dashboard/stat-card-skeleton";
import {
  PeriodSelector,
  periodToDateRange,
  periodLabel,
} from "@/components/dashboard/period-selector";
import type { Period } from "@/components/dashboard/period-selector";
import { computeTokensPerHour } from "@/lib/session-helpers";
import { computeReasoningRatio } from "@/lib/cost-helpers";
import { detectPeakHours, getLocalToday, aggregateHourlyTokens } from "@/lib/date-helpers";
import { formatTokens } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function SessionsSkeleton() {
  return (
    <div className="space-y-4 md:space-y-6">
      {/* 4-col stat grid (SessionOverview) */}
      <StatGrid columns={4}>
        {Array.from({ length: 4 }).map((_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </StatGrid>

      {/* 2-col efficiency row */}
      <StatGrid columns={2}>
        {Array.from({ length: 2 }).map((_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </StatGrid>

      {/* 2-col chart row (heatmap + peak hours) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4">
        <ChartCardSkeleton titleWidth="w-28" chartHeight="h-[200px]" />
        <ChartCardSkeleton titleWidth="w-24" chartHeight="h-[200px]" />
      </div>

      {/* Message chart */}
      <ChartCardSkeleton titleWidth="w-28" chartHeight="h-[240px] md:h-[280px]" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SessionsPage() {
  const [period, setPeriod] = useState<Period>("all");
  const { from, to } = periodToDateRange(period, new Date().getTimezoneOffset());

  const sessionData = useSessionData({
    from,
    ...(to ? { to } : {}),
  });

  // Fetch usage data for token totals (needed for tokens/hour + reasoning ratio)
  const { data: usageData, loading: usageLoading } = useUsageData({
    from,
    ...(to ? { to } : {}),
  });

  // Half-hour granularity for peak hour detection
  const { data: halfHourUsage, loading: halfHourLoading } = useUsageData({
    from,
    ...(to ? { to } : {}),
    granularity: "half-hour",
  });

  // Daily device timeline for the "By Device" dimension on Daily Activity
  const { data: deviceData, loading: deviceLoading } = useDeviceData({
    from,
    ...(to ? { to } : {}),
    granularity: "day",
  });

  const subtitle = periodLabel(period);

  const efficiency = useMemo(
    () =>
      usageData
        ? computeTokensPerHour(usageData.summary.total_tokens, sessionData.overview)
        : null,
    [usageData, sessionData.overview],
  );

  const reasoning = useMemo(
    () => (usageData ? computeReasoningRatio(usageData.summary) : null),
    [usageData],
  );

  const tzOffset = useMemo(() => new Date().getTimezoneOffset(), []); // frozen per mount — acceptable; page refresh handles DST changes
  const today = useMemo(() => getLocalToday(tzOffset), [tzOffset]);

  const peakSlots = useMemo(
    () => (halfHourUsage ? detectPeakHours(halfHourUsage.records, 5, tzOffset) : []),
    [halfHourUsage, tzOffset],
  );

  const peakHourly = useMemo(
    () => (halfHourUsage ? aggregateHourlyTokens(halfHourUsage.records, tzOffset) : new Array<number>(24).fill(0)),
    [halfHourUsage, tzOffset],
  );

  // Fill date gaps in message stats so chart extends to today
  // (kept for backwards-compat — DailyActivityChart owns its own filling now)

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header + period selector */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold font-display tracking-tight">Sessions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Session activity across your AI coding tools.
          </p>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {/* Error state */}
      {sessionData.error && (
        <div className="rounded-card bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load session data: {sessionData.error}
        </div>
      )}

      {/* Loading state */}
      {(sessionData.loading || usageLoading || halfHourLoading) && <SessionsSkeleton />}

      {/* Content */}
      {!sessionData.loading && !usageLoading && !halfHourLoading && (
        <>
          {/* Overview stat cards */}
          <SessionOverview data={sessionData.overview} subtitle={subtitle} />

          {/* Efficiency metrics row */}
          {efficiency && (
            <StatGrid columns={2}>
              <StatCard
                title="Tokens / Hour"
                value={formatTokens(Math.round(efficiency.tokensPerHour))}
                subtitle={`${efficiency.totalCodingHours.toFixed(1)}h coding time`}
                icon={Zap}
                iconColor="text-chart-6"
              />
              <StatCard
                title="Reasoning Ratio"
                value={
                  reasoning && reasoning.reasoningTokens > 0
                    ? `${reasoning.reasoningPercent.toFixed(1)}%`
                    : "N/A"
                }
                subtitle="of output tokens are reasoning"
                icon={Brain}
                iconColor="text-chart-5"
              />
            </StatGrid>
          )}

          {/* Charts row: working hours + peak hours */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4">
            <WorkingHoursHeatmap data={sessionData.hoursGrid} />
            <PeakHoursCard hourly={peakHourly} slots={peakSlots.slice(0, 3)} />
          </div>

          <div className="grid grid-cols-1 gap-3 md:gap-4">
            <DailyActivityChart
              sessions={sessionData.records}
              deviceTimeline={deviceData?.timeline ?? []}
              devices={deviceData?.devices ?? []}
              deviceLoading={deviceLoading}
              tzOffset={tzOffset}
              today={today}
            />
          </div>
        </>
      )}
    </div>
  );
}
