import { SkeletonLine } from "@nocoo/basalt/components/skeleton-line";
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
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton loader; array order and length are stable within a single render pass so index is a legitimate key.
          key={`slot-${i}`}
          className={cn("flex items-center gap-3", ROW_CLASSES)}
        >
          {/* Rank */}
          <SkeletonLine style={{ width: undefined }} className={cn(COL_RANK, "h-5")} />
          {/* Avatar */}
          <SkeletonLine style={{ width: undefined }} className="h-8 w-8 rounded-full shrink-0" />
          {/* Name + badge */}
          <div className="flex-1 min-w-0">
            <SkeletonLine style={{ width: undefined }} className="h-4 w-32" />
          </div>
          {/* Session count (hidden on mobile) */}
          <SkeletonLine style={{ width: undefined }} className={cn(COL_SESSIONS, "h-3")} />
          {/* Duration (hidden on mobile) */}
          <SkeletonLine style={{ width: undefined }} className={cn(COL_DURATION, "h-3")} />
          {/* Total tokens */}
          <SkeletonLine style={{ width: undefined }} className={cn(COL_TOKENS, "h-7")} />
        </div>
      ))}
    </div>
  );
}
