"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { useUsageData } from "@/hooks/use-usage-data";
import { useDeviceData } from "@/hooks/use-device-data";
import { usePricingMap } from "@/hooks/use-pricing";
import { useTzOffset } from "@/hooks/use-tz-offset";
import { buildOverview, groupOverview, overviewDateRange, type OverviewMetric } from "@/lib/overview-helpers";
import { getLocalToday, periodLabel, type Period } from "@/lib/date-helpers";
import { buildDeviceLabelMap, deviceLabel } from "@/lib/device-helpers";
import { sourceLabel } from "@/lib/usage-transforms";
import { OverviewMetrics, OverviewHeatmap, OverviewTrend, OverviewBreakdown } from "@/components/dashboard/overview-charts";
import { SalaryCalculatorDialog } from "@/components/dashboard/salary-calculator-dialog";
import { LegacyOverview } from "@/components/dashboard/legacy-overview";
import { AccountingNotice } from "@/components/dashboard/accounting-notice";
import { UsageTimingNotice } from "@/components/dashboard/usage-timing-notice";
import { PeriodSelector } from "@/components/dashboard/period-selector";
import { SnapshotAlert } from "@/components/dashboard/snapshot-alert";
import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { DashboardEmptyState } from "@/components/dashboard/empty-state";
import { ErrorBanner } from "@/components/ui/error-banner";

function dateLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

export default function DashboardPage() {
  const [period, setPeriod] = useState<Period>("all");
  const [metric, setMetric] = useState<OverviewMetric>("tokens");
  const tzOffset = useTzOffset();
  const today = useMemo(() => getLocalToday(tzOffset), [tzOffset]);
  const range = useMemo(() => overviewDateRange(period, today, tzOffset), [period, today, tzOffset]);
  const { data, loading, error, refetch } = useUsageData({ from: range.from, to: range.to });
  const devices = useDeviceData({ from: range.from, to: range.to });
  const { pricingMap, loading: pricingLoading } = usePricingMap();
  const overview = useMemo(() => buildOverview(data?.records ?? [], pricingMap, range, tzOffset), [data, pricingMap, range, tzOffset]);
  const machines = useMemo(() => groupOverview(devices.data?.deviceDetails ?? [], pricingMap, (row) => row.device_id), [devices.data, pricingMap]);
  const deviceLabels = useMemo(() => buildDeviceLabelMap(devices.data?.devices ?? []), [devices.data]);
  const { summary, daily } = overview;
  const firstDay = daily[0]?.date;
  const hasRecords = overview.records.length > 0;

  return (
    <div className="space-y-5 md:space-y-6">
      <SnapshotAlert />
      <PageHeader
        title="Overview"
        description="Choose tokens, cost, or cache to explore your usage."
        actions={<SalaryCalculatorDialog
          daily={daily} dailyAverageCost={overview.dailyAverageCost} rangeLabel={periodLabel(period)}
          incomplete={!summary.costComplete} disabled={loading || pricingLoading || !hasRecords}
        />}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodSelector value={period} onChange={setPeriod} />
        <p className="text-xs text-muted-foreground">
          {firstDay ? `${dateLabel(firstDay)} – ${dateLabel(today)} · Local time` : "All charts follow the selected period · Local time"}
        </p>
      </div>

      <ErrorBanner messagePrefix="Failed to load usage data" error={error} />
      {error && <button type="button" className="text-sm underline underline-offset-4" onClick={refetch}>Retry usage</button>}
      {loading && <DashboardSkeleton />}
      {!loading && data && !hasRecords && period === "all" && <DashboardEmptyState />}

      {!loading && data && (hasRecords || period !== "all") && <>
        <OverviewMetrics summary={summary} metric={metric} onChange={setMetric} pricingLoading={pricingLoading} />
        {hasRecords ? <details className="group text-xs text-muted-foreground">
          <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 rounded-lg py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <span>{summary.input === 0 ? "No input recorded" : `Cache coverage · Read ${Math.round(summary.readCoverage * 100)}% · Write ${Math.round(summary.writeCoverage * 100)}%`}</span>
            <span className="underline underline-offset-4">Cache & cost details</span>
          </summary>
          <div className="mt-3"><AccountingNotice records={overview.records} pricingMap={pricingMap} loading={pricingLoading} /></div>
        </details> : <p className="rounded-card bg-secondary px-4 py-3 text-sm text-muted-foreground">No usage in this period.</p>}
        <UsageTimingNotice records={overview.records} />

        <div id="overview-charts" className="space-y-4 md:space-y-5">
          <OverviewHeatmap daily={daily} metric={metric} />
          <OverviewTrend daily={daily} metric={metric} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <OverviewBreakdown dimension="machine" groups={machines} metric={metric}
              label={(id) => deviceLabels.get(id) ?? deviceLabel({ device_id: id, alias: null })}
              loading={devices.loading} error={devices.error} onRetry={devices.refetch} />
            <OverviewBreakdown dimension="model" groups={overview.models} metric={metric} label={(id) => id} />
            <OverviewBreakdown dimension="harness" groups={overview.harnesses} metric={metric} label={sourceLabel} />
          </div>
        </div>
        <LegacyOverview records={overview.records} range={range} tzOffset={tzOffset} period={period} onPeriodChange={setPeriod} />
      </>}
    </div>
  );
}
