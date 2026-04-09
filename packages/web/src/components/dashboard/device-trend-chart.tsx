"use client";

import { useState, useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { cn, formatTokens } from "@/lib/utils";
import { chartAxis, CHART_COLORS } from "@/lib/palette";
import {
  toDeviceTrendPoints,
  buildDeviceLabelMap,
} from "@/lib/device-helpers";
import type { DeviceAggregate, DeviceTimelinePoint } from "@pew/core";
import { DashboardResponsiveContainer } from "./dashboard-responsive-container";
import {
  ChartTooltip,
  ChartTooltipRow,
  ChartTooltipSummary,
} from "./chart-tooltip";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DeviceTrendChartProps {
  timeline: DeviceTimelinePoint[];
  devices: DeviceAggregate[];
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

function fmtAxisTokens(value: number): string {
  if (value === 0) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return String(value);
}

// ---------------------------------------------------------------------------
// Custom tooltip
// ---------------------------------------------------------------------------

function DeviceTrendTooltip({
  active,
  payload,
  label,
  hiddenDevices,
  labelMap,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; color: string }>;
  label?: string;
  hiddenDevices: Set<string>;
  labelMap: Map<string, string>;
}) {
  if (!active || !payload?.length) return null;

  const visible = payload.filter((e) => !hiddenDevices.has(e.dataKey));
  if (!visible.length) return null;

  const total = visible.reduce((sum, e) => sum + e.value, 0);

  return (
    <ChartTooltip title={label ? fmtDate(label) : undefined}>
      {visible.map((entry) => (
        <ChartTooltipRow
          key={entry.dataKey}
          color={entry.color}
          label={labelMap.get(entry.dataKey) ?? entry.dataKey}
          value={formatTokens(entry.value)}
        />
      ))}
      {visible.length > 1 && (
        <ChartTooltipSummary label="Total" value={formatTokens(total)} />
      )}
    </ChartTooltip>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Multi-line LineChart showing token usage per device over time.
 * Each device gets a distinct colored line. Click legend to toggle visibility.
 */
export function DeviceTrendChart({
  timeline,
  devices,
  className,
}: DeviceTrendChartProps) {
  const [hiddenDevices, setHiddenDevices] = useState<Set<string>>(new Set());

  const chartData = useMemo(() => toDeviceTrendPoints(timeline), [timeline]);

  const labelMap = useMemo(() => buildDeviceLabelMap(devices), [devices]);

  const deviceKeys = useMemo(() => {
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
          className
        )}
      >
        No device data yet
      </div>
    );
  }

  function toggleDevice(deviceId: string) {
    setHiddenDevices((prev) => {
      const next = new Set(prev);
      if (next.has(deviceId)) {
        next.delete(deviceId);
      } else {
        next.add(deviceId);
      }
      return next;
    });
  }

  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] bg-secondary p-4 md:p-5",
        className
      )}
    >
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs md:text-sm text-muted-foreground">
          Device Trend
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {deviceKeys.map((deviceId, i) => {
            const isHidden = hiddenDevices.has(deviceId);
            return (
              <button
                key={deviceId}
                type="button"
                onClick={() => toggleDevice(deviceId)}
                className={cn(
                  "flex items-center gap-1.5 transition-opacity",
                  isHidden && "opacity-40"
                )}
              >
                <div
                  className="h-2 w-2 rounded-full"
                  style={{
                    background: CHART_COLORS[i % CHART_COLORS.length],
                  }}
                />
                <span className="text-xs text-muted-foreground">
                  {labelMap.get(deviceId) ?? deviceId}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="h-[240px] md:h-[280px]">
        <DashboardResponsiveContainer width="100%" height="100%">
          <LineChart
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
              dataKey="date"
              tickFormatter={fmtDate}
              tick={{ fill: chartAxis, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={fmtAxisTokens}
              tick={{ fill: chartAxis, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={52}
            />
            <Tooltip
              content={
                <DeviceTrendTooltip
                  hiddenDevices={hiddenDevices}
                  labelMap={labelMap}
                />
              }
              isAnimationActive={false}
            />
            {deviceKeys.map((deviceId, i) => (
              <Line
                key={deviceId}
                type="monotone"
                dataKey={deviceId}
                stroke={CHART_COLORS[i % CHART_COLORS.length] as string}
                strokeWidth={2}
                dot={false}
                hide={hiddenDevices.has(deviceId)}
              />
            ))}
          </LineChart>
        </DashboardResponsiveContainer>
      </div>
    </div>
  );
}
