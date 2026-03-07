"use client";

import {
  Zap,
  ArrowDownToLine,
  ArrowUpFromLine,
  Database,
} from "lucide-react";
import { useUsageData, toHeatmapData } from "@/hooks/use-usage-data";
import { formatTokens } from "@/lib/utils";
import { StatCard, StatGrid } from "@/components/dashboard/stat-card";
import { UsageTrendChart } from "@/components/dashboard/usage-trend-chart";
import { SourceDonutChart } from "@/components/dashboard/source-donut-chart";
import { HeatmapCalendar } from "@/components/dashboard/heatmap-calendar";
import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardPage() {
  const { data, daily, sources, loading, error } = useUsageData({ days: 30 });
  const yearData = useUsageData({ days: 365 });

  const currentYear = new Date().getFullYear();
  const heatmapData = toHeatmapData(yearData.daily);

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold font-display">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Token usage overview for your AI coding tools.
        </p>
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
          <StatGrid>
            <StatCard
              title="Total Tokens"
              value={formatTokens(data.summary.total_tokens)}
              subtitle="Last 30 days"
              icon={Zap}
              iconColor="text-primary"
            />
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
