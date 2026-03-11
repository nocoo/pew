"use client";

import { useState, useMemo } from "react";
import { useSessionData } from "@/hooks/use-session-data";
import { SessionOverview } from "@/components/dashboard/session-overview";
import { WorkingHoursHeatmap } from "@/components/dashboard/working-hours-heatmap";
import { MessageStatsChart } from "@/components/dashboard/message-stats-chart";
import { ProjectBreakdownChart } from "@/components/dashboard/project-breakdown-chart";
import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton";
import {
  PeriodSelector,
  periodToDateRange,
  periodLabel,
} from "@/components/dashboard/period-selector";
import type { Period } from "@/components/dashboard/period-selector";

// ---------------------------------------------------------------------------
// Project filter dropdown
// ---------------------------------------------------------------------------

interface ProjectFilterProps {
  value: string;
  onChange: (v: string) => void;
  /** Available project names (from breakdown data) */
  projectNames: string[];
}

function ProjectFilter({ value, onChange, projectNames }: ProjectFilterProps) {
  if (projectNames.length === 0) return null;

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium text-foreground border-none outline-none cursor-pointer"
    >
      <option value="">All Projects</option>
      {projectNames.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SessionsPage() {
  const [period, setPeriod] = useState<Period>("all");
  const [projectFilter, setProjectFilter] = useState("");
  const { from, to } = periodToDateRange(period);

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

  const subtitle = periodLabel(period);
  const loading = active.loading || (projectFilter ? allData.loading : false);

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
        <div className="flex items-center gap-2">
          <ProjectFilter
            value={projectFilter}
            onChange={setProjectFilter}
            projectNames={projectNames}
          />
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
      {loading && <DashboardSkeleton />}

      {/* Content */}
      {!loading && (
        <>
          {/* Overview stat cards */}
          <SessionOverview data={active.overview} subtitle={subtitle} />

          {/* Project breakdown (only when not filtering by a specific project) */}
          {!projectFilter && (
            <div className="grid grid-cols-1 gap-3 md:gap-4">
              <ProjectBreakdownChart data={allData.projectBreakdown} />
            </div>
          )}

          {/* Charts */}
          <div className="grid grid-cols-1 gap-3 md:gap-4">
            <WorkingHoursHeatmap data={active.hoursGrid} />
          </div>

          <div className="grid grid-cols-1 gap-3 md:gap-4">
            <MessageStatsChart data={active.dailyMessages} />
          </div>
        </>
      )}
    </div>
  );
}
