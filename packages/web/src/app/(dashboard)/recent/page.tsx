"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  useUsageData,
  sourceLabel,
} from "@/hooks/use-usage-data";
import type { UsageRow } from "@/hooks/use-usage-data";
import { RecentBarChart } from "@/components/dashboard/recent-bar-chart";
import type { HalfHourPoint } from "@/components/dashboard/recent-bar-chart";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTokens } from "@/lib/utils";
import { groupByDate } from "@/lib/usage-helpers";
import type { DailyGroup } from "@/lib/usage-helpers";
import { usePricingMap, lookupPricing, estimateCost, formatCost } from "@/hooks/use-pricing";
import type { PricingMap } from "@/hooks/use-pricing";
import { formatDate } from "@/lib/date-helpers";

// ---------------------------------------------------------------------------
// Transform UsageRow[] → HalfHourPoint[]
// ---------------------------------------------------------------------------

function toHalfHourPoints(
  records: UsageRow[],
  tzOffset: number,
): HalfHourPoint[] {
  const bySlot = new Map<
    string,
    { hourStart: string; input: number; output: number; total: number }
  >();

  for (const r of records) {
    // Shift UTC to local time
    const utcMs = new Date(r.hour_start).getTime();
    const localMs = utcMs - tzOffset * 60_000;
    const local = new Date(localMs);

    // Format slot label: "Mar 12 09:00"
    const mon = local.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
    const day = local.getUTCDate();
    const hh = String(local.getUTCHours()).padStart(2, "0");
    const mm = String(local.getUTCMinutes()).padStart(2, "0");
    const slot = `${mon} ${day} ${hh}:${mm}`;

    const existing = bySlot.get(slot);
    if (existing) {
      existing.input += r.input_tokens;
      existing.output += r.output_tokens;
      existing.total += r.total_tokens;
    } else {
      bySlot.set(slot, {
        hourStart: r.hour_start,
        input: r.input_tokens,
        output: r.output_tokens,
        total: r.total_tokens,
      });
    }
  }

  return Array.from(bySlot.entries())
    .map(([slot, data]) => ({
      slot,
      hourStart: data.hourStart,
      input: data.input,
      output: data.output,
      total: data.total,
    }))
    .sort((a, b) => a.hourStart.localeCompare(b.hourStart));
}

// ---------------------------------------------------------------------------
// Expandable day row (mirrors daily-usage pattern)
// ---------------------------------------------------------------------------

function DayRow({
  group,
  pricingMap,
}: {
  group: DailyGroup;
  pricingMap: PricingMap;
}) {
  const [expanded, setExpanded] = useState(false);

  const modelRows = useMemo(() => {
    const byKey = new Map<
      string,
      {
        source: string;
        model: string;
        input: number;
        output: number;
        cached: number;
        total: number;
        cost: number;
      }
    >();

    for (const r of group.records) {
      const key = `${r.source}:${r.model}`;
      const existing = byKey.get(key);
      const pricing = lookupPricing(pricingMap, r.model, r.source);
      const cost = estimateCost(
        r.input_tokens,
        r.output_tokens,
        r.cached_input_tokens,
        pricing,
      );

      if (existing) {
        existing.input += r.input_tokens;
        existing.output += r.output_tokens;
        existing.cached += r.cached_input_tokens;
        existing.total += r.total_tokens;
        existing.cost += cost.totalCost;
      } else {
        byKey.set(key, {
          source: r.source,
          model: r.model,
          input: r.input_tokens,
          output: r.output_tokens,
          cached: r.cached_input_tokens,
          total: r.total_tokens,
          cost: cost.totalCost,
        });
      }
    }

    return Array.from(byKey.values()).sort((a, b) => b.total - a.total);
  }, [group.records, pricingMap]);

  return (
    <>
      <tr
        className="border-b border-border/50 last:border-0 hover:bg-accent/50 transition-colors cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="px-4 py-3 text-sm">
          <div className="flex items-center gap-2">
            {expanded ? (
              <ChevronDown
                className="h-3.5 w-3.5 text-muted-foreground shrink-0"
                strokeWidth={1.5}
              />
            ) : (
              <ChevronRight
                className="h-3.5 w-3.5 text-muted-foreground shrink-0"
                strokeWidth={1.5}
              />
            )}
            <span className="font-medium">{formatDate(group.date)}</span>
          </div>
        </td>
        <td className="px-4 py-3 text-sm text-right tabular-nums">
          {formatTokens(group.inputTokens)}
        </td>
        <td className="px-4 py-3 text-sm text-right tabular-nums">
          {formatTokens(group.outputTokens)}
        </td>
        <td className="px-4 py-3 text-sm text-right tabular-nums hidden md:table-cell">
          {formatTokens(group.cachedTokens)}
        </td>
        <td className="px-4 py-3 text-sm text-right tabular-nums font-medium">
          {formatTokens(group.totalTokens)}
        </td>
        <td className="px-4 py-3 text-sm text-right tabular-nums hidden sm:table-cell">
          {formatCost(group.estimatedCost)}
        </td>
      </tr>
      {expanded &&
        modelRows.map((row) => (
          <tr
            key={`${row.source}:${row.model}`}
            className="border-b border-border/30 last:border-0 bg-accent/30"
          >
            <td className="pl-10 pr-4 py-2.5 text-xs text-muted-foreground">
              <span className="text-foreground/70">
                {sourceLabel(row.source)}
              </span>
              <span className="mx-1.5 text-border">/</span>
              <span className="font-mono text-foreground/60">{row.model}</span>
            </td>
            <td className="px-4 py-2.5 text-xs text-right tabular-nums text-muted-foreground">
              {formatTokens(row.input)}
            </td>
            <td className="px-4 py-2.5 text-xs text-right tabular-nums text-muted-foreground">
              {formatTokens(row.output)}
            </td>
            <td className="px-4 py-2.5 text-xs text-right tabular-nums text-muted-foreground hidden md:table-cell">
              {formatTokens(row.cached)}
            </td>
            <td className="px-4 py-2.5 text-xs text-right tabular-nums text-muted-foreground">
              {formatTokens(row.total)}
            </td>
            <td className="px-4 py-2.5 text-xs text-right tabular-nums text-muted-foreground hidden sm:table-cell">
              {formatCost(row.cost)}
            </td>
          </tr>
        ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function RecentSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-[280px] w-full rounded-xl" />
      <div className="rounded-xl bg-secondary p-1 overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-3 text-left">
                <Skeleton className="h-3 w-16" />
              </th>
              <th className="px-4 py-3 text-right">
                <Skeleton className="h-3 w-12 ml-auto" />
              </th>
              <th className="px-4 py-3 text-right">
                <Skeleton className="h-3 w-12 ml-auto" />
              </th>
              <th className="px-4 py-3 text-right hidden md:table-cell">
                <Skeleton className="h-3 w-12 ml-auto" />
              </th>
              <th className="px-4 py-3 text-right">
                <Skeleton className="h-3 w-12 ml-auto" />
              </th>
              <th className="px-4 py-3 text-right hidden sm:table-cell">
                <Skeleton className="h-3 w-12 ml-auto" />
              </th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 3 }).map((_, i) => (
              <tr key={i} className="border-b border-border/50">
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-28" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-14 ml-auto" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-14 ml-auto" />
                </td>
                <td className="px-4 py-3 hidden md:table-cell">
                  <Skeleton className="h-4 w-14 ml-auto" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-14 ml-auto" />
                </td>
                <td className="px-4 py-3 hidden sm:table-cell">
                  <Skeleton className="h-4 w-14 ml-auto" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function RecentPage() {
  // Recent: last 72 hours — use full ISO timestamps so the API applies
  // exact millisecond boundaries instead of bare-date expansion (+1 day
  // on `to`) which would widen the window to ~96 hours.
  const recentFrom = useMemo(() => {
    const d = new Date();
    d.setTime(d.getTime() - 72 * 60 * 60_000);
    return d.toISOString();
  }, []);
  const recentTo = useMemo(() => {
    return new Date().toISOString();
  }, []);

  const { data, loading, error } = useUsageData({
    from: recentFrom,
    to: recentTo,
    granularity: "half-hour",
  });

  const { pricingMap } = usePricingMap();

  const tzOffset = useMemo(() => new Date().getTimezoneOffset(), []);

  const halfHourPoints = useMemo(() => {
    return data ? toHalfHourPoints(data.records, tzOffset) : [];
  }, [data, tzOffset]);

  const dailyGroups = useMemo(
    () => (data ? groupByDate(data.records, pricingMap, tzOffset) : []),
    [data, pricingMap, tzOffset],
  );

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold font-display tracking-tight">
          Recent
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Token usage over the last 72 hours.
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-[var(--radius-card)] bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load usage data: {error}
        </div>
      )}

      {/* Loading */}
      {loading && <RecentSkeleton />}

      {/* Content */}
      {!loading && data && (
        <>
          {data.summary.total_tokens > 0 ? (
            <>
              {/* Half-hour bar chart */}
              <RecentBarChart data={halfHourPoints} />

              {/* Per-day detail table */}
              {dailyGroups.length > 0 && (
                <div className="rounded-xl bg-secondary p-1 overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                          Date
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
                      </tr>
                    </thead>
                    <tbody>
                      {dailyGroups.map((group) => (
                        <DayRow
                          key={group.date}
                          group={group}
                          pricingMap={pricingMap}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-[var(--radius-card)] bg-secondary p-8 text-center text-sm text-muted-foreground">
              No usage data in the last 72 hours.
            </div>
          )}
        </>
      )}
    </div>
  );
}
