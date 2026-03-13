"use client";

import { useState, useMemo } from "react";
import { Zap, Brain } from "lucide-react";
import { useSessionData } from "@/hooks/use-session-data";
import { useUsageData } from "@/hooks/use-usage-data";
import { SessionOverview } from "@/components/dashboard/session-overview";
import { StatCard, StatGrid } from "@/components/dashboard/stat-card";
import { WorkingHoursHeatmap } from "@/components/dashboard/working-hours-heatmap";
import { MessageStatsChart } from "@/components/dashboard/message-stats-chart";
import { PeakHoursCard } from "@/components/dashboard/peak-hours-card";
import { ProjectBreakdownChart } from "@/components/dashboard/project-breakdown-chart";
import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { FilterDropdown } from "@/components/dashboard/filter-dropdown";
import {
  PeriodSelector,
  periodToDateRange,
  periodLabel,
} from "@/components/dashboard/period-selector";
import type { Period } from "@/components/dashboard/period-selector";
import { computeTokensPerHour } from "@/lib/session-helpers";
import { computeReasoningRatio } from "@/lib/cost-helpers";
import { detectPeakHours } from "@/lib/date-helpers";
import { formatTokens } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SessionsPage() {
  const [period, setPeriod] = useState<Period>("all");
  const [projectFilter, setProjectFilter] = useState("");
  const { from, to } = periodToDateRange(period, new Date().getTimezoneOffset());

  // Primary fetch: all sessions (no project filter) — used for breakdown + default display
  const allData = useSessionData({
    from,
    ...(to ? { to } : {}),
  });

  // Secondary fetch: only fires when a project filter is active
  const filteredData = useSessionData({
    from,
    ...(to ? { to } : {}),
    ...(projectFilter ? { project: projectFilter } : {}),
    enabled: !!projectFilter,
  });

  // Use filtered data for charts when a project filter is active,
  // otherwise use the all-data results
  const active = projectFilter ? filteredData : allData;

  // Project names for the dropdown come from the unfiltered breakdown
  const projectNames = useMemo(
    () => allData.projectBreakdown.map((p) => p.projectName),
    [allData.projectBreakdown],
  );

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

  const subtitle = periodLabel(period);
  const loading = active.loading || (projectFilter ? allData.loading : false);

  const efficiency = useMemo(
    () =>
      usageData
        ? computeTokensPerHour(usageData.summary.total_tokens, active.overview)
        : null,
    [usageData, active.overview],
  );

  const reasoning = useMemo(
    () => (usageData ? computeReasoningRatio(usageData.summary) : null),
    [usageData],
  );

  const tzOffset = useMemo(() => new Date().getTimezoneOffset(), []);

  const peakSlots = useMemo(
    () => (halfHourUsage ? detectPeakHours(halfHourUsage.records, 5, tzOffset) : []),
    [halfHourUsage, tzOffset],
  );

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
        <div className="flex items-center gap-2">
          {projectNames.length > 0 && (
            <FilterDropdown
              value={projectFilter}
              onChange={setProjectFilter}
              options={projectNames.map((n) => ({ value: n, label: n }))}
              allLabel="All Projects"
            />
          )}
          <PeriodSelector value={period} onChange={setPeriod} />
        </div>
      </div>

      {/* Error state */}
      {active.error && (
        <div className="rounded-[var(--radius-card)] bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load session data: {active.error}
        </div>
      )}

      {/* Loading state */}
      {(loading || usageLoading || halfHourLoading) && <DashboardSkeleton />}

      {/* Content */}
      {!loading && !usageLoading && !halfHourLoading && (
        <>
          {/* Overview stat cards */}
          <SessionOverview data={active.overview} subtitle={subtitle} />

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

          {/* Project breakdown (only when not filtering by a specific project) */}
          {!projectFilter && (
            <div className="grid grid-cols-1 gap-3 md:gap-4">
              <ProjectBreakdownChart data={allData.projectBreakdown} />
            </div>
          )}

          {/* Charts row: working hours + peak hours */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4">
            <WorkingHoursHeatmap data={active.hoursGrid} />
            <PeakHoursCard slots={peakSlots} />
          </div>

          <div className="grid grid-cols-1 gap-3 md:gap-4">
            <MessageStatsChart data={active.dailyMessages} />
          </div>
        </>
      )}
    </div>
  );
}
