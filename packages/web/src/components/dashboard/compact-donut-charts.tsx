"use client";

import { PieChart, Pie, Tooltip, Cell } from "recharts";
import { cn } from "@/lib/utils";
import { formatTokens } from "@/lib/utils";
import { CHART_COLORS, agentColor, modelColor } from "@/lib/palette";
import type { DeviceAggregate } from "@pew/core";
import type { SourceTrendPoint } from "@/lib/usage-helpers";
import type { ModelEra } from "@/lib/model-helpers";
import { sourceLabel } from "@/hooks/use-usage-data";
import { shortModel } from "@/lib/model-helpers";
import { DashboardResponsiveContainer } from "./dashboard-responsive-container";
import { ChartTooltip, ChartTooltipRow } from "./chart-tooltip";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DonutDataItem {
  name: string;
  value: number;
  color: string;
  percent: number;
}

interface CompactDonutChartProps {
  title: string;
  data: DonutDataItem[];
  className?: string;
}

// ---------------------------------------------------------------------------
// Custom tooltip
// ---------------------------------------------------------------------------

function DonutTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number;
    payload: { color: string; percent: number };
  }>;
}) {
  if (!active || !payload?.length) return null;
  const item = payload[0] as (typeof payload)[number];

  return (
    <ChartTooltip>
      <ChartTooltipRow
        color={item.payload.color}
        label={item.name}
        value={`${formatTokens(item.value)} (${(item.payload.percent * 100).toFixed(1)}%)`}
      />
    </ChartTooltip>
  );
}

// ---------------------------------------------------------------------------
// Base Component
// ---------------------------------------------------------------------------

function CompactDonutChart({ title, data, className }: CompactDonutChartProps) {
  if (!data.length) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-[var(--radius-card)] bg-secondary p-4 text-sm text-muted-foreground",
          className
        )}
      >
        No data yet
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] bg-secondary p-3",
        className
      )}
    >
      <p className="text-xs text-muted-foreground mb-2">{title}</p>

      <div className="flex items-center gap-3">
        {/* Donut chart */}
        <div className="w-[80px] h-[80px] shrink-0">
          <DashboardResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius="55%"
                outerRadius="90%"
                dataKey="value"
                strokeWidth={0}
                paddingAngle={2}
              >
                {data.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip content={<DonutTooltip />} isAnimationActive={false} />
            </PieChart>
          </DashboardResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="flex-1 min-w-0 space-y-1">
          {data.slice(0, 5).map((item) => (
            <div key={item.name} className="flex items-center gap-1.5">
              <div
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: item.color }}
              />
              <span className="text-xs text-muted-foreground truncate flex-1">
                {item.name}
              </span>
              <span className="text-xs tabular-nums text-foreground shrink-0">
                {(item.percent * 100).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Device Donut
// ---------------------------------------------------------------------------

interface DeviceDonutChartProps {
  devices: DeviceAggregate[];
  className?: string;
}

export function DeviceDonutChart({ devices, className }: DeviceDonutChartProps) {
  const total = devices.reduce((sum, d) => sum + d.total_tokens, 0);

  const data: DonutDataItem[] = devices.slice(0, 5).map((d, i) => ({
    name: d.alias || d.device_id.slice(0, 8),
    value: d.total_tokens,
    color: CHART_COLORS[i % CHART_COLORS.length] as string,
    percent: total > 0 ? d.total_tokens / total : 0,
  }));

  return <CompactDonutChart title="By Device" data={data} className={className ?? ""} />;
}

// ---------------------------------------------------------------------------
// Agent Donut
// ---------------------------------------------------------------------------

interface AgentDonutChartProps {
  sourceTrend: SourceTrendPoint[];
  className?: string;
}

export function AgentDonutChart({ sourceTrend, className }: AgentDonutChartProps) {
  // Aggregate sources from trend data
  const totals = new Map<string, number>();
  for (const pt of sourceTrend) {
    for (const [src, val] of Object.entries(pt.sources)) {
      totals.set(src, (totals.get(src) ?? 0) + val);
    }
  }

  const sorted = Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const total = sorted.reduce((sum, [, val]) => sum + val, 0);

  const data: DonutDataItem[] = sorted.map(([src, val]) => ({
    name: sourceLabel(src),
    value: val,
    color: agentColor(src).color,
    percent: total > 0 ? val / total : 0,
  }));

  return <CompactDonutChart title="By Agent" data={data} className={className ?? ""} />;
}

// ---------------------------------------------------------------------------
// Model Donut
// ---------------------------------------------------------------------------

interface ModelDonutChartProps {
  modelEvolution: ModelEra[];
  className?: string;
}

export function ModelDonutChart({ modelEvolution, className }: ModelDonutChartProps) {
  // Aggregate models from evolution data
  const totals = new Map<string, number>();
  for (const pt of modelEvolution) {
    for (const [model, val] of Object.entries(pt.models)) {
      totals.set(model, (totals.get(model) ?? 0) + val);
    }
  }

  const sorted = Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const total = sorted.reduce((sum, [, val]) => sum + val, 0);

  const data: DonutDataItem[] = sorted.map(([model, val]) => ({
    name: shortModel(model),
    value: val,
    color: modelColor(model).color,
    percent: total > 0 ? val / total : 0,
  }));

  return <CompactDonutChart title="By Model" data={data} className={className ?? ""} />;
}
