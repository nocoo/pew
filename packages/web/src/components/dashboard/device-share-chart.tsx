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
import { cn } from "@/lib/utils";
import { chartAxis, CHART_COLORS } from "@/lib/palette";
import {
  toDeviceSharePoints,
  buildDeviceLabelMap,
} from "@/lib/device-helpers";
import type { DeviceAggregate, DeviceTimelinePoint } from "@pew/core";
import { DashboardResponsiveContainer } from "./dashboard-responsive-container";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DeviceShareChartProps {
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

function fmtPct(value: number): string {
  return `${Math.round(value)}%`;
}

// ---------------------------------------------------------------------------
// Custom tooltip
// ---------------------------------------------------------------------------

function ShareTooltip({
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

  const items = [...payload].reverse();

  return (
    <div className="rounded-[var(--radius-widget)] border border-border bg-card p-2.5 shadow-sm">
      <p className="mb-1.5 text-xs font-medium text-foreground">
        {label ? fmtDate(label) : ""}
      </p>
      {items.map((entry) => (
        <div key={entry.dataKey} className="flex items-center gap-2 text-xs">
          <div
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-muted-foreground">
            {labelMap.get(entry.dataKey) ?? entry.dataKey}
          </span>
          <span className="ml-auto font-medium text-foreground">
            {entry.value.toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * 100% stacked AreaChart showing each device's share of total usage over time.
 * Useful for spotting when a user shifts between devices.
 */
export function DeviceShareChart({
  timeline,
  devices,
  className,
}: DeviceShareChartProps) {
  const chartData = useMemo(() => toDeviceSharePoints(timeline), [timeline]);

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

  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] bg-secondary p-4 md:p-5",
        className
      )}
    >
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs md:text-sm text-muted-foreground">
          Device Share
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {deviceKeys.map((deviceId, i) => (
            <div key={deviceId} className="flex items-center gap-1.5">
              <div
                className="h-2 w-2 rounded-full"
                style={{
                  background: CHART_COLORS[i % CHART_COLORS.length] as string,
                }}
              />
              <span className="text-xs text-muted-foreground">
                {labelMap.get(deviceId) ?? deviceId}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="h-[240px] md:h-[280px]">
        <DashboardResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
            stackOffset="none"
          >
            <defs>
              {deviceKeys.map((deviceId, i) => (
                <linearGradient
                  key={deviceId}
                  id={`gradDevice${i}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="0%"
                    stopColor={CHART_COLORS[i % CHART_COLORS.length] as string}
                    stopOpacity={0.6}
                  />
                  <stop
                    offset="100%"
                    stopColor={CHART_COLORS[i % CHART_COLORS.length] as string}
                    stopOpacity={0.2}
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
              tickFormatter={fmtPct}
              tick={{ fill: chartAxis, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={44}
              domain={[0, 100]}
            />
            <Tooltip content={<ShareTooltip labelMap={labelMap} />} isAnimationActive={false} />
            {deviceKeys.map((deviceId, i) => (
              <Area
                key={deviceId}
                type="monotone"
                dataKey={deviceId}
                stackId="1"
                stroke={CHART_COLORS[i % CHART_COLORS.length] as string}
                strokeWidth={1.5}
                fill={`url(#gradDevice${i})`}
              />
            ))}
          </AreaChart>
        </DashboardResponsiveContainer>
      </div>
    </div>
  );
}
