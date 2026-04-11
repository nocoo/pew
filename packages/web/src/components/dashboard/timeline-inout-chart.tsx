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
import { DashboardResponsiveContainer } from "./dashboard-responsive-container";
import {
  ChartTooltip,
  ChartTooltipRow,
  ChartTooltipSummary,
} from "./chart-tooltip";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HalfHourPoint {
  /** Half-hour slot label, e.g. "Mar 12 09:00" */
  slot: string;
  /** Raw hour_start for sorting */
  hourStart: string;
  input: number;
  output: number;
  total: number;
}

interface TimelineInOutChartProps {
  data: HalfHourPoint[];
  className?: string;
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const colorInput = chart.violet;
const colorOutput = CHART_COLORS[1] as string;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format slot label for X axis: show time only, include date at midnight */
function fmtSlot(slot: string): string {
  const parts = slot.split(" ");
  const time = parts[2] ?? slot;
  if (time === "00:00") return `${parts[0]} ${parts[1]}`;
  return time;
}

/** Format slot for tooltip: full "Mar 12, 09:00-09:30" */
function fmtSlotFull(slot: string): string {
  const parts = slot.split(" ");
  if (parts.length >= 3) {
    return `${parts[0]} ${parts[1]}, ${parts[2]}`;
  }
  return slot;
}

// ---------------------------------------------------------------------------
// Custom tooltip
// ---------------------------------------------------------------------------

function InOutTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  const labels: Record<string, string> = {
    input: "Input",
    output: "Output",
  };

  const total = payload.reduce((sum, e) => sum + e.value, 0);
  const orderedKeys = ["input", "output"] as const;

  return (
    <ChartTooltip title={label ? fmtSlotFull(label) : undefined}>
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
 * Timeline bar chart showing input/output tokens over 72 hours.
 */
export function TimelineInOutChart({
  data,
  className,
}: TimelineInOutChartProps) {
  if (!data.length) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-[var(--radius-card)] bg-secondary p-8 text-sm text-muted-foreground",
          className
        )}
      >
        No usage data yet
      </div>
    );
  }

  const tickInterval = Math.max(1, Math.floor(data.length / 12));

  const legendItems = [
    { key: "input", label: "Input", color: colorInput },
    { key: "output", label: "Output", color: colorOutput },
  ];

  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] bg-secondary p-4 md:p-5",
        className
      )}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs md:text-sm text-muted-foreground">
          Input / Output
        </p>
        <div className="flex flex-wrap items-center gap-4">
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
      </div>

      <div className="h-[200px]">
        <DashboardResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={chartAxis}
              strokeOpacity={0.15}
              vertical={false}
            />
            <XAxis
              dataKey="slot"
              tickFormatter={fmtSlot}
              tick={{ fill: chartAxis, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              interval={tickInterval}
              angle={-45}
              textAnchor="end"
              height={50}
            />
            <YAxis
              tickFormatter={formatTokens}
              tick={{ fill: chartAxis, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={48}
            />
            <Tooltip content={<InOutTooltip />} isAnimationActive={false} />
            <Bar
              dataKey="input"
              stackId="1"
              fill={colorInput}
              radius={[0, 0, 0, 0]}
              isAnimationActive={false}
            />
            <Bar
              dataKey="output"
              stackId="1"
              fill={colorOutput}
              radius={[2, 2, 0, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </DashboardResponsiveContainer>
      </div>
    </div>
  );
}
