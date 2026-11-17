import { SkeletonLine } from "@nocoo/basalt/components/skeleton-line";

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
    <div className="rounded-card bg-basalt-secondary p-4 md:p-5 space-y-3">
      <SkeletonLine style={{ width: undefined }} className="h-3 w-20" />
      <SkeletonLine style={{ width: undefined }} className="h-7 w-28" />
      <SkeletonLine style={{ width: undefined }} className="h-3 w-16" />
    </div>
  );
}
