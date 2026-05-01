import { Skeleton } from "@/components/ui/skeleton";

interface ChartCardSkeletonProps {
  /** Tailwind width class for the title bar (e.g. "w-24"). */
  titleWidth?: string;
  /** Tailwind height class(es) for the chart body (e.g. "h-[200px]" or "h-[240px] md:h-[280px]"). */
  chartHeight: string;
}

/**
 * Dashboard chart-card loading skeleton: title bar + full-width chart body
 * inside the standard `rounded-card bg-secondary p-4 md:p-5` shell.
 *
 * Intentionally narrow — covers only "title + full-width chart" cards.
 * Donut cards, stat grids, hero composites, and any nested-grid composites
 * have their own shapes and stay inline.
 */
export function ChartCardSkeleton({
  titleWidth = "w-24",
  chartHeight,
}: ChartCardSkeletonProps) {
  return (
    <div className="rounded-card bg-secondary p-4 md:p-5">
      <Skeleton className={`h-3 ${titleWidth} mb-4`} />
      <Skeleton className={`${chartHeight} w-full`} />
    </div>
  );
}
