import { Skeleton } from "@/components/ui/skeleton";
import { ChartCardSkeleton } from "./chart-card-skeleton";
import { DashboardSegment } from "./dashboard-segment";
import { HeatmapHero } from "./heatmap-hero";
import { StatCardSkeleton } from "./stat-card-skeleton";
import { StatGrid } from "./stat-card";

/** Preserve the activity, summary and trend layout while usage loads. */
export function DashboardSkeleton() {
  return (
    <div className="space-y-4 md:space-y-6" role="status" aria-label="Loading overview" aria-busy="true">
      <HeatmapHero data={[]} year={new Date().getFullYear()} totalTokens={0} activeDays={0} loading />
      <DashboardSegment title="Usage summary">
        <StatGrid columns={4}>
          {["total", "hit-rate", "input", "output"].map((metric) => <StatCardSkeleton key={metric} />)}
        </StatGrid>
        <StatGrid columns={3}>
          {["cost", "forecast", "daily-average"].map((metric) => <StatCardSkeleton key={metric} />)}
        </StatGrid>
      </DashboardSegment>
      <DashboardSegment title="Trends">
        <div className="grid grid-cols-1 gap-3 md:gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-4">
            <Skeleton className="h-8 w-36 rounded-lg" />
            <ChartCardSkeleton titleWidth="w-24" chartHeight="h-[240px] md:h-[280px]" />
            <ChartCardSkeleton titleWidth="w-32" chartHeight="h-[200px] md:h-[240px]" />
          </div>
          <div className="space-y-4">
            {["agent", "input-output"].map((chart) => <div key={chart} className="rounded-card bg-secondary p-4 md:p-5">
              <Skeleton className="mb-4 h-3 w-24" />
              <Skeleton className="mx-auto h-[180px] w-[180px] rounded-full" />
            </div>)}
          </div>
        </div>
        <Skeleton className="h-8 w-52 rounded-lg" />
        <div className="grid grid-cols-1 gap-3 md:gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <ChartCardSkeleton titleWidth="w-40" chartHeight="h-[280px]" />
          <ChartCardSkeleton titleWidth="w-24" chartHeight="h-[280px]" />
        </div>
      </DashboardSegment>
      <DashboardSegment title="Insights">
        <div className="grid grid-cols-1 gap-3 md:gap-4 lg:grid-cols-2">
          <ChartCardSkeleton titleWidth="w-28" chartHeight="h-[180px]" />
          <ChartCardSkeleton titleWidth="w-24" chartHeight="h-[180px]" />
        </div>
      </DashboardSegment>
    </div>
  );
}
