import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading skeleton for the 3-row dashboard stat card
 * (label + value + helper text). Zero parameters — every call site
 * shares the same widths and spacing.
 *
 * Use inside a `<StatGrid>` + `Array.from(...)` loop; this only
 * renders one cell.
 */
export function StatCardSkeleton() {
  return (
    <div className="rounded-card bg-secondary p-4 md:p-5 space-y-3">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-7 w-28" />
      <Skeleton className="h-3 w-16" />
    </div>
  );
}
