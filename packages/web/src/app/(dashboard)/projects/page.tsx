"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useProjects } from "@/hooks/use-projects";
import { ErrorBanner } from "@/components/ui/error-banner";
import type { Project } from "@/hooks/use-projects";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartCardSkeleton } from "@/components/dashboard/chart-card-skeleton";
import { ProjectBreakdownChart } from "@/components/dashboard/project-breakdown-chart";
import {
  ProjectTrendChart,
  type ProjectTimelinePoint,
} from "@/components/dashboard/project-trend-chart";
import { ProjectShareChart } from "@/components/dashboard/project-share-chart";
import type { ProjectBreakdownItem } from "@/lib/session-helpers";
import { PeriodSelector } from "@/components/dashboard/period-selector";
import {
  periodToDateRange,
  periodLabel,
  formatDuration,
  getLocalToday,
  fillDateRange,
} from "@/lib/date-helpers";
import type { Period } from "@/lib/date-helpers";
import { sourceLabel } from "@/hooks/use-usage-data";
import { CHART_COLORS } from "@/lib/palette";
import { FilterDropdown } from "@/components/dashboard/filter-dropdown";
import { ProjectsEmptyState } from "@/components/dashboard/empty-state";
import { Plus, X } from "lucide-react";

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function ProjectsSkeleton() {
  return (
    <div className="space-y-4 md:space-y-6">
      {/* Stat grid (3 cols) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-card bg-secondary p-4 space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-24" />
          </div>
        ))}
      </div>

      {/* 2-col chart grid (Trend + Share) */}
      <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <ChartCardSkeleton key={i} titleWidth="w-24" chartHeight="h-[240px] md:h-[280px]" />
        ))}
      </div>

      {/* Breakdown chart */}
      <ChartCardSkeleton titleWidth="w-28" chartHeight="h-[200px] md:h-[240px]" />

      {/* Summary table */}
      <div className="rounded-xl bg-secondary p-1">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-3 text-left"><Skeleton className="h-3 w-14" /></th>
              <th className="px-4 py-3 text-left hidden lg:table-cell"><Skeleton className="h-3 w-10" /></th>
              <th className="px-4 py-3 text-right"><Skeleton className="h-3 w-12 ml-auto" /></th>
              <th className="px-4 py-3 text-right hidden sm:table-cell"><Skeleton className="h-3 w-14 ml-auto" /></th>
              <th className="px-4 py-3 text-right hidden md:table-cell"><Skeleton className="h-3 w-12 ml-auto" /></th>
              <th className="px-4 py-3 text-left"><Skeleton className="h-3 w-10" /></th>
              <th className="px-4 py-3 text-right hidden md:table-cell"><Skeleton className="h-3 w-16 ml-auto" /></th>
              <th className="px-4 py-3 text-right hidden md:table-cell"><Skeleton className="h-3 w-10 ml-auto" /></th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 4 }).map((_, i) => (
              <tr key={i} className="border-b border-border/50 last:border-0">
                <td className="px-4 py-3"><Skeleton className="h-4 w-28" /></td>
                <td className="px-4 py-3 hidden lg:table-cell"><Skeleton className="h-4 w-16" /></td>
                <td className="px-4 py-3"><Skeleton className="h-4 w-10 ml-auto" /></td>
                <td className="px-4 py-3 hidden sm:table-cell"><Skeleton className="h-4 w-10 ml-auto" /></td>
                <td className="px-4 py-3 hidden md:table-cell"><Skeleton className="h-4 w-14 ml-auto" /></td>
                <td className="px-4 py-3"><Skeleton className="h-4 w-16" /></td>
                <td className="px-4 py-3 hidden md:table-cell"><Skeleton className="h-4 w-16 ml-auto" /></td>
                <td className="px-4 py-3 hidden md:table-cell"><Skeleton className="h-2 w-full rounded-full" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
    return [...projects].sort((a, b) => b.session_count - a.session_count)[0] as (typeof projects)[number];
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
      <div className="rounded-card bg-secondary p-4">
        <p className="text-xs text-muted-foreground">Projects</p>
        <p className="mt-1 text-2xl font-bold tabular-nums">{projectCount}</p>
      </div>
      <div className="rounded-card bg-secondary p-4">
        <p className="text-xs text-muted-foreground">Most Active</p>
        <p className="mt-1 text-lg font-bold truncate">
          {mostActive ? mostActive.name : "—"}
        </p>
      </div>
      <div className="rounded-card bg-secondary p-4">
        <p className="text-xs text-muted-foreground">Active (7d)</p>
        <p className="mt-1 text-2xl font-bold tabular-nums">
          {recentlyActive}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Relative time helper
// ---------------------------------------------------------------------------

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  if (diffMs < 0) return "just now";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

// ---------------------------------------------------------------------------
// Tag validation
// ---------------------------------------------------------------------------

const TAG_REGEX = /^[a-z0-9-]{1,30}$/;

// ---------------------------------------------------------------------------
// Inline Tag Editor
// ---------------------------------------------------------------------------

function TagEditor({
  project,
  allTags,
  onAddTag,
  onRemoveTag,
  onTagClick,
}: {
  project: Project;
  allTags: string[];
  onAddTag: (projectId: string, tag: string) => void;
  onRemoveTag: (projectId: string, tag: string) => void;
  onTagClick: (tag: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = useMemo(() => {
    if (!input) return [];
    const lower = input.toLowerCase();
    return allTags.filter(
      (t) => t.includes(lower) && !project.tags.includes(t),
    );
  }, [input, allTags, project.tags]);

  const handleAdd = (tag: string) => {
    const normalized = tag.toLowerCase().trim();
    if (TAG_REGEX.test(normalized) && !project.tags.includes(normalized)) {
      onAddTag(project.id, normalized);
    }
    setInput("");
    setEditing(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      {project.tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-0.5 rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
        >
          <button
            type="button"
            className="hover:text-foreground transition-colors cursor-pointer"
            onClick={() => onTagClick(tag)}
          >
            {tag}
          </button>
          <button
            type="button"
            className="ml-0.5 hover:text-destructive transition-colors cursor-pointer"
            onClick={() => onRemoveTag(project.id, tag)}
            aria-label={`Remove tag ${tag}`}
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}
      {editing ? (
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && input.trim()) {
                e.preventDefault();
                handleAdd(input);
              } else if (e.key === "Escape") {
                setInput("");
                setEditing(false);
              }
            }}
            onBlur={() => {
              // Delay to allow suggestion click
              setTimeout(() => {
                setInput("");
                setEditing(false);
              }, 150);
            }}
            placeholder="tag..."
            className="w-20 rounded bg-background px-1.5 py-0.5 text-[10px] text-foreground outline-none ring-1 ring-border focus:ring-primary"
            autoFocus
          />
          {suggestions.length > 0 && (
            <div className="absolute left-0 top-full z-10 mt-1 rounded-md border border-border bg-secondary shadow-md">
              {suggestions.slice(0, 5).map((s) => (
                <button
                  key={s}
                  type="button"
                  className="block w-full px-2.5 py-1 text-left text-[10px] hover:bg-accent transition-colors cursor-pointer"
                  onMouseDown={(e) => {
                    e.preventDefault(); // prevent blur
                    handleAdd(s);
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-accent hover:bg-accent/80 transition-colors cursor-pointer"
          onClick={() => setEditing(true)}
          aria-label="Add tag"
        >
          <Plus className="h-2.5 w-2.5 text-muted-foreground" />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary Table
// ---------------------------------------------------------------------------

function SummaryTable({
  projects,
  allTags,
  hasPeriod,
  onAddTag,
  onRemoveTag,
  onTagClick,
}: {
  projects: Project[];
  allTags: string[];
  hasPeriod: boolean;
  onAddTag: (projectId: string, tag: string) => void;
  onRemoveTag: (projectId: string, tag: string) => void;
  onTagClick: (tag: string) => void;
}) {
  const grandSessions = useMemo(
    () => projects.reduce((s, p) => s + p.session_count, 0),
    [projects],
  );

  return (
    <div className="rounded-xl bg-secondary p-1 overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border">
            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
              Project
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground hidden lg:table-cell">
              Tools
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">
              Sessions
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground hidden sm:table-cell">
              Messages
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground hidden md:table-cell">
              Duration
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
              Tags
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground hidden md:table-cell">
              Last Active
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground w-32 hidden md:table-cell">
              Share
            </th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project, i) => {
            const pct =
              grandSessions > 0
                ? (project.session_count / grandSessions) * 100
                : 0;
            // Period-scoped tools: only show aliases with sessions in the period
            const visibleAliases = hasPeriod
              ? project.aliases.filter((a) => a.session_count > 0)
              : project.aliases;
            return (
              <tr
                key={project.id}
                className="border-b border-border/50 last:border-0 hover:bg-accent/50 transition-colors"
              >
                {/* Project name */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <div
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{
                        backgroundColor:
                          CHART_COLORS[i % CHART_COLORS.length],
                      }}
                    />
                    <span className="text-sm font-medium text-foreground">
                      {project.name}
                    </span>
                  </div>
                </td>
                {/* Tools */}
                <td className="px-4 py-3 hidden lg:table-cell">
                  <div className="flex gap-1.5">
                    {visibleAliases.length > 0
                      ? visibleAliases.map((a) => (
                          <span
                            key={`${a.source}:${a.project_ref}`}
                            className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                          >
                            {sourceLabel(a.source)}
                          </span>
                        ))
                      : <span className="text-[10px] text-muted-foreground/60">—</span>}
                  </div>
                </td>
                {/* Sessions */}
                <td className="px-4 py-3 text-sm text-right tabular-nums font-medium">
                  {project.session_count.toLocaleString()}
                </td>
                {/* Messages */}
                <td className="px-4 py-3 text-sm text-right tabular-nums hidden sm:table-cell">
                  {project.total_messages.toLocaleString()}
                </td>
                {/* Duration */}
                <td className="px-4 py-3 text-sm text-right tabular-nums hidden md:table-cell">
                  {formatDuration(project.total_duration)}
                </td>
                {/* Tags */}
                <td className="px-4 py-3">
                  <TagEditor
                    project={project}
                    allTags={allTags}
                    onAddTag={onAddTag}
                    onRemoveTag={onRemoveTag}
                    onTagClick={onTagClick}
                  />
                </td>
                {/* Last Active */}
                <td className="px-4 py-3 text-xs text-right text-muted-foreground hidden md:table-cell">
                  {relativeTime(project.last_active)}
                </td>
                {/* Share */}
                <td className="px-4 py-3 hidden md:table-cell">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 rounded-full bg-background overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${pct}%`,
                          backgroundColor:
                            CHART_COLORS[i % CHART_COLORS.length],
                        }}
                      />
                    </div>
                    <span className="text-[10px] tabular-nums text-muted-foreground w-8 text-right">
                      {pct.toFixed(0)}%
                    </span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-border">
            <td className="px-4 py-3 text-sm font-medium" colSpan={2}>
              Total
            </td>
            <td className="px-4 py-3 text-sm text-right tabular-nums font-bold">
              {grandSessions.toLocaleString()}
            </td>
            <td className="px-4 py-3 text-sm text-right tabular-nums font-medium hidden sm:table-cell">
              {projects
                .reduce((s, p) => s + p.total_messages, 0)
                .toLocaleString()}
            </td>
            <td className="px-4 py-3 text-sm text-right tabular-nums font-medium hidden md:table-cell">
              {formatDuration(
                projects.reduce((s, p) => s + p.total_duration, 0),
              )}
            </td>
            <td className="px-4 py-3" />
            <td className="px-4 py-3 hidden md:table-cell" />
            <td className="px-4 py-3 hidden md:table-cell" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ProjectsPage() {
  const [period, setPeriod] = useState<Period>("all");
  const [tagFilter, setTagFilter] = useState("");
  const tzOffset = useMemo(() => new Date().getTimezoneOffset(), []); // frozen per mount — acceptable; page refresh handles DST changes
  const today = useMemo(() => getLocalToday(tzOffset), [tzOffset]);
  const { from, to } = periodToDateRange(
    period,
    tzOffset,
  );

  const { data, loading, error, allTags, updateProject } = useProjects({
    from,
    ...(to !== undefined && { to }),
  });

  // -------------------------------------------------------------------------
  // Timeline fetch
  // -------------------------------------------------------------------------

  const [timeline, setTimeline] = useState<ProjectTimelinePoint[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams();
        params.set("from", from);
        if (to) params.set("to", to);
        const res = await fetch(`/api/projects/timeline?${params}`);
        if (cancelled) return;
        if (!res.ok) {
          setTimeline([]);
          return;
        }
        const json = (await res.json()) as { timeline: ProjectTimelinePoint[] };
        if (!cancelled) setTimeline(json.timeline);
      } catch {
        if (!cancelled) setTimeline([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  const projects = useMemo(() => data?.projects ?? [], [data]);
  const unassigned = useMemo(() => data?.unassigned ?? [], [data]);

  // -------------------------------------------------------------------------
  // Tag filter — scopes entire page (stat grid, charts, table)
  // -------------------------------------------------------------------------

  const tagFilterOptions = useMemo(
    () => allTags.map((t) => ({ value: t, label: t })),
    [allTags],
  );

  const filteredProjects = useMemo(
    () =>
      tagFilter
        ? projects.filter((p) => p.tags.includes(tagFilter))
        : projects,
    [projects, tagFilter],
  );

  // Unassigned refs have no tags — hide when tag filter is active
  const filteredUnassigned = useMemo(
    () => (tagFilter ? [] : unassigned),
    [unassigned, tagFilter],
  );

  // Filter timeline to only include filtered project names
  const filteredTimeline = useMemo(() => {
    if (!tagFilter) return timeline;
    const allowedNames = new Set(filteredProjects.map((p) => p.name));
    return timeline
      .map((point) => {
        const filtered: Record<string, number> = {};
        for (const [name, count] of Object.entries(point.projects)) {
          if (allowedNames.has(name)) filtered[name] = count;
        }
        return { date: point.date, projects: filtered };
      })
      .filter((point) => Object.keys(point.projects).length > 0);
  }, [timeline, tagFilter, filteredProjects]);

  // Fill date gaps so charts extend to today
  const filledTimeline = useMemo(() => {
    if (filteredTimeline.length === 0) return filteredTimeline;
    // Collect all project names so missing keys get 0 instead of undefined
    const allNames = new Set<string>();
    for (const pt of filteredTimeline) {
      for (const name of Object.keys(pt.projects)) {
        allNames.add(name);
      }
    }
    const filled = fillDateRange(
      filteredTimeline,
      "date",
      (d) => ({ date: d, projects: {} as Record<string, number> }),
      today,
    );
    // Backfill every point so every project name is present (0 if missing)
    return filled.map((pt) => {
      const projects = { ...pt.projects };
      for (const name of allNames) {
        if (!(name in projects)) projects[name] = 0;
      }
      return { ...pt, projects };
    });
  }, [filteredTimeline, today]);

  // -------------------------------------------------------------------------
  // Tag mutations
  // -------------------------------------------------------------------------

  const handleAddTag = useCallback(
    (projectId: string, tag: string) => {
      updateProject(projectId, { add_tags: [tag] });
    },
    [updateProject],
  );

  const handleRemoveTag = useCallback(
    (projectId: string, tag: string) => {
      updateProject(projectId, { remove_tags: [tag] });
    },
    [updateProject],
  );

  const handleTagClick = useCallback((tag: string) => {
    setTagFilter(tag);
  }, []);

  // Build breakdown data from filtered projects — not useSessionData()
  const breakdownData: ProjectBreakdownItem[] = useMemo(() => {
    const items: ProjectBreakdownItem[] = filteredProjects.map((p) => ({
      projectName: p.name,
      sessions: p.session_count,
      totalHours: p.total_duration / 3600,
      totalMessages: p.total_messages,
    }));

    // Aggregate unassigned refs into one row
    const unassignedSessions = filteredUnassigned.reduce(
      (s, r) => s + r.session_count,
      0,
    );
    const unassignedHours =
      filteredUnassigned.reduce((s, r) => s + r.total_duration, 0) / 3600;
    const unassignedMessages = filteredUnassigned.reduce(
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
  }, [filteredProjects, filteredUnassigned]);

  const subtitle = periodLabel(period);
  const hasPeriod = period !== "all";
  const hasAnyData =
    filteredProjects.length > 0 ||
    filteredUnassigned.some((u) => u.session_count > 0);
  const hasRawData =
    projects.length > 0 ||
    unassigned.some((u) => u.session_count > 0);
  const isTagFilterEmpty = tagFilter !== "" && !hasAnyData && hasRawData;

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold font-display tracking-tight">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Compare usage across your projects ({subtitle}).
          </p>
        </div>
        <div className="flex items-center gap-2">
          {allTags.length > 0 && (
            <FilterDropdown
              label="Tag"
              value={tagFilter}
              onChange={setTagFilter}
              options={tagFilterOptions}
              allLabel="All Tags"
            />
          )}
          <PeriodSelector value={period} onChange={setPeriod} />
        </div>
      </div>

      {/* Error */}
      <ErrorBanner messagePrefix="Failed to load project data" error={error} />

      {/* Loading */}
      {loading && <ProjectsSkeleton />}

      {/* Content */}
      {!loading && data && (
        <>
          {!hasAnyData ? (
            <ProjectsEmptyState
              isFilterEmpty={isTagFilterEmpty}
              filterValue={tagFilter}
            />
          ) : (
            <>
              {/* Stat grid */}
              <StatGrid projects={filteredProjects} />

              {/* Charts row */}
              <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
                <ProjectTrendChart timeline={filledTimeline} />
                <ProjectShareChart timeline={filledTimeline} />
              </div>

              {/* Breakdown chart */}
              <ProjectBreakdownChart data={breakdownData} />

              {/* Summary table */}
              {filteredProjects.length > 0 && (
                <SummaryTable
                  projects={filteredProjects}
                  allTags={allTags}
                  hasPeriod={hasPeriod}
                  onAddTag={handleAddTag}
                  onRemoveTag={handleRemoveTag}
                  onTagClick={handleTagClick}
                />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
