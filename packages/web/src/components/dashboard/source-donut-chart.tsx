"use client";

import {
  PieChart,
  Pie,
  Tooltip,
  Cell,
} from "recharts";
import { cn } from "@/lib/utils";
import { formatTokens } from "@/lib/utils";
import { agentColor } from "@/lib/palette";
import type { SourceAggregate } from "@/hooks/use-usage-data";
import { DashboardResponsiveContainer } from "./dashboard-responsive-container";
import { ChartTooltip, ChartTooltipRow } from "./chart-tooltip";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SourceDonutChartProps {
  data: SourceAggregate[];
  className?: string;
}

// ---------------------------------------------------------------------------
// Custom tooltip
// ---------------------------------------------------------------------------

function SourceDonutTooltip({
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
  const item = payload[0] as (typeof payload)[number];

  return (
    <ChartTooltip>
      <ChartTooltipRow
        color={item.payload.fill}
        label={item.name}
        value={`${formatTokens(item.value)} (${(item.payload.percent * 100).toFixed(1)}%)`}
      />
    </ChartTooltip>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Donut chart showing token usage breakdown by source tool.
 */
export function SourceDonutChart({ data, className }: SourceDonutChartProps) {
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

  const total = data.reduce((sum, d) => sum + d.value, 0);
  const chartData = data.map((d) => ({
    name: d.label,
    value: d.value,
    fill: agentColor(d.source).color,
    percent: total > 0 ? d.value / total : 0,
  }));

  return (
    <div
      className={cn(
        "flex flex-col rounded-[var(--radius-card)] bg-secondary p-4 md:p-5",
        className
      )}
    >
      <p className="mb-3 text-xs md:text-sm text-muted-foreground">By Agent</p>

      <div className="flex flex-1 flex-col items-center">
        <div className="flex-1 w-full max-w-[220px] min-h-[140px]">
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
                {chartData.map((entry) => (
                  <Cell key={entry.name} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip content={<SourceDonutTooltip />} isAnimationActive={false} />
            </PieChart>
          </DashboardResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="mt-3 grid w-full grid-cols-2 gap-x-4 gap-y-2">
          {chartData.map((item) => (
            <div key={item.name} className="flex items-center gap-2">
              <div
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: item.fill }}
              />
              <span className="text-xs text-muted-foreground truncate">
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
