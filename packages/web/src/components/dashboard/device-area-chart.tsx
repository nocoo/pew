"use client";

import { useMemo } from "react";
import {
  AreaChart,
  Area,
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

interface DeviceAreaChartProps {
  timeline: DeviceTimelinePoint[];
  devices: DeviceAggregate[];
  /** Optional: pad data to include all dates up to this date (YYYY-MM-DD) */
  padToDate?: string;
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

/** Stable gradient ID from device ID (CSS-safe). */
function gradId(deviceId: string): string {
  let h = 0;
  for (let i = 0; i < deviceId.length; i++) h = ((h << 5) - h + deviceId.charCodeAt(i)) | 0;
  return `gradDevice${Math.abs(h)}`;
}

// ---------------------------------------------------------------------------
// Custom tooltip
// ---------------------------------------------------------------------------

function DeviceAreaTooltip({
  active,
  payload,
  label,
  labelMap,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; color: string }>;
  label?: string;
  labelMap: Map<string, string>;
}) {
  if (!active || !payload?.length) return null;

  const sorted = [...payload].sort((a, b) => b.value - a.value);
  const total = sorted.reduce((sum, e) => sum + e.value, 0);

  return (
    <ChartTooltip title={label ? fmtDate(label) : undefined}>
      {sorted.map((entry) => (
        <ChartTooltipRow
          key={entry.dataKey}
          color={entry.color}
          label={labelMap.get(entry.dataKey) ?? entry.dataKey.slice(0, 8)}
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
 * Stacked area chart showing daily token usage by device.
 * Used in Daily Usage page for monthly view.
 */
export function DeviceAreaChart({
  timeline,
  devices,
  padToDate,
  className,
}: DeviceAreaChartProps) {
  const rawData = useMemo(() => toDeviceTrendPoints(timeline), [timeline]);
  const labelMap = useMemo(() => buildDeviceLabelMap(devices), [devices]);

  const deviceKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const pt of rawData) {
      for (const key of Object.keys(pt)) {
        if (key !== "date") keys.add(key);
      }
    }
    return Array.from(keys);
  }, [rawData]);

  // Pad data to end of month if padToDate is provided
  const chartData = useMemo(() => {
    if (!padToDate || !rawData.length) return rawData;

    const byDate = new Map(rawData.map((d) => [d.date, d]));
    const result: typeof rawData = [];

    // Parse first and last dates
    const firstDate = rawData[0]?.date;
    if (!firstDate) return rawData;

    const startDate = new Date(firstDate + "T00:00:00Z");
    const endDate = new Date(padToDate + "T00:00:00Z");

    const cursor = new Date(startDate);
    while (cursor <= endDate) {
      const dateStr = cursor.toISOString().slice(0, 10);
      const existing = byDate.get(dateStr);
      if (existing) {
        result.push(existing);
      } else {
        // Zero-fill for missing dates
        const emptyPoint: Record<string, string | number> = { date: dateStr };
        for (const key of deviceKeys) {
          emptyPoint[key] = 0;
        }
        result.push(emptyPoint as typeof rawData[number]);
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return result;
  }, [rawData, padToDate, deviceKeys]);

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

  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] bg-secondary p-4 md:p-5",
        className
      )}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs md:text-sm text-muted-foreground">By Device</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {deviceKeys.slice(0, 6).map((deviceId, i) => (
            <div key={deviceId} className="flex items-center gap-1.5">
              <div
                className="h-2 w-2 rounded-full"
                style={{
                  background: CHART_COLORS[i % CHART_COLORS.length],
                }}
              />
              <span className="text-xs text-muted-foreground truncate max-w-[80px]">
                {labelMap.get(deviceId) ?? deviceId.slice(0, 8)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="h-[200px]">
        <DashboardResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
          >
            <defs>
              {deviceKeys.map((deviceId, i) => (
                <linearGradient
                  key={deviceId}
                  id={gradId(deviceId)}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="0%"
                    stopColor={CHART_COLORS[i % CHART_COLORS.length]}
                    stopOpacity={0.4}
                  />
                  <stop
                    offset="100%"
                    stopColor={CHART_COLORS[i % CHART_COLORS.length]}
                    stopOpacity={0.1}
                  />
                </linearGradient>
              ))}
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
              tickFormatter={formatTokens}
              tick={{ fill: chartAxis, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={48}
            />
            <Tooltip
              content={<DeviceAreaTooltip labelMap={labelMap} />}
              isAnimationActive={false}
            />
            {deviceKeys.map((deviceId, i) => (
              <Area
                key={deviceId}
                type="monotone"
                dataKey={deviceId}
                stackId="1"
                stroke={CHART_COLORS[i % CHART_COLORS.length] as string}
                strokeWidth={1.5}
                fill={`url(#${gradId(deviceId)})`}
              />
            ))}
          </AreaChart>
        </DashboardResponsiveContainer>
      </div>
    </div>
  );
}
