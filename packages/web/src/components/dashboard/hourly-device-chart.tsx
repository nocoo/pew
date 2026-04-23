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
import { chartAxis, CHART_COLORS } from "@/lib/palette";
import { deviceLabel as getDeviceLabel } from "@/lib/device-helpers";
import type { HourlyByDevicePoint } from "@/lib/usage-helpers";
import { DashboardResponsiveContainer } from "./dashboard-responsive-container";
import {
  ChartTooltip,
  ChartTooltipRow,
  ChartTooltipSummary,
} from "./chart-tooltip";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HourlyDeviceChartProps {
  data: HourlyByDevicePoint[];
  /** Device details for label lookup */
  deviceDetails: Array<{ device_id: string; alias: string | null }>;
  className?: string;
  /** Compact mode for sidebar layout: smaller height, no legend */
  compact?: boolean;
}

// ---------------------------------------------------------------------------
// Custom tooltip
// ---------------------------------------------------------------------------

function DeviceTooltip({
  active,
  payload,
  label,
  deviceLabels,
}: {
  active?: boolean;
  payload?: Array<{
    dataKey: string;
    value: number;
    color: string;
  }>;
  label?: string;
  deviceLabels: Map<string, string>;
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
          label={deviceLabels.get(entry.dataKey) ?? entry.dataKey}
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
 * Stacked bar chart showing average hourly token usage by device.
 * X-axis is hours 0-23, Y-axis is tokens, bars are stacked by device.
 */
export function HourlyDeviceChart({
  data,
  deviceDetails,
  className,
  compact = false,
}: HourlyDeviceChartProps) {
  if (!data.length || data.every((d) => Object.keys(d.devices).length === 0)) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-card bg-secondary p-8 text-sm text-muted-foreground",
          className,
        )}
      >
        No device data available
      </div>
    );
  }

  // Build device label map
  const deviceLabels = new Map<string, string>();
  for (const d of deviceDetails) {
    deviceLabels.set(d.device_id, getDeviceLabel(d));
  }

  // Get all device keys from the first data point (all points have same keys)
  const deviceKeys = Object.keys(data[0]?.devices ?? {});

  // Transform data for Recharts: { hour, device1: value, device2: value, ... }
  const chartData = data.map((d) => ({
    hour: d.hour,
    ...d.devices,
  }));

  // Build legend entries
  const legendItems = deviceKeys.map((deviceId, i) => ({
    key: deviceId,
    label: deviceLabels.get(deviceId) ?? deviceId,
    color: CHART_COLORS[i % CHART_COLORS.length] as string,
  }));

  return (
    <div
      className={cn(
        "rounded-card bg-secondary p-4 md:p-5",
        className,
      )}
    >
      <div className={cn("flex flex-wrap items-center justify-between gap-2", compact ? "mb-2" : "mb-4")}>
        <p className="text-xs md:text-sm text-muted-foreground">
          {compact ? "By Device" : "Hourly By Device"}
        </p>
        {!compact && (
          <div className="flex flex-wrap items-center gap-3">
            {legendItems.slice(0, 6).map(({ key, label, color }) => (
              <div key={key} className="flex items-center gap-1.5">
                <div
                  className="h-2 w-2 rounded-full"
                  style={{ background: color }}
                />
                <span className="text-xs text-muted-foreground truncate max-w-[100px]">
                  {label}
                </span>
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
              content={<DeviceTooltip deviceLabels={deviceLabels} />}
              isAnimationActive={false}
            />
            {deviceKeys.map((deviceId, i) => (
              <Bar
                key={deviceId}
                dataKey={deviceId}
                stackId="1"
                fill={CHART_COLORS[i % CHART_COLORS.length] as string}
                radius={i === deviceKeys.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </DashboardResponsiveContainer>
      </div>
    </div>
  );
}
