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
import { getModelPricing, estimateCost, formatCost } from "@/lib/pricing";
import { StatCard, StatGrid } from "@/components/dashboard/stat-card";
import { UsageTrendChart } from "@/components/dashboard/usage-trend-chart";
import { SourceDonutChart } from "@/components/dashboard/source-donut-chart";
import { HeatmapCalendar } from "@/components/dashboard/heatmap-calendar";
import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ModelAggregate } from "@/hooks/use-usage-data";

// ---------------------------------------------------------------------------
// Period selector
// ---------------------------------------------------------------------------

type Period = "all" | "month" | "week";

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: "all", label: "All Time" },
  { value: "month", label: "This Month" },
  { value: "week", label: "This Week" },
];

/** Compute from/to date strings for a given period */
function periodToDateRange(period: Period): { from: string; to?: string } {
  const now = new Date();

  switch (period) {
    case "all":
      // Far past to capture everything
      return { from: "2020-01-01" };
    case "month": {
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: firstOfMonth.toISOString().slice(0, 10) };
    }
    case "week": {
      // Most recent Sunday
      const day = now.getDay(); // 0=Sun, 1=Mon, ...
      const sunday = new Date(now);
      sunday.setDate(now.getDate() - day);
      return { from: sunday.toISOString().slice(0, 10) };
    }
  }
}

function periodLabel(period: Period): string {
  switch (period) {
    case "all":
      return "All time";
    case "month":
      return new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
    case "week":
      return "This week";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compute total estimated cost from model aggregates */
function computeTotalCost(models: ModelAggregate[]): number {
  let total = 0;
  for (const m of models) {
    const pricing = getModelPricing(m.model, m.source);
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

  const estimatedCost = useMemo(() => computeTotalCost(models), [models]);

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
        <div className="flex items-center gap-1 rounded-lg bg-secondary p-1">
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setPeriod(opt.value)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                period === opt.value
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
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
