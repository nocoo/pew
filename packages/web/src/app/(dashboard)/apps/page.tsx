"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useUsageData, sourceLabel, type UsageRow } from "@/hooks/use-usage-data";
import { formatTokens } from "@/lib/utils";
import { usePricingMap, lookupPricing, estimateCost, formatCost } from "@/hooks/use-pricing";
import type { PricingMap } from "@/hooks/use-pricing";
import { Skeleton } from "@/components/ui/skeleton";
import { CHART_COLORS } from "@/lib/palette";
import { PeriodSelector, periodToDateRange, periodLabel } from "@/components/dashboard/period-selector";
import type { Period } from "@/components/dashboard/period-selector";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AppGroup {
  source: string;
  label: string;
  records: UsageRow[];
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
  estimatedCost: number;
  models: ModelRow[];
}

interface ModelRow {
  model: string;
  input: number;
  output: number;
  cached: number;
  total: number;
  cost: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupByApp(records: UsageRow[], pricingMap: PricingMap): AppGroup[] {
  const bySource = new Map<string, UsageRow[]>();

  for (const r of records) {
    const existing = bySource.get(r.source);
    if (existing) {
      existing.push(r);
    } else {
      bySource.set(r.source, [r]);
    }
  }

  return Array.from(bySource.entries())
    .map(([source, records]) => {
      let inputTokens = 0;
      let outputTokens = 0;
      let cachedTokens = 0;
      let totalTokens = 0;
      let estimatedCost = 0;

      const byModel = new Map<string, ModelRow>();

      for (const r of records) {
        inputTokens += r.input_tokens;
        outputTokens += r.output_tokens;
        cachedTokens += r.cached_input_tokens;
        totalTokens += r.total_tokens;

        const pricing = lookupPricing(pricingMap, r.model, r.source);
        const cost = estimateCost(r.input_tokens, r.output_tokens, r.cached_input_tokens, pricing);
        estimatedCost += cost.totalCost;

        const existing = byModel.get(r.model);
        if (existing) {
          existing.input += r.input_tokens;
          existing.output += r.output_tokens;
          existing.cached += r.cached_input_tokens;
          existing.total += r.total_tokens;
          existing.cost += cost.totalCost;
        } else {
          byModel.set(r.model, {
            model: r.model,
            input: r.input_tokens,
            output: r.output_tokens,
            cached: r.cached_input_tokens,
            total: r.total_tokens,
            cost: cost.totalCost,
          });
        }
      }

      const models = Array.from(byModel.values()).sort((a, b) => b.total - a.total);

      return {
        source,
        label: sourceLabel(source),
        records,
        inputTokens,
        outputTokens,
        cachedTokens,
        totalTokens,
        estimatedCost,
        models,
      };
    })
    .sort((a, b) => b.totalTokens - a.totalTokens);
}

// ---------------------------------------------------------------------------
// App card
// ---------------------------------------------------------------------------

function AppCard({ group, color }: { group: AppGroup; color: string }) {
  const [expanded, setExpanded] = useState(true);
  const pct = (v: number) => (group.totalTokens > 0 ? ((v / group.totalTokens) * 100).toFixed(1) : "0");

  return (
    <div className="rounded-xl bg-secondary overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-accent/50 transition-colors"
      >
        <div
          className="h-3 w-3 rounded-full shrink-0"
          style={{ backgroundColor: color }}
        />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{group.label}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {group.models.length} model{group.models.length !== 1 ? "s" : ""} &middot;{" "}
            {formatCost(group.estimatedCost)} estimated
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-semibold font-display">{formatTokens(group.totalTokens)}</p>
          <p className="text-xs text-muted-foreground">total</p>
        </div>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" strokeWidth={1.5} />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" strokeWidth={1.5} />
        )}
      </button>

      {/* Usage bar */}
      <div className="px-5 pb-2">
        <div className="flex h-2 rounded-full overflow-hidden bg-background">
          <div
            className="h-full transition-all"
            style={{ width: `${pct(group.inputTokens - group.cachedTokens)}%`, backgroundColor: color, opacity: 0.8 }}
            title={`Input: ${formatTokens(group.inputTokens - group.cachedTokens)}`}
          />
          <div
            className="h-full transition-all"
            style={{ width: `${pct(group.outputTokens)}%`, backgroundColor: color, opacity: 0.5 }}
            title={`Output: ${formatTokens(group.outputTokens)}`}
          />
          <div
            className="h-full transition-all"
            style={{ width: `${pct(group.cachedTokens)}%`, backgroundColor: color, opacity: 0.25 }}
            title={`Cached: ${formatTokens(group.cachedTokens)}`}
          />
        </div>
        <div className="flex gap-4 mt-1.5 text-[10px] text-muted-foreground">
          <span>Input {formatTokens(group.inputTokens)}</span>
          <span>Output {formatTokens(group.outputTokens)}</span>
          <span>Cached {formatTokens(group.cachedTokens)}</span>
        </div>
      </div>

      {/* Model table */}
      {expanded && group.models.length > 0 && (
        <div className="px-1 pb-1">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="px-4 py-2 text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Model</th>
                  <th className="px-4 py-2 text-right text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Input</th>
                  <th className="px-4 py-2 text-right text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Output</th>
                  <th className="px-4 py-2 text-right text-[10px] font-medium text-muted-foreground uppercase tracking-wider hidden md:table-cell">Cached</th>
                  <th className="px-4 py-2 text-right text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Total</th>
                  <th className="px-4 py-2 text-right text-[10px] font-medium text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Cost</th>
                </tr>
              </thead>
              <tbody>
                {group.models.map((row) => (
                  <tr
                    key={row.model}
                    className="border-b border-border/30 last:border-0 hover:bg-accent/30 transition-colors"
                  >
                    <td className="px-4 py-2.5 text-xs font-mono text-foreground/80">{row.model}</td>
                    <td className="px-4 py-2.5 text-xs text-right tabular-nums text-muted-foreground">{formatTokens(row.input)}</td>
                    <td className="px-4 py-2.5 text-xs text-right tabular-nums text-muted-foreground">{formatTokens(row.output)}</td>
                    <td className="px-4 py-2.5 text-xs text-right tabular-nums text-muted-foreground hidden md:table-cell">{formatTokens(row.cached)}</td>
                    <td className="px-4 py-2.5 text-xs text-right tabular-nums font-medium">{formatTokens(row.total)}</td>
                    <td className="px-4 py-2.5 text-xs text-right tabular-nums text-muted-foreground hidden sm:table-cell">{formatCost(row.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function AppsSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-xl bg-secondary p-5">
          <div className="flex items-center gap-4">
            <Skeleton className="h-3 w-3 rounded-full" />
            <div className="flex-1">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-40 mt-1" />
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

export default function AppsPage() {
  const [period, setPeriod] = useState<Period>("all");
  const { from, to } = periodToDateRange(period);

  const { data, loading, error } = useUsageData({
    from,
    ...(to ? { to } : {}),
  });

  const { pricingMap } = usePricingMap();

  const appGroups = useMemo(
    () => (data ? groupByApp(data.records, pricingMap) : []),
    [data, pricingMap],
  );

  const subtitle = periodLabel(period);

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display">By App</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Token usage grouped by AI coding tool ({subtitle}).
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
      {loading && <AppsSkeleton />}

      {/* Content */}
      {!loading && data && (
        <>
          {appGroups.length === 0 ? (
            <div className="rounded-[var(--radius-card)] bg-secondary p-8 text-center text-sm text-muted-foreground">
              No usage data yet. Start using your AI coding tools and sync with Pew!
            </div>
          ) : (
            <div className="space-y-4">
              {appGroups.map((group, i) => (
                <AppCard
                  key={group.source}
                  group={group}
                  color={CHART_COLORS[i % CHART_COLORS.length]!}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
