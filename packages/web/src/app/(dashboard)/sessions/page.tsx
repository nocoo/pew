"use client";

import { useState } from "react";
import { useSessionData } from "@/hooks/use-session-data";
import { SessionOverview } from "@/components/dashboard/session-overview";
import { WorkingHoursHeatmap } from "@/components/dashboard/working-hours-heatmap";
import { MessageStatsChart } from "@/components/dashboard/message-stats-chart";
import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton";
import {
  PeriodSelector,
  periodToDateRange,
  periodLabel,
} from "@/components/dashboard/period-selector";
import type { Period } from "@/components/dashboard/period-selector";

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

  const subtitle = periodLabel(period);

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
      {loading && <DashboardSkeleton />}

      {/* Content */}
      {!loading && (
        <>
          {/* Overview stat cards */}
          <SessionOverview data={overview} subtitle={subtitle} />

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
