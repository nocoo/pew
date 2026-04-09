"use client";

import { useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { cn } from "@/lib/utils";
import { chartAxis, CHART_COLORS } from "@/lib/palette";
import { DashboardResponsiveContainer } from "./dashboard-responsive-container";
import type { ProjectTimelinePoint } from "./project-trend-chart";
import { ChartTooltip, ChartTooltipRow } from "./chart-tooltip";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProjectShareChartProps {
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

function fmtPct(value: number): string {
  return `${Math.round(value)}%`;
}

/** Convert absolute timeline to 100% stacked share points. */
function toSharePoints(
  timeline: ProjectTimelinePoint[],
): Array<Record<string, string | number>> {
  return timeline.map((t) => {
    const total = Object.values(t.projects).reduce((s, v) => s + v, 0);
    const point: Record<string, string | number> = { date: t.date };
    for (const [name, count] of Object.entries(t.projects)) {
      point[name] = total > 0 ? (count / total) * 100 : 0;
    }
    return point;
  });
}

// ---------------------------------------------------------------------------
// Custom tooltip
// ---------------------------------------------------------------------------

function ProjectShareTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  const items = [...payload].reverse();

  return (
    <ChartTooltip title={label ? fmtDate(label) : undefined}>
      {items.map((entry) => (
        <ChartTooltipRow
          key={entry.dataKey}
          color={entry.color}
          label={entry.dataKey}
          value={`${entry.value.toFixed(1)}%`}
        />
      ))}
    </ChartTooltip>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * 100% stacked AreaChart showing each project's share of daily sessions.
 * Useful for spotting when work shifts between projects.
 */
export function ProjectShareChart({
  timeline,
  className,
}: ProjectShareChartProps) {
  const chartData = useMemo(() => toSharePoints(timeline), [timeline]);

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

  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] bg-secondary p-4 md:p-5",
        className,
      )}
    >
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs md:text-sm text-muted-foreground">
          Project Share
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {projectKeys.map((name, i) => (
            <div key={name} className="flex items-center gap-1.5">
              <div
                className="h-2 w-2 rounded-full"
                style={{
                  background: CHART_COLORS[i % CHART_COLORS.length] as string,
                }}
              />
              <span className="text-xs text-muted-foreground">{name}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="h-[240px] md:h-[280px]">
        <DashboardResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
            stackOffset="none"
          >
            <defs>
              {projectKeys.map((name, i) => (
                <linearGradient
                  key={name}
                  id={`gradProject${i}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="0%"
                    stopColor={CHART_COLORS[i % CHART_COLORS.length] as string}
                    stopOpacity={0.6}
                  />
                  <stop
                    offset="100%"
                    stopColor={CHART_COLORS[i % CHART_COLORS.length] as string}
                    stopOpacity={0.2}
                  />
                </linearGradient>
              ))}
            </defs>
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
              tickFormatter={fmtPct}
              tick={{ fill: chartAxis, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={44}
              domain={[0, 100]}
            />
            <Tooltip content={<ProjectShareTooltip />} isAnimationActive={false} />
            {projectKeys.map((name, i) => (
              <Area
                key={name}
                type="monotone"
                dataKey={name}
                stackId="1"
                stroke={CHART_COLORS[i % CHART_COLORS.length] as string}
                strokeWidth={1.5}
                fill={`url(#gradProject${i})`}
              />
            ))}
          </AreaChart>
        </DashboardResponsiveContainer>
      </div>
    </div>
  );
}
