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
import { chart, chartAxis, CHART_COLORS } from "@/lib/palette";
import { sourceLabel } from "@/hooks/use-usage-data";
import type { DeviceAgentBreakdownRow } from "@/lib/device-helpers";
import { DashboardResponsiveContainer } from "./dashboard-responsive-container";
import {
  ChartTooltip,
  ChartTooltipRow,
  ChartTooltipSummary,
} from "./chart-tooltip";

// Safe color references
const colorOutput = CHART_COLORS[1] as string;
const colorCached = CHART_COLORS[2] as string;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DeviceAgentChartProps {
  data: DeviceAgentBreakdownRow[];
  className?: string;
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
    payload?: { total_tokens: number };
  }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  const labels: Record<string, string> = {
    input_tokens: "Input",
    output_tokens: "Output",
    cached_input_tokens: "Cached",
  };

  const rowData = payload[0]?.payload;
  const total = rowData?.total_tokens ?? 0;
  const orderedKeys = ["input_tokens", "output_tokens", "cached_input_tokens"] as const;

  return (
    <ChartTooltip title={label}>
      {orderedKeys.map((key) => {
        const entry = payload.find((e) => e.dataKey === key);
        if (!entry) return null;
        return (
          <ChartTooltipRow
            key={entry.dataKey}
            color={entry.color}
            label={labels[entry.dataKey] ?? entry.dataKey}
            value={formatTokens(entry.value)}
          />
        );
      })}
      <ChartTooltipSummary label="Total" value={formatTokens(total)} />
    </ChartTooltip>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Horizontal stacked bar chart showing token breakdown by agent (source)
 * for a single device. Stacked segments: input / output / cached.
 */
export function DeviceAgentChart({
  data,
  className,
}: DeviceAgentChartProps) {
  if (!data.length) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-card bg-secondary p-8 text-sm text-muted-foreground",
          className,
        )}
      >
        No agent data for this device
      </div>
    );
  }

  const chartItems = data.map((d) => ({
    ...d,
    name: sourceLabel(d.source),
  }));

  // Reverse for horizontal bar (top item at top)
  const chartData = [...chartItems].reverse();

  const barHeight = 32;
  const chartHeight = Math.max(chartData.length * barHeight + 40, 160);

  return (
    <div
      className={cn(
        "rounded-card bg-secondary p-4 md:p-5",
        className,
      )}
    >
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs md:text-sm text-muted-foreground">By Agent</p>
        <div className="flex items-center gap-4">
          {[
            { key: "input", label: "Input", color: chart.violet },
            { key: "output", label: "Output", color: colorOutput },
            { key: "cached", label: "Cached", color: colorCached },
          ].map(({ key, label, color }) => (
            <div key={key} className="flex items-center gap-1.5">
              <div
                className="h-2 w-2 rounded-full"
                style={{ background: color }}
              />
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ height: chartHeight }}>
        <DashboardResponsiveContainer width="100%" height="100%">
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
              tickFormatter={formatTokens}
              tick={{ fill: chartAxis, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fill: chartAxis, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={140}
            />
            <Tooltip content={<AgentTooltip />} isAnimationActive={false} />
            <Bar
              dataKey="input_tokens"
              stackId="1"
              fill={chart.violet}
              radius={[0, 0, 0, 0]}
            />
            <Bar
              dataKey="output_tokens"
              stackId="1"
              fill={colorOutput}
              radius={[0, 0, 0, 0]}
            />
            <Bar
              dataKey="cached_input_tokens"
              stackId="1"
              fill={colorCached}
              radius={[0, 4, 4, 0]}
            />
          </BarChart>
        </DashboardResponsiveContainer>
      </div>
    </div>
  );
}
