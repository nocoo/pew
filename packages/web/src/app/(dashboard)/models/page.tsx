"use client";

import { useMemo, useState } from "react";
import { useUsageData, sourceLabel, type UsageRow } from "@/hooks/use-usage-data";
import { formatTokens } from "@/lib/utils";
import { usePricingMap, lookupPricing, estimateCost, formatCost } from "@/hooks/use-pricing";
import type { PricingMap } from "@/hooks/use-pricing";
import { Skeleton } from "@/components/ui/skeleton";
import { CHART_COLORS } from "@/lib/palette";
import { ModelBreakdownChart } from "@/components/dashboard/model-breakdown-chart";
import { PeriodSelector, periodToDateRange, periodLabel } from "@/components/dashboard/period-selector";
import type { Period } from "@/components/dashboard/period-selector";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ModelGroup {
  model: string;
  sources: string[];
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
  estimatedCost: number;
  pctOfTotal: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupByModel(records: UsageRow[], pricingMap: PricingMap): ModelGroup[] {
  const byModel = new Map<string, {
    sources: Set<string>;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    totalTokens: number;
    estimatedCost: number;
  }>();

  let grandTotal = 0;

  for (const r of records) {
    grandTotal += r.total_tokens;
    const existing = byModel.get(r.model);
    const pricing = lookupPricing(pricingMap, r.model, r.source);
    const cost = estimateCost(r.input_tokens, r.output_tokens, r.cached_input_tokens, pricing);

    if (existing) {
      existing.sources.add(r.source);
      existing.inputTokens += r.input_tokens;
      existing.outputTokens += r.output_tokens;
      existing.cachedTokens += r.cached_input_tokens;
      existing.totalTokens += r.total_tokens;
      existing.estimatedCost += cost.totalCost;
    } else {
      byModel.set(r.model, {
        sources: new Set([r.source]),
        inputTokens: r.input_tokens,
        outputTokens: r.output_tokens,
        cachedTokens: r.cached_input_tokens,
        totalTokens: r.total_tokens,
        estimatedCost: cost.totalCost,
      });
    }
  }

  return Array.from(byModel.entries())
    .map(([model, data]) => ({
      model,
      sources: Array.from(data.sources),
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      cachedTokens: data.cachedTokens,
      totalTokens: data.totalTokens,
      estimatedCost: data.estimatedCost,
      pctOfTotal: grandTotal > 0 ? (data.totalTokens / grandTotal) * 100 : 0,
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens);
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function ModelsSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
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
// Page
// ---------------------------------------------------------------------------

export default function ModelsPage() {
  const [period, setPeriod] = useState<Period>("all");
  const { from, to } = periodToDateRange(period);

  const { data, models, loading, error } = useUsageData({
    from,
    ...(to ? { to } : {}),
  });

  const { pricingMap } = usePricingMap();

  const modelGroups = useMemo(
    () => (data ? groupByModel(data.records, pricingMap) : []),
    [data, pricingMap],
  );

  const grandTotal = useMemo(
    () => modelGroups.reduce((sum, g) => sum + g.totalTokens, 0),
    [modelGroups],
  );

  const subtitle = periodLabel(period);

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display">By Model</h1>
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
              No usage data yet. Start using your AI coding tools and sync with Pew!
            </div>
          ) : (
            <>
              {/* Chart */}
              <ModelBreakdownChart data={models} />

              {/* Summary table */}
              <div className="rounded-xl bg-secondary p-1 overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Model</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground hidden lg:table-cell">App</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">Input</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">Output</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground hidden md:table-cell">Cached</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">Total</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground hidden sm:table-cell">Est. Cost</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground w-32 hidden md:table-cell">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modelGroups.map((group, i) => (
                      <tr
                        key={group.model}
                        className="border-b border-border/50 last:border-0 hover:bg-accent/50 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div
                              className="h-2.5 w-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                            />
                            <span className="text-sm font-mono font-medium text-foreground">{group.model}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell">
                          <div className="flex gap-1.5">
                            {group.sources.map((s) => (
                              <span
                                key={s}
                                className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                              >
                                {sourceLabel(s)}
                              </span>
                            ))}
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
                                  backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
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
