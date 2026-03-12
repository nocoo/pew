"use client";

import { useMemo, useState } from "react";
import { useDeviceData } from "@/hooks/use-device-data";
import { formatTokens } from "@/lib/utils";
import { formatCost } from "@/hooks/use-pricing";
import { sourceLabel } from "@/hooks/use-usage-data";
import { deviceLabel, shortDeviceId } from "@/lib/device-helpers";
import { Skeleton } from "@/components/ui/skeleton";
import { CHART_COLORS } from "@/lib/palette";
import { DeviceTrendChart } from "@/components/dashboard/device-trend-chart";
import { DeviceShareChart } from "@/components/dashboard/device-share-chart";
import { DeviceBreakdownChart } from "@/components/dashboard/device-breakdown-chart";
import { PeriodSelector } from "@/components/dashboard/period-selector";
import { periodToDateRange, periodLabel } from "@/lib/date-helpers";
import type { Period } from "@/lib/date-helpers";
import type { DeviceAggregate } from "@pew/core";

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function DevicesSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-xl bg-secondary p-4">
          <div className="flex items-center gap-4">
            <Skeleton className="h-4 w-4 rounded-full" />
            <div className="flex-1">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-24 mt-1" />
            </div>
            <Skeleton className="h-4 w-16" />
          </div>
          <Skeleton className="h-2 w-full mt-3 rounded-full" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat Grid
// ---------------------------------------------------------------------------

function StatGrid({ devices }: { devices: DeviceAggregate[] }) {
  const deviceCount = devices.length;
  const mostActive = devices.length > 0 ? devices[0]! : null;
  const recentDays = 7;
  const recentCutoff = new Date();
  recentCutoff.setDate(recentCutoff.getDate() - recentDays);
  const recentCutoffStr = recentCutoff.toISOString().slice(0, 10);
  const recentlyActive = devices.filter(
    (d) => d.last_seen >= recentCutoffStr
  ).length;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div className="rounded-[var(--radius-card)] bg-secondary p-4">
        <p className="text-xs text-muted-foreground">Devices</p>
        <p className="mt-1 text-2xl font-bold tabular-nums">{deviceCount}</p>
      </div>
      <div className="rounded-[var(--radius-card)] bg-secondary p-4">
        <p className="text-xs text-muted-foreground">Most Active</p>
        <p className="mt-1 text-lg font-bold truncate">
          {mostActive ? deviceLabel(mostActive) : "—"}
        </p>
      </div>
      <div className="rounded-[var(--radius-card)] bg-secondary p-4">
        <p className="text-xs text-muted-foreground">Active (7d)</p>
        <p className="mt-1 text-2xl font-bold tabular-nums">
          {recentlyActive}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ByDevicePage() {
  const [period, setPeriod] = useState<Period>("all");
  const { from, to } = periodToDateRange(period);

  const { data, loading, error } = useDeviceData({
    from,
    ...(to ? { to } : {}),
  });

  const devices = useMemo(() => data?.devices ?? [], [data]);
  const timeline = useMemo(() => data?.timeline ?? [], [data]);

  const grandTotal = useMemo(
    () => devices.reduce((sum, d) => sum + d.total_tokens, 0),
    [devices],
  );

  const subtitle = periodLabel(period);

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display">By Device</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Compare usage across your devices ({subtitle}).
          </p>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-[var(--radius-card)] bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load device data: {error}
        </div>
      )}

      {/* Loading */}
      {loading && <DevicesSkeleton />}

      {/* Content */}
      {!loading && data && (
        <>
          {devices.length === 0 ? (
            <div className="rounded-[var(--radius-card)] bg-secondary p-8 text-center text-sm text-muted-foreground">
              No device data yet. Sync from multiple devices to compare usage.
            </div>
          ) : (
            <>
              {/* Stat grid */}
              <StatGrid devices={devices} />

              {/* Charts row */}
              <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
                <DeviceTrendChart timeline={timeline} devices={devices} />
                <DeviceShareChart timeline={timeline} devices={devices} />
              </div>

              {/* Breakdown chart */}
              <DeviceBreakdownChart devices={devices} />

              {/* Summary table */}
              <div className="rounded-xl bg-secondary p-1 overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                        Device
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground hidden lg:table-cell">
                        Tools
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground hidden xl:table-cell">
                        Models
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">
                        Input
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">
                        Output
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground hidden md:table-cell">
                        Cached
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">
                        Total
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground hidden sm:table-cell">
                        Est. Cost
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground w-32 hidden md:table-cell">
                        Share
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {devices.map((device, i) => {
                      const pct =
                        grandTotal > 0
                          ? (device.total_tokens / grandTotal) * 100
                          : 0;
                      return (
                        <tr
                          key={device.device_id}
                          className="border-b border-border/50 last:border-0 hover:bg-accent/50 transition-colors"
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <div
                                className="h-2.5 w-2.5 rounded-full shrink-0"
                                style={{
                                  backgroundColor:
                                    CHART_COLORS[i % CHART_COLORS.length],
                                }}
                              />
                              <div>
                                <span className="text-sm font-medium text-foreground">
                                  {deviceLabel(device)}
                                </span>
                                {device.device_id !== "default" && (
                                  <span className="ml-2 text-[10px] font-mono text-muted-foreground/60">
                                    {shortDeviceId(device.device_id)}
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 hidden lg:table-cell">
                            <div className="flex gap-1.5">
                              {device.sources.map((s) => (
                                <span
                                  key={s}
                                  className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                                >
                                  {sourceLabel(s)}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-4 py-3 hidden xl:table-cell">
                            <span className="text-xs text-muted-foreground truncate block max-w-[200px]">
                              {device.models.length > 0
                                ? device.models.join(", ")
                                : "—"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-right tabular-nums">
                            {formatTokens(device.input_tokens)}
                          </td>
                          <td className="px-4 py-3 text-sm text-right tabular-nums">
                            {formatTokens(device.output_tokens)}
                          </td>
                          <td className="px-4 py-3 text-sm text-right tabular-nums hidden md:table-cell">
                            {formatTokens(device.cached_input_tokens)}
                          </td>
                          <td className="px-4 py-3 text-sm text-right tabular-nums font-medium">
                            {formatTokens(device.total_tokens)}
                          </td>
                          <td className="px-4 py-3 text-sm text-right tabular-nums hidden sm:table-cell">
                            {formatCost(device.estimated_cost)}
                          </td>
                          <td className="px-4 py-3 hidden md:table-cell">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 rounded-full bg-background overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all"
                                  style={{
                                    width: `${pct}%`,
                                    backgroundColor:
                                      CHART_COLORS[i % CHART_COLORS.length],
                                  }}
                                />
                              </div>
                              <span className="text-[10px] tabular-nums text-muted-foreground w-8 text-right">
                                {pct.toFixed(0)}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border">
                      <td className="px-4 py-3 text-sm font-medium" colSpan={3}>
                        Total
                      </td>
                      <td className="px-4 py-3 text-sm text-right tabular-nums font-medium" />
                      <td className="px-4 py-3 text-sm text-right tabular-nums font-medium" />
                      <td className="px-4 py-3 text-sm text-right tabular-nums font-medium hidden md:table-cell" />
                      <td className="px-4 py-3 text-sm text-right tabular-nums font-bold">
                        {formatTokens(grandTotal)}
                      </td>
                      <td className="px-4 py-3 text-sm text-right tabular-nums font-medium hidden sm:table-cell">
                        {formatCost(
                          devices.reduce((s, d) => s + d.estimated_cost, 0),
                        )}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell" />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
