import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ROW_CLASSES, COL_RANK, COL_SESSIONS, COL_DURATION, COL_TOKENS } from "@/components/leaderboard/leaderboard-layout";

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
          className={cn("flex items-center gap-3", ROW_CLASSES)}
        >
          {/* Rank */}
          <Skeleton className={cn(COL_RANK, "h-5")} />
          {/* Avatar */}
          <Skeleton className="h-8 w-8 rounded-full shrink-0" />
          {/* Name + badge */}
          <div className="flex-1 min-w-0">
            <Skeleton className="h-4 w-32" />
          </div>
          {/* Session count (hidden on mobile) */}
          <Skeleton className={cn(COL_SESSIONS, "h-3")} />
          {/* Duration (hidden on mobile) */}
          <Skeleton className={cn(COL_DURATION, "h-3")} />
          {/* Total tokens */}
          <Skeleton className={cn(COL_TOKENS, "h-7")} />
        </div>
      ))}
    </div>
  );
}
