"use client";

import { useState, useMemo } from "react";
import { Zap, Brain } from "lucide-react";
import { useSessionData } from "@/hooks/use-session-data";
import { useUsageData } from "@/hooks/use-usage-data";
import { SessionOverview } from "@/components/dashboard/session-overview";
import { StatCard, StatGrid } from "@/components/dashboard/stat-card";
import { WorkingHoursHeatmap } from "@/components/dashboard/working-hours-heatmap";
import { MessageStatsChart } from "@/components/dashboard/message-stats-chart";
import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton";
import {
  PeriodSelector,
  periodToDateRange,
  periodLabel,
} from "@/components/dashboard/period-selector";
import type { Period } from "@/components/dashboard/period-selector";
import { computeTokensPerHour } from "@/lib/session-helpers";
import { computeReasoningRatio } from "@/lib/cost-helpers";
import { formatTokens } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SessionsPage() {
  const [period, setPeriod] = useState<Period>("all");
  const { from, to } = periodToDateRange(period);

  const { overview, hoursGrid, dailyMessages, loading, error } =
    useSessionData({
      from,
      ...(to ? { to } : {}),
    });

  // Fetch usage data for token totals (needed for tokens/hour + reasoning ratio)
  const { data: usageData, loading: usageLoading } = useUsageData({
    from,
    ...(to ? { to } : {}),
  });

  const subtitle = periodLabel(period);

  const efficiency = useMemo(
    () =>
      usageData
        ? computeTokensPerHour(usageData.summary.total_tokens, overview)
        : null,
    [usageData, overview],
  );

  const reasoning = useMemo(
    () => (usageData ? computeReasoningRatio(usageData.summary) : null),
    [usageData],
  );

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header + period selector */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display">Sessions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Session activity across your AI coding tools.
          </p>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-[var(--radius-card)] bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load session data: {error}
        </div>
      )}

      {/* Loading state */}
      {(loading || usageLoading) && <DashboardSkeleton />}

      {/* Content */}
      {!loading && !usageLoading && (
        <>
          {/* Overview stat cards */}
          <SessionOverview data={overview} subtitle={subtitle} />

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

          {/* Charts row */}
          <div className="grid grid-cols-1 gap-3 md:gap-4">
            <WorkingHoursHeatmap data={hoursGrid} />
          </div>

          <div className="grid grid-cols-1 gap-3 md:gap-4">
            <MessageStatsChart data={dailyMessages} />
          </div>
        </>
      )}
    </div>
  );
}
