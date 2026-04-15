"use client";

import { useState, useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { cn } from "@/lib/utils";
import { chartAxis, CHART_COLORS } from "@/lib/palette";
import { nextHiddenLegendKeys } from "@/lib/chart-legend-filter";
import { DashboardResponsiveContainer } from "./dashboard-responsive-container";
import {
  ChartTooltip,
  ChartTooltipRow,
  ChartTooltipSummary,
} from "./chart-tooltip";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectTimelinePoint {
  date: string;
  projects: Record<string, number>;
}

interface ProjectTrendChartProps {
  timeline: ProjectTimelinePoint[];
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// ---------------------------------------------------------------------------
// Custom tooltip
// ---------------------------------------------------------------------------

function ProjectTrendTooltip({
  active,
  payload,
  label,
  hiddenProjects,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; color: string }>;
  label?: string;
  hiddenProjects: Set<string>;
}) {
  if (!active || !payload?.length) return null;

  const visible = payload.filter((e) => !hiddenProjects.has(e.dataKey));
  if (!visible.length) return null;

  const total = visible.reduce((sum, e) => sum + e.value, 0);

  return (
    <ChartTooltip title={label ? fmtDate(label) : undefined}>
      {visible.map((entry) => (
        <ChartTooltipRow
          key={entry.dataKey}
          color={entry.color}
          label={entry.dataKey}
          value={String(entry.value)}
        />
      ))}
      {visible.length > 1 && (
        <ChartTooltipSummary label="Total" value={String(total)} />
      )}
    </ChartTooltip>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Multi-line LineChart showing daily session counts per project over time.
 * Each project gets a distinct colored line.
 * Click legend to isolate, cmd/ctrl+click legend to toggle visibility.
 */
export function ProjectTrendChart({
  timeline,
  className,
}: ProjectTrendChartProps) {
  const [hiddenProjects, setHiddenProjects] = useState<Set<string>>(new Set());

  // Flatten timeline API shape to recharts format:
  // [{ date, pew: 5, "work-api": 3 }]
  const chartData = useMemo(
    () => timeline.map((t) => ({ date: t.date, ...t.projects })),
    [timeline],
  );

  // Extract unique project keys across all days
  const projectKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const pt of chartData) {
      for (const key of Object.keys(pt)) {
        if (key !== "date") keys.add(key);
      }
    }
    return Array.from(keys);
  }, [chartData]);

  if (!chartData.length) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-[var(--radius-card)] bg-secondary p-8 text-sm text-muted-foreground",
          className,
        )}
      >
        No project data yet
      </div>
    );
  }

  function handleLegendClick(name: string, metaKey: boolean) {
    setHiddenProjects((prev) => {
      return nextHiddenLegendKeys({
        keys: projectKeys,
        hiddenKeys: prev,
        targetKey: name,
        metaKey,
      });
    });
  }

  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] bg-secondary p-4 md:p-5",
        className,
      )}
    >
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs md:text-sm text-muted-foreground">
          Project Trend
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {projectKeys.map((name, i) => {
            const isHidden = hiddenProjects.has(name);
            return (
              <button
                key={name}
                type="button"
                onClick={(event) =>
                  handleLegendClick(name, event.metaKey || event.ctrlKey)
                }
                className={cn(
                  "flex items-center gap-1.5 transition-opacity",
                  isHidden && "opacity-40",
                )}
              >
                <div
                  className="h-2 w-2 rounded-full"
                  style={{
                    background: CHART_COLORS[i % CHART_COLORS.length],
                  }}
                />
                <span className="text-xs text-muted-foreground">{name}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="h-[240px] md:h-[280px]">
        <DashboardResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={chartAxis}
              strokeOpacity={0.15}
              vertical={false}
            />
            <XAxis
              dataKey="date"
              tickFormatter={fmtDate}
              tick={{ fill: chartAxis, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fill: chartAxis, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={40}
            />
            <Tooltip
              content={
                <ProjectTrendTooltip hiddenProjects={hiddenProjects} />
              }
              isAnimationActive={false}
            />
            {projectKeys.map((name, i) => (
              <Line
                key={name}
                type="monotone"
                dataKey={name}
                stroke={CHART_COLORS[i % CHART_COLORS.length] as string}
                strokeWidth={2}
                dot={false}
                hide={hiddenProjects.has(name)}
              />
            ))}
          </LineChart>
        </DashboardResponsiveContainer>
      </div>
    </div>
  );
}
