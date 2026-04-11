"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { cn, formatTokens } from "@/lib/utils";
import { fmtHour } from "@/lib/date-helpers";
import { chartAxis, agentColor } from "@/lib/palette";
import { sourceLabel } from "@/hooks/use-usage-data";
import type { HourlyByAgentPoint } from "@/lib/usage-helpers";
import { DashboardResponsiveContainer } from "./dashboard-responsive-container";
import {
  ChartTooltip,
  ChartTooltipRow,
  ChartTooltipSummary,
} from "./chart-tooltip";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HourlyAgentChartProps {
  data: HourlyByAgentPoint[];
  className?: string;
  /** Compact mode for sidebar layout: smaller height, no legend */
  compact?: boolean;
}

// ---------------------------------------------------------------------------
// Custom tooltip
// ---------------------------------------------------------------------------

function AgentTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{
    dataKey: string;
    value: number;
    color: string;
  }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  // Sort by value descending for display
  const sorted = [...payload].sort((a, b) => b.value - a.value);
  const total = sorted.reduce((sum, p) => sum + p.value, 0);

  return (
    <ChartTooltip title={typeof label === "number" ? fmtHour(label) : label}>
      {sorted.map((entry) => (
        <ChartTooltipRow
          key={entry.dataKey}
          color={entry.color}
          label={sourceLabel(entry.dataKey)}
          value={formatTokens(entry.value)}
        />
      ))}
      <ChartTooltipSummary label="Total" value={formatTokens(total)} />
    </ChartTooltip>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Stacked bar chart showing average hourly token usage by agent (source).
 * X-axis is hours 0-23, Y-axis is tokens, bars are stacked by agent.
 */
export function HourlyAgentChart({
  data,
  className,
  compact = false,
}: HourlyAgentChartProps) {
  if (!data.length || data.every((d) => Object.keys(d.sources).length === 0)) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-[var(--radius-card)] bg-secondary p-8 text-sm text-muted-foreground",
          className,
        )}
      >
        No agent data available
      </div>
    );
  }

  // Get all source keys from the first data point (all points have same keys)
  const sourceKeys = Object.keys(data[0]?.sources ?? {});

  // Transform data for Recharts: { hour, source1: value, source2: value, ... }
  const chartData = data.map((d) => ({
    hour: d.hour,
    ...d.sources,
  }));

  // Build legend entries
  const legendItems = sourceKeys.map((source) => ({
    key: source,
    label: sourceLabel(source),
    color: agentColor(source).color,
  }));

  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] bg-secondary p-4 md:p-5",
        className,
      )}
    >
      <div className={cn("flex flex-wrap items-center justify-between gap-2", compact ? "mb-2" : "mb-4")}>
        <p className="text-xs md:text-sm text-muted-foreground">
          {compact ? "By Agent" : "Hourly By Agent"}
        </p>
        {!compact && (
          <div className="flex flex-wrap items-center gap-3">
            {legendItems.map(({ key, label, color }) => (
              <div key={key} className="flex items-center gap-1.5">
                <div
                  className="h-2 w-2 rounded-full"
                  style={{ background: color }}
                />
                <span className="text-xs text-muted-foreground">{label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ height: compact ? 160 : 280 }}>
        <DashboardResponsiveContainer width="100%" height="100%">
          <BarChart
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
              dataKey="hour"
              tickFormatter={fmtHour}
              tick={{ fill: chartAxis, fontSize: compact ? 9 : 11 }}
              axisLine={false}
              tickLine={false}
              interval={compact ? 5 : 2}
            />
            <YAxis
              tickFormatter={formatTokens}
              tick={{ fill: chartAxis, fontSize: compact ? 9 : 11 }}
              axisLine={false}
              tickLine={false}
              width={compact ? 40 : 50}
            />
            <Tooltip
              content={<AgentTooltip />}
              isAnimationActive={false}
            />
            {sourceKeys.map((source, i) => (
              <Bar
                key={source}
                dataKey={source}
                stackId="1"
                fill={agentColor(source).color}
                radius={i === sourceKeys.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </DashboardResponsiveContainer>
      </div>
    </div>
  );
}
