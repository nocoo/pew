"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { cn } from "@/lib/utils";
import { chart, chartAxis, CHART_COLORS } from "@/lib/palette";
import type { ProjectBreakdownItem } from "@/lib/session-helpers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}m`;
  return `${h.toFixed(1)}h`;
}

// ---------------------------------------------------------------------------
// Custom tooltip
// ---------------------------------------------------------------------------

function ProjectTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{
    dataKey: string;
    value: number;
    color: string;
    payload?: { projectName: string; sessions: number; totalHours: number; totalMessages: number };
  }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  const d = payload[0]?.payload;
  if (!d) return null;

  return (
    <div className="rounded-[var(--radius-widget)] border border-border bg-card p-2.5 shadow-sm">
      <p className="mb-1 text-xs font-medium text-foreground">
        {d.projectName}
      </p>
      <div className="space-y-0.5">
        <div className="flex items-center gap-2 text-xs">
          <div
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: chart.teal }}
          />
          <span className="text-muted-foreground">Sessions</span>
          <span className="ml-auto font-medium text-foreground">
            {d.sessions}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <div
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: CHART_COLORS[1] }}
          />
          <span className="text-muted-foreground">Hours</span>
          <span className="ml-auto font-medium text-foreground">
            {formatHours(d.totalHours)}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <div
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: CHART_COLORS[2] }}
          />
          <span className="text-muted-foreground">Messages</span>
          <span className="ml-auto font-medium text-foreground">
            {d.totalMessages.toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ProjectBreakdownChartProps {
  data: ProjectBreakdownItem[];
  className?: string;
}

/**
 * Horizontal bar chart showing session activity per project.
 * Each bar represents session count; tooltip shows hours + messages.
 */
export function ProjectBreakdownChart({
  data,
  className,
}: ProjectBreakdownChartProps) {
  if (!data.length) {
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

  // Top 10 projects, reversed for horizontal bar (top item at visual top)
  const top = data.slice(0, 10);
  const chartData = [...top].reverse();

  const barHeight = 32;
  const chartHeight = Math.max(chartData.length * barHeight + 40, 160);

  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] bg-secondary p-4 md:p-5",
        className,
      )}
    >
      <p className="mb-4 text-xs md:text-sm text-muted-foreground">
        By Project
      </p>

      <div style={{ height: chartHeight }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 0, right: 4, left: 0, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={chartAxis}
              strokeOpacity={0.15}
              horizontal={false}
            />
            <XAxis
              type="number"
              tick={{ fill: chartAxis, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <YAxis
              type="category"
              dataKey="projectName"
              tick={{ fill: chartAxis, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={140}
            />
            <Tooltip content={<ProjectTooltip />} />
            <Bar
              dataKey="sessions"
              fill={chart.teal}
              radius={[0, 4, 4, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
