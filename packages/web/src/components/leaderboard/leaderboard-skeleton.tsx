import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading skeleton for leaderboard rows.
 * Matches LeaderboardRow's compact density (py-3, gap-3, space-y-2).
 * @param count Number of skeleton rows (default 10).
 */
export function LeaderboardSkeleton({ count = 10 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-[var(--radius-card)] bg-secondary px-4 py-3"
        >
          {/* Rank */}
          <Skeleton className="h-5 w-8" />
          {/* Avatar */}
          <Skeleton className="h-8 w-8 rounded-full" />
          {/* Name */}
          <Skeleton className="h-4 w-32" />
          <div className="flex-1" />
          {/* In/Out (hidden on mobile) */}
          <Skeleton className="hidden sm:block h-3 w-12 shrink-0" />
          <Skeleton className="hidden sm:block h-3 w-12 shrink-0" />
          {/* Total */}
          <Skeleton className="h-6 w-28 sm:w-36 shrink-0" />
        </div>
      ))}
    </div>
  );
}
