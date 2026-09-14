import { Skeleton } from "@/components/ui/skeleton";
import { ChartCardSkeleton } from "./chart-card-skeleton";
import { DashboardSegment } from "./dashboard-segment";
import { HeatmapHero } from "./heatmap-hero";
import { StatGrid } from "./stat-card";

/** Preserve the activity, summary and trend layout while usage loads. */
export function DashboardSkeleton() {
  return (
    <div className="space-y-4 md:space-y-6" role="status" aria-label="Loading overview" aria-busy="true">
      <div className="grid grid-cols-1 gap-3 md:gap-4 xl:grid-cols-3">
        <HeatmapHero data={[]} year={new Date().getFullYear()} totalTokens={0} activeDays={0} loading className="xl:col-span-2" />
        <div className="rounded-card bg-secondary p-4 space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-[114px] w-full" />
          <Skeleton className="h-[72px] w-full" />
        </div>
      </div>
      <DashboardSegment title="Usage summary">
        <StatGrid columns={3} className="sm:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
          {["total", "hit-rate", "cost"].map((metric) => <div key={metric} className={`rounded-card bg-secondary p-4 md:p-5 space-y-4 ${metric === "cost" ? "lg:col-span-2 xl:col-span-1" : ""}`}>
            <Skeleton className="h-0.5 w-8" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-32" />
            <Skeleton className="h-12 w-full" />
            <div className="grid grid-cols-2 gap-3 border-t border-border/50 pt-3">
              <Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" />
            </div>
          </div>)}
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
