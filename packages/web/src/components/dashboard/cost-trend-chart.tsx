"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { cn } from "@/lib/utils";
import { formatCost } from "@/lib/pricing";
import { chart, chartAxis, CHART_COLORS, chartMuted } from "@/lib/palette";
import type { DailyCostPoint } from "@/lib/cost-helpers";
import { DashboardResponsiveContainer } from "./dashboard-responsive-container";

// Stable color references
const colorOutput = CHART_COLORS[1] as string;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CostTrendChartProps {
  data: DailyCostPoint[];
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format date string "2026-03-07" to "Mar 7" */
function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Format Y-axis cost: $0, $0.50, $1.20, $1.2K */
function fmtAxisCost(value: number): string {
  if (value === 0) return "$0";
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
  if (value < 1) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(1)}`;
}

// ---------------------------------------------------------------------------
// Custom tooltip
// ---------------------------------------------------------------------------

function CostTooltip({
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
    inputCost: "Input",
    outputCost: "Output",
    cachedCost: "Cached",
  };

  const total = payload.reduce((sum, e) => sum + e.value, 0);
  const orderedKeys = ["inputCost", "outputCost", "cachedCost"] as const;

  return (
    <div className="rounded-[var(--radius-widget)] bg-secondary p-2.5">
      <p className="mb-1 text-xs font-medium text-foreground">
        {label ? fmtDate(label) : ""}
      </p>
      <div className="mb-1 border-b border-border/50 pb-1 flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Total</span>
        <span className="ml-auto font-medium text-foreground">
          {formatCost(total)}
        </span>
      </div>
      {orderedKeys.map((key) => {
        const entry = payload.find((e) => e.dataKey === key);
        if (!entry) return null;
        return (
          <div key={entry.dataKey} className="flex items-center gap-2 text-xs">
            <div
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-muted-foreground">
              {labels[entry.dataKey] ?? entry.dataKey}
            </span>
            <span className="ml-auto font-medium text-foreground">
              {formatCost(entry.value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Stacked area chart showing estimated daily cost breakdown:
 * input cost (teal), output cost (sky), cached cost (muted).
 */
export function CostTrendChart({ data, className }: CostTrendChartProps) {
  if (!data.length) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-[var(--radius-card)] bg-secondary p-8 text-sm text-muted-foreground",
          className
        )}
      >
        No cost data yet
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] bg-secondary p-4 md:p-5",
        className
      )}
    >
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-xs md:text-sm text-muted-foreground">
            Daily Cost
          </p>
        </div>
        <div className="flex items-center gap-4">
          {[
            { key: "inputCost", label: "Input", color: chart.teal },
            { key: "outputCost", label: "Output", color: colorOutput },
            { key: "cachedCost", label: "Cached", color: chartMuted },
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

      <div className="h-[240px] md:h-[280px]">
        <DashboardResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id="gradCostInput" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={chart.teal} stopOpacity={0.3} />
                <stop offset="100%" stopColor={chart.teal} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradCostOutput" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colorOutput} stopOpacity={0.3} />
                <stop offset="100%" stopColor={colorOutput} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradCostCached" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={chartMuted} stopOpacity={0.3} />
                <stop offset="100%" stopColor={chartMuted} stopOpacity={0} />
              </linearGradient>
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
              tickFormatter={fmtAxisCost}
              tick={{ fill: chartAxis, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={52}
            />
            <Tooltip content={<CostTooltip />} isAnimationActive={false} />
            <Area
              type="monotone"
              dataKey="inputCost"
              stackId="1"
              stroke={chart.teal}
              strokeWidth={2}
              fill="url(#gradCostInput)"
            />
            <Area
              type="monotone"
              dataKey="outputCost"
              stackId="1"
              stroke={colorOutput}
              strokeWidth={2}
              fill="url(#gradCostOutput)"
            />
            <Area
              type="monotone"
              dataKey="cachedCost"
              stackId="1"
              stroke={chartMuted}
              strokeWidth={2}
              fill="url(#gradCostCached)"
            />
          </AreaChart>
        </DashboardResponsiveContainer>
      </div>
    </div>
  );
}
