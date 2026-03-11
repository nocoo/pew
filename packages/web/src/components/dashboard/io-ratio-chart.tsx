"use client";

import {
  PieChart,
  Pie,
  Tooltip,
  Cell,
} from "recharts";
import { cn } from "@/lib/utils";
import { formatTokens } from "@/lib/utils";
import { chart } from "@/lib/palette";
import { DashboardResponsiveContainer } from "./dashboard-responsive-container";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IoRatioChartProps {
  inputTokens: number;
  outputTokens: number;
  className?: string;
}

// Stable color mapping
const SLICE_COLORS = [chart.teal, chart.sky] as const;

// ---------------------------------------------------------------------------
// Custom tooltip
// ---------------------------------------------------------------------------

function IoTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number;
    payload: { fill: string; percent: number };
  }>;
}) {
  if (!active || !payload?.length) return null;
  const item = payload[0]!;

  return (
    <div className="rounded-[var(--radius-widget)] border border-border bg-card p-2.5 shadow-sm">
      <div className="flex items-center gap-2">
        <div
          className="h-3 w-3 rounded-full"
          style={{ backgroundColor: item.payload.fill }}
        />
        <span className="text-sm font-medium text-foreground">{item.name}</span>
      </div>
      <div className="text-sm text-muted-foreground">
        {formatTokens(item.value)} ({(item.payload.percent * 100).toFixed(1)}%)
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Donut chart showing input vs output token split with an inner label
 * displaying the I/O ratio (e.g. "3.2:1").
 */
export function IoRatioChart({
  inputTokens,
  outputTokens,
  className,
}: IoRatioChartProps) {
  const total = inputTokens + outputTokens;

  if (total === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-[var(--radius-card)] bg-secondary p-8 text-sm text-muted-foreground",
          className,
        )}
      >
        No token data yet
      </div>
    );
  }

  const ratio = outputTokens > 0 ? inputTokens / outputTokens : 0;
  const ratioLabel = ratio >= 100 ? `${Math.round(ratio)}:1` : `${ratio.toFixed(1)}:1`;

  const chartData = [
    {
      name: "Input",
      value: inputTokens,
      fill: SLICE_COLORS[0],
      percent: total > 0 ? inputTokens / total : 0,
    },
    {
      name: "Output",
      value: outputTokens,
      fill: SLICE_COLORS[1],
      percent: total > 0 ? outputTokens / total : 0,
    },
  ];

  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] bg-secondary p-4 md:p-5",
        className,
      )}
    >
      <p className="mb-3 text-xs md:text-sm text-muted-foreground">
        Input / Output
      </p>

      <div className="flex flex-col items-center">
        <div className="relative h-[180px] w-[180px]">
          <DashboardResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius="50%"
                outerRadius="80%"
                dataKey="value"
                strokeWidth={0}
                paddingAngle={2}
              >
                {chartData.map((entry, i) => (
                  <Cell key={entry.name} fill={SLICE_COLORS[i]!} />
                ))}
              </Pie>
              <Tooltip content={<IoTooltip />} />
            </PieChart>
          </DashboardResponsiveContainer>
          {/* Center label showing I/O ratio */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-lg font-semibold text-foreground">
              {ratioLabel}
            </span>
            <span className="text-[10px] text-muted-foreground">I/O ratio</span>
          </div>
        </div>

        {/* Legend */}
        <div className="mt-3 grid w-full grid-cols-2 gap-x-4 gap-y-2">
          {chartData.map((item) => (
            <div key={item.name} className="flex items-center gap-2">
              <div
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: item.fill }}
              />
              <span className="text-xs text-muted-foreground">
                {item.name}
              </span>
              <span className="ml-auto text-xs font-medium text-foreground">
                {formatTokens(item.value)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
