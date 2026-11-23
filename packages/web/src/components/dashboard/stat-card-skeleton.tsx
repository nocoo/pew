import { Skeleton } from "@nocoo/basalt/components/skeleton";

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
    <div className="rounded-card bg-basalt-secondary ring-1 ring-basalt-border/80 shadow-basalt-card p-4 md:p-5 space-y-3">
      <Skeleton style={{ width: undefined }} className="h-3 w-20" />
      <Skeleton style={{ width: undefined }} className="h-7 w-28" />
      <Skeleton style={{ width: undefined }} className="h-3 w-16" />
    </div>
  );
}
