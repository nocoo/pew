import { Skeleton } from "@/components/ui/skeleton";
import { ChartCardSkeleton } from "./chart-card-skeleton";

/** Preserve the three metrics and shared chart layout while the period loads. */
export function DashboardSkeleton() {
  return (
    <div className="space-y-5" role="status" aria-label="Loading overview" aria-busy="true">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 md:gap-4">
        {["tokens", "cost", "cache"].map((metric) => <div key={metric} className="space-y-5 rounded-card bg-secondary p-6">
          <Skeleton className="h-4 w-24" /><Skeleton className="h-10 w-36" /><Skeleton className="h-4 w-full" />
        </div>)}
      </div>
      <Skeleton className="h-4 w-64" />
      <ChartCardSkeleton titleWidth="w-32" chartHeight="h-[160px]" />
      <ChartCardSkeleton titleWidth="w-32" chartHeight="h-[240px] md:h-[280px]" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {["machine", "model", "harness"].map((dimension) => <ChartCardSkeleton key={dimension} titleWidth="w-24" chartHeight="h-48" />)}
      </div>
    </div>
  );
}
