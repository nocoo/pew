"use client";

import { useMemo, useState } from "react";
import {
  Zap,
  ArrowDownToLine,
  ArrowUpFromLine,
  Database,
  DollarSign,
} from "lucide-react";
import { useUsageData, toHeatmapData } from "@/hooks/use-usage-data";
import { formatTokens } from "@/lib/utils";
import { usePricingMap, lookupPricing, estimateCost, formatCost } from "@/hooks/use-pricing";
import type { PricingMap } from "@/hooks/use-pricing";
import { StatCard, StatGrid } from "@/components/dashboard/stat-card";
import { UsageTrendChart } from "@/components/dashboard/usage-trend-chart";
import { SourceDonutChart } from "@/components/dashboard/source-donut-chart";
import { HeatmapCalendar } from "@/components/dashboard/heatmap-calendar";
import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { PeriodSelector, periodToDateRange, periodLabel } from "@/components/dashboard/period-selector";
import type { Period } from "@/components/dashboard/period-selector";
import { Skeleton } from "@/components/ui/skeleton";
import type { ModelAggregate } from "@/hooks/use-usage-data";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compute total estimated cost from model aggregates */
function computeTotalCost(models: ModelAggregate[], pricingMap: PricingMap): number {
  let total = 0;
  for (const m of models) {
    const pricing = lookupPricing(pricingMap, m.model, m.source);
    const cost = estimateCost(m.input, m.output, m.cached, pricing);
    total += cost.totalCost;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const [period, setPeriod] = useState<Period>("all");
  const { from, to } = periodToDateRange(period);

  const { data, daily, sources, models, loading, error } = useUsageData({
    from,
    ...(to ? { to } : {}),
  });
  const yearData = useUsageData({ days: 365 });

  const currentYear = new Date().getFullYear();
  const heatmapData = toHeatmapData(yearData.daily);

  const { pricingMap } = usePricingMap();

  const estimatedCost = useMemo(() => computeTotalCost(models, pricingMap), [models, pricingMap]);

  const subtitle = periodLabel(period);

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header + period selector */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Token usage overview for your AI coding tools.
          </p>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-[var(--radius-card)] bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load usage data: {error}
        </div>
      )}

      {/* Loading state */}
      {loading && <DashboardSkeleton />}

      {/* Content */}
      {!loading && data && (
        <>
          {/* Stat cards */}
          <StatGrid columns={3}>
            <StatCard
              title="Total Tokens"
              value={formatTokens(data.summary.total_tokens)}
              subtitle={subtitle}
              icon={Zap}
              iconColor="text-primary"
            />
            <StatCard
              title="Est. Cost"
              value={formatCost(estimatedCost)}
              subtitle="Based on public pricing"
              icon={DollarSign}
              iconColor="text-chart-6"
            />
            <StatCard
              title="Cache Savings"
              value={
                data.summary.input_tokens > 0
                  ? `${Math.round((data.summary.cached_input_tokens / data.summary.input_tokens) * 100)}%`
                  : "0%"
              }
              subtitle={`${formatTokens(data.summary.cached_input_tokens)} cached tokens`}
              icon={Database}
              iconColor="text-success"
            />
          </StatGrid>

          {/* Token breakdown (secondary row) */}
          <StatGrid columns={3}>
            <StatCard
              title="Input Tokens"
              value={formatTokens(data.summary.input_tokens)}
              subtitle="Prompts & context"
              icon={ArrowDownToLine}
            />
            <StatCard
              title="Output Tokens"
              value={formatTokens(data.summary.output_tokens)}
              subtitle="Responses & reasoning"
              icon={ArrowUpFromLine}
            />
            <StatCard
              title="Cached Tokens"
              value={formatTokens(data.summary.cached_input_tokens)}
              subtitle="Cache hits"
              icon={Database}
            />
          </StatGrid>

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-3 md:gap-4">
            <UsageTrendChart data={daily} />
            <SourceDonutChart data={sources} />
          </div>

          {/* Activity heatmap */}
          <div className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5">
            <p className="mb-3 text-xs md:text-sm text-muted-foreground">
              {currentYear} Activity
            </p>
            {yearData.loading ? (
              <Skeleton className="h-[120px] w-full" />
            ) : (
              <HeatmapCalendar
                data={heatmapData}
                year={currentYear}
                valueFormatter={(v) => formatTokens(v)}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
