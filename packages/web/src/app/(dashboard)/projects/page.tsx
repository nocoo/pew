"use client";

import { useMemo, useState } from "react";
import { useProjects } from "@/hooks/use-projects";
import type { Project } from "@/hooks/use-projects";
import { Skeleton } from "@/components/ui/skeleton";
import { ProjectBreakdownChart } from "@/components/dashboard/project-breakdown-chart";
import type { ProjectBreakdownItem } from "@/lib/session-helpers";
import { PeriodSelector } from "@/components/dashboard/period-selector";
import { periodToDateRange, periodLabel } from "@/lib/date-helpers";
import type { Period } from "@/lib/date-helpers";

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function ProjectsSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-xl bg-secondary p-4">
          <div className="flex items-center gap-4">
            <Skeleton className="h-4 w-4 rounded-full" />
            <div className="flex-1">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-24 mt-1" />
            </div>
            <Skeleton className="h-4 w-16" />
          </div>
          <Skeleton className="h-2 w-full mt-3 rounded-full" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat Grid
// ---------------------------------------------------------------------------

function StatGrid({ projects }: { projects: Project[] }) {
  const projectCount = projects.length;

  // Most Active: client-side sort by session_count desc — API returns created_at DESC
  const mostActive = useMemo(() => {
    if (projects.length === 0) return null;
    return [...projects].sort((a, b) => b.session_count - a.session_count)[0]!;
  }, [projects]);

  // Active (7d): uses absolute_last_active (wall-clock, never period-scoped)
  const recentCutoff = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString();
  }, []);
  const recentlyActive = useMemo(
    () =>
      projects.filter(
        (p) =>
          p.absolute_last_active !== null &&
          p.absolute_last_active >= recentCutoff,
      ).length,
    [projects, recentCutoff],
  );

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div className="rounded-[var(--radius-card)] bg-secondary p-4">
        <p className="text-xs text-muted-foreground">Projects</p>
        <p className="mt-1 text-2xl font-bold tabular-nums">{projectCount}</p>
      </div>
      <div className="rounded-[var(--radius-card)] bg-secondary p-4">
        <p className="text-xs text-muted-foreground">Most Active</p>
        <p className="mt-1 text-lg font-bold truncate">
          {mostActive ? mostActive.name : "—"}
        </p>
      </div>
      <div className="rounded-[var(--radius-card)] bg-secondary p-4">
        <p className="text-xs text-muted-foreground">Active (7d)</p>
        <p className="mt-1 text-2xl font-bold tabular-nums">
          {recentlyActive}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ProjectsPage() {
  const [period, setPeriod] = useState<Period>("all");
  const { from, to } = periodToDateRange(
    period,
    new Date().getTimezoneOffset(),
  );

  const { data, loading, error } = useProjects({
    from,
    ...(to ? { to } : {}),
  });

  const projects = useMemo(() => data?.projects ?? [], [data]);
  const unassigned = useMemo(() => data?.unassigned ?? [], [data]);

  // Build breakdown data from useProjects() — not useSessionData()
  const breakdownData: ProjectBreakdownItem[] = useMemo(() => {
    const items: ProjectBreakdownItem[] = projects.map((p) => ({
      projectName: p.name,
      sessions: p.session_count,
      totalHours: p.total_duration / 3600,
      totalMessages: p.total_messages,
    }));

    // Aggregate unassigned refs into one row
    const unassignedSessions = unassigned.reduce(
      (s, r) => s + r.session_count,
      0,
    );
    const unassignedHours =
      unassigned.reduce((s, r) => s + r.total_duration, 0) / 3600;
    const unassignedMessages = unassigned.reduce(
      (s, r) => s + r.total_messages,
      0,
    );

    if (unassignedSessions > 0) {
      items.push({
        projectName: "Unassigned",
        sessions: unassignedSessions,
        totalHours: unassignedHours,
        totalMessages: unassignedMessages,
      });
    }

    return items
      .filter((d) => d.sessions > 0)
      .sort((a, b) => b.sessions - a.sessions || b.totalHours - a.totalHours);
  }, [projects, unassigned]);

  const subtitle = periodLabel(period);
  const hasAnyData =
    projects.length > 0 ||
    unassigned.some((u) => u.session_count > 0);

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Compare usage across your projects ({subtitle}).
          </p>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-[var(--radius-card)] bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load project data: {error}
        </div>
      )}

      {/* Loading */}
      {loading && <ProjectsSkeleton />}

      {/* Content */}
      {!loading && data && (
        <>
          {!hasAnyData ? (
            <div className="rounded-[var(--radius-card)] bg-secondary p-8 text-center text-sm text-muted-foreground">
              No project data yet. Sync sessions from projects to see usage
              breakdown.
            </div>
          ) : (
            <>
              {/* Stat grid */}
              <StatGrid projects={projects} />

              {/* Charts row — trend + share charts wired in steps 11-12 */}

              {/* Breakdown chart */}
              <ProjectBreakdownChart data={breakdownData} />

              {/* Summary table — wired in step 13 */}
            </>
          )}
        </>
      )}
    </div>
  );
}
