import { Skeleton } from "@/components/ui/skeleton";
import { StatGrid } from "./stat-card";
import { DashboardSegment } from "./dashboard-segment";
import { ChartCardSkeleton } from "./chart-card-skeleton";

/** Loading skeleton for the dashboard overview. */
export function DashboardSkeleton() {
  return (
    <div className="space-y-4 md:space-y-6">
      {/* ── Hero: Activity + Goal + Achievements (3-col grid) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 md:gap-4">
        {/* Left: Activity skeleton */}
        <div className="rounded-card bg-secondary p-4 md:p-5">
          <Skeleton className="h-4 w-24 mb-3" />
          <div className="flex items-start justify-between mb-3">
            <div className="space-y-1">
              <Skeleton className="h-7 w-28" />
              <Skeleton className="h-3 w-40" />
            </div>
            <Skeleton className="h-6 w-20" />
          </div>
          <Skeleton className="h-[120px] w-full" />
          <div className="mt-3 flex gap-5 border-t border-border/50 pt-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-28" />
          </div>
        </div>
        {/* Center: Goal skeleton */}
        <div className="rounded-card bg-secondary p-4 md:p-5">
          <Skeleton className="h-4 w-24 mb-3" />
          <div className="space-y-1 mb-3">
            <Skeleton className="h-7 w-20" />
            <Skeleton className="h-3 w-36" />
          </div>
          <Skeleton className="h-[120px] w-full" />
          <div className="mt-3 flex gap-4 border-t border-border/50 pt-3">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
        {/* Right: Achievements skeleton */}
        <div className="rounded-card bg-secondary p-4 md:p-5 space-y-2">
          <Skeleton className="h-4 w-28 mb-3" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      </div>

      {/* ── Overview ────────────────────────────────────── */}
      <DashboardSegment title="Overview">
        {/* Row 1 — Core metrics skeleton (4 cols) */}
        <StatGrid columns={4}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-card bg-secondary p-4 md:p-5 space-y-3"
            >
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-7 w-28" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </StatGrid>

        {/* Row 2 — Economy metrics skeleton (4 cols) */}
        <StatGrid columns={4}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={`econ-${i}`}
              className="rounded-card bg-secondary p-4 md:p-5 space-y-3"
            >
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-7 w-28" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </StatGrid>
      </DashboardSegment>

      {/* ── Trends ──────────────────────────────────────── */}
      <DashboardSegment title="Trends">
        {/* Charts — left: tab toggle + trend + cache, right: donut + io ratio */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-3 md:gap-4">
          {/* Left column */}
          <div className="flex flex-col gap-3 md:gap-4">
            <div>
              <Skeleton className="h-8 w-36 mb-3 rounded-lg" />
              <ChartCardSkeleton titleWidth="w-24" chartHeight="h-[240px] md:h-[280px]" />
            </div>
            <ChartCardSkeleton titleWidth="w-20" chartHeight="h-[200px] md:h-[240px]" />
          </div>
          {/* Right column */}
          <div className="flex flex-col gap-3 md:gap-4">
            <div className="hidden lg:block h-[28px] shrink-0" />
            <div className="rounded-card bg-secondary p-4 md:p-5">
              <Skeleton className="h-3 w-20 mb-4" />
              <div className="flex justify-center">
                <Skeleton className="h-[180px] w-[180px] rounded-full" />
              </div>
            </div>
            <div className="rounded-card bg-secondary p-4 md:p-5">
              <Skeleton className="h-3 w-20 mb-4" />
              <div className="flex justify-center">
                <Skeleton className="h-[180px] w-[180px] rounded-full" />
              </div>
            </div>
          </div>
        </div>
      </DashboardSegment>

      {/* ── Insights ────────────────────────────────────── */}
      <DashboardSegment title="Insights">
        {/* Row 1: Weekday vs Weekend + Hourly Chart */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4">
          <ChartCardSkeleton titleWidth="w-28" chartHeight="h-[180px]" />
          <ChartCardSkeleton titleWidth="w-24" chartHeight="h-[180px]" />
        </div>
        {/* Row 2: Salary Estimator */}
        <div className="rounded-card bg-secondary p-4 md:p-5">
          <Skeleton className="h-3 w-32 mb-4" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Skeleton className="h-[200px] w-full" />
            <Skeleton className="h-[200px] w-full" />
          </div>
        </div>
      </DashboardSegment>
    </div>
  );
}
