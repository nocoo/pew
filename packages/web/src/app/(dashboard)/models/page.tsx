"use client";

import { useMemo, useState } from "react";
import { useUsageData, sourceLabel } from "@/hooks/use-usage-data";
import { formatTokens } from "@/lib/utils";
import { usePricingMap, formatCost } from "@/hooks/use-pricing";
import { groupByModel, toSourceTrendPoints } from "@/lib/usage-helpers";
import { toModelEvolutionPoints } from "@/lib/model-helpers";
import { Skeleton } from "@/components/ui/skeleton";
import { modelColor, agentColor, withAlpha } from "@/lib/palette";
import { ModelBreakdownChart } from "@/components/dashboard/model-breakdown-chart";
import { SourceTrendChart } from "@/components/dashboard/source-trend-chart";
import { ModelEvolutionChart } from "@/components/dashboard/model-evolution-chart";
import { PeriodSelector } from "@/components/dashboard/period-selector";
import { periodToDateRange, periodLabel, getLocalToday, fillDateRange } from "@/lib/date-helpers";
import type { Period } from "@/lib/date-helpers";

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function ModelsSkeleton() {
  return (
    <div className="space-y-4 md:space-y-6">
      {/* 2-col chart grid (SourceTrend + ModelEvolution) */}
      <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5">
            <Skeleton className="h-3 w-24 mb-4" />
            <Skeleton className="h-[240px] md:h-[280px] w-full" />
          </div>
        ))}
      </div>

      {/* Breakdown chart */}
      <div className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5">
        <Skeleton className="h-3 w-28 mb-4" />
        <Skeleton className="h-[200px] md:h-[240px] w-full" />
      </div>

      {/* Summary table */}
      <div className="rounded-xl bg-secondary p-1">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-3 text-left"><Skeleton className="h-3 w-12" /></th>
              <th className="px-4 py-3 text-left hidden lg:table-cell"><Skeleton className="h-3 w-10" /></th>
              <th className="px-4 py-3 text-right"><Skeleton className="h-3 w-10 ml-auto" /></th>
              <th className="px-4 py-3 text-right"><Skeleton className="h-3 w-10 ml-auto" /></th>
              <th className="px-4 py-3 text-right hidden md:table-cell"><Skeleton className="h-3 w-10 ml-auto" /></th>
              <th className="px-4 py-3 text-right"><Skeleton className="h-3 w-10 ml-auto" /></th>
              <th className="px-4 py-3 text-right hidden sm:table-cell"><Skeleton className="h-3 w-14 ml-auto" /></th>
              <th className="px-4 py-3 text-right hidden md:table-cell"><Skeleton className="h-3 w-10 ml-auto" /></th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 5 }).map((_, i) => (
              <tr key={i} className="border-b border-border/50 last:border-0">
                <td className="px-4 py-3"><Skeleton className="h-4 w-32" /></td>
                <td className="px-4 py-3 hidden lg:table-cell"><Skeleton className="h-4 w-16" /></td>
                <td className="px-4 py-3"><Skeleton className="h-4 w-14 ml-auto" /></td>
                <td className="px-4 py-3"><Skeleton className="h-4 w-14 ml-auto" /></td>
                <td className="px-4 py-3 hidden md:table-cell"><Skeleton className="h-4 w-14 ml-auto" /></td>
                <td className="px-4 py-3"><Skeleton className="h-4 w-14 ml-auto" /></td>
                <td className="px-4 py-3 hidden sm:table-cell"><Skeleton className="h-4 w-14 ml-auto" /></td>
                <td className="px-4 py-3 hidden md:table-cell"><Skeleton className="h-2 w-full rounded-full" /></td>
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

export default function ModelsPage() {
  const [period, setPeriod] = useState<Period>("all");
  const { from, to } = periodToDateRange(period, new Date().getTimezoneOffset());

  const { data, models, loading, error } = useUsageData({
    from,
    ...(to ? { to } : {}),
  });

  const { pricingMap } = usePricingMap();

  const tzOffset = useMemo(() => new Date().getTimezoneOffset(), []);
  const today = useMemo(() => getLocalToday(tzOffset), [tzOffset]);

  const modelGroups = useMemo(
    () => (data ? groupByModel(data.records, pricingMap) : []),
    [data, pricingMap],
  );

  const grandTotal = useMemo(
    () => modelGroups.reduce((sum, g) => sum + g.totalTokens, 0),
    [modelGroups],
  );

  const sourceTrendData = useMemo(() => {
    if (!data) return [];
    const sparse = toSourceTrendPoints(data.records, tzOffset);
    if (sparse.length === 0) return sparse;
    // Collect all source keys for zero-fill factory
    const allSources = Object.keys((sparse[0] as (typeof sparse)[number]).sources);
    const zeroSources: Record<string, number> = {};
    for (const s of allSources) zeroSources[s] = 0;
    return fillDateRange(sparse, "date", (d) => ({ date: d, sources: { ...zeroSources } }), today);
  }, [data, tzOffset, today]);

  const modelEvolutionData = useMemo(() => {
    if (!data) return [];
    const sparse = toModelEvolutionPoints(data.records, undefined, tzOffset);
    if (sparse.length === 0) return sparse;
    const allModels = Object.keys((sparse[0] as (typeof sparse)[number]).models);
    const zeroModels: Record<string, number> = {};
    for (const m of allModels) zeroModels[m] = 0;
    return fillDateRange(sparse, "date", (d) => ({ date: d, models: { ...zeroModels } }), today);
  }, [data, tzOffset, today]);

  const subtitle = periodLabel(period);

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold font-display tracking-tight">By Model</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Token usage grouped by AI model ({subtitle}).
          </p>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-[var(--radius-card)] bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load usage data: {error}
        </div>
      )}

      {/* Loading */}
      {loading && <ModelsSkeleton />}

      {/* Content */}
      {!loading && data && (
        <>
          {modelGroups.length === 0 ? (
            <div className="rounded-[var(--radius-card)] bg-secondary p-8 text-center text-sm text-muted-foreground">
              No usage data yet. Start using your AI coding tools and sync with pew!
            </div>
          ) : (
            <>
              {/* Evolution charts */}
              <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
                <SourceTrendChart data={sourceTrendData} />
                <ModelEvolutionChart data={modelEvolutionData} />
              </div>

              {/* Chart */}
              <ModelBreakdownChart data={models} />

              {/* Summary table */}
              <div className="rounded-xl bg-secondary p-1 overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Model</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground hidden lg:table-cell">Agent</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">Input</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">Output</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground hidden md:table-cell">Cached</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">Total</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground hidden sm:table-cell">Est. Cost</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground w-32 hidden md:table-cell">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modelGroups.map((group) => (
                      <tr
                        key={group.model}
                        className="border-b border-border/50 last:border-0 hover:bg-accent/50 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div
                              className="h-2.5 w-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: modelColor(group.model).color }}
                            />
                            <span className="text-sm font-mono font-medium text-foreground">{group.model}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell">
                          <div className="flex gap-1.5">
                            {group.sources.map((s) => {
                              const ac = agentColor(s);
                              return (
                                <span
                                  key={s}
                                  className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                                  style={{
                                    backgroundColor: withAlpha(ac.token, 0.12),
                                    color: ac.color,
                                  }}
                                >
                                  {sourceLabel(s)}
                                </span>
                              );
                            })}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-right tabular-nums">{formatTokens(group.inputTokens)}</td>
                        <td className="px-4 py-3 text-sm text-right tabular-nums">{formatTokens(group.outputTokens)}</td>
                        <td className="px-4 py-3 text-sm text-right tabular-nums hidden md:table-cell">{formatTokens(group.cachedTokens)}</td>
                        <td className="px-4 py-3 text-sm text-right tabular-nums font-medium">{formatTokens(group.totalTokens)}</td>
                        <td className="px-4 py-3 text-sm text-right tabular-nums hidden sm:table-cell">{formatCost(group.estimatedCost)}</td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 rounded-full bg-background overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{
                                  width: `${group.pctOfTotal}%`,
                                  backgroundColor: modelColor(group.model).color,
                                }}
                              />
                            </div>
                            <span className="text-[10px] tabular-nums text-muted-foreground w-8 text-right">
                              {group.pctOfTotal.toFixed(0)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border">
                      <td className="px-4 py-3 text-sm font-medium" colSpan={2}>Total</td>
                      <td className="px-4 py-3 text-sm text-right tabular-nums font-medium hidden lg:table-cell" />
                      <td className="px-4 py-3 text-sm text-right tabular-nums font-medium" />
                      <td className="px-4 py-3 text-sm text-right tabular-nums font-medium hidden md:table-cell" />
                      <td className="px-4 py-3 text-sm text-right tabular-nums font-bold">{formatTokens(grandTotal)}</td>
                      <td className="px-4 py-3 text-sm text-right tabular-nums font-medium hidden sm:table-cell">
                        {formatCost(modelGroups.reduce((s, g) => s + g.estimatedCost, 0))}
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
