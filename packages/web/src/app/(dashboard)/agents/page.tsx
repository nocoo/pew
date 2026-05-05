"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useUsageData } from "@/hooks/use-usage-data";
import { ErrorBanner } from "@/components/ui/error-banner";
import { formatTokens } from "@/lib/utils";
import { usePricingMap, formatCost } from "@/hooks/use-pricing";
import { groupByAgent } from "@/lib/usage-helpers";
import type { AgentGroup } from "@/lib/usage-helpers";
import { Skeleton } from "@/components/ui/skeleton";
import { agentColor } from "@/lib/palette";
import { PeriodSelector } from "@/components/dashboard/period-selector";
import { ModelInfoTooltip } from "@/components/dashboard/model-info-tooltip";
import { periodToDateRange, periodLabel } from "@/lib/date-helpers";
import type { Period } from "@/lib/date-helpers";
import { useTzOffset } from "@/hooks/use-tz-offset";

// ---------------------------------------------------------------------------
// Agent card
// ---------------------------------------------------------------------------

function AgentCard({ group, color }: { group: AgentGroup; color: string }) {
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
        <div className="flex gap-4 mt-1.5 text-xs text-muted-foreground">
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
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Model</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">Input</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">Output</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider hidden md:table-cell">Cached</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">Total</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Cost</th>
                </tr>
              </thead>
              <tbody>
                {group.models.map((row) => (
                  <tr
                    key={row.model}
                    className="border-b border-border/30 last:border-0 hover:bg-accent/30 transition-colors"
                  >
                    <td className="px-4 py-2.5 text-xs font-mono text-foreground/80">
                      <span className="align-middle">{row.model}</span>
                      <ModelInfoTooltip model={row.model} className="ml-1.5" />
                    </td>
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

function AgentsSkeleton() {
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

export default function AgentsPage() {
  const [period, setPeriod] = useState<Period>("all");
  const tzOffset = useTzOffset();
  const { from, to } = periodToDateRange(period, tzOffset);

  const { data, loading, error } = useUsageData({
    from,
    ...(to ? { to } : {}),
  });

  const { pricingMap } = usePricingMap();

  const agentGroups = useMemo(
    () => (data ? groupByAgent(data.records, pricingMap) : []),
    [data, pricingMap],
  );

  const subtitle = periodLabel(period);

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold font-display tracking-tight">By Agent</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Token usage grouped by AI coding tool ({subtitle}).
          </p>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {/* Error */}
      <ErrorBanner messagePrefix="Failed to load usage data" error={error} />

      {/* Loading */}
      {loading && <AgentsSkeleton />}

      {/* Content */}
      {!loading && data && (
        <>
          {agentGroups.length === 0 ? (
            <div className="rounded-card bg-secondary p-8 text-center text-sm text-muted-foreground">
              No usage data yet. Start using your AI coding tools and sync with pew!
            </div>
          ) : (
            <div className="space-y-4">
              {agentGroups.map((group) => (
                <AgentCard
                  key={group.source}
                  group={group}
                  color={agentColor(group.source).color}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
