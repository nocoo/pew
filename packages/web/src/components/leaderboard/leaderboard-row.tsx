"use client";

import { cn, formatTokensFull } from "@/lib/utils";
import { formatDuration } from "@/lib/date-helpers";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { CheckRuling } from "@/components/leaderboard/check-ruling";
import { RankBadge } from "@/components/leaderboard/rank-badge";
import { TokenTierBadge } from "@/components/leaderboard/token-tier-badge";
import { TeamLogoBadge } from "@/components/leaderboard/scope-dropdown";
import type { LeaderboardEntry } from "@/hooks/use-leaderboard";

// ---------------------------------------------------------------------------
// LeaderboardRow — check-style design
// ---------------------------------------------------------------------------

export function LeaderboardRow({
  entry,
  index,
  animationStartIndex,
  onSelect,
}: {
  entry: LeaderboardEntry;
  index: number;
  /** Index of first newly loaded entry — entries before this don't animate */
  animationStartIndex: number;
  /** Callback when user clicks the row */
  onSelect: (entry: LeaderboardEntry) => void;
}) {
  const { rank, user, teams, badges, total_tokens, session_count, total_duration_seconds } =
    entry;
  const displayName = user.name ?? "Anonymous";
  const initial = displayName[0]?.toUpperCase() ?? "?";

  // Only animate newly loaded entries (index >= animationStartIndex)
  const shouldAnimate = index >= animationStartIndex;
  const animationIndex = index - animationStartIndex;

  const content = (
    <div
      className={cn(
        "relative flex items-center gap-3 overflow-hidden rounded-[var(--radius-card)] bg-secondary px-4 py-3 transition-colors hover:bg-accent cursor-pointer",
        shouldAnimate && "animate-fade-up",
        rank <= 3 && "ring-1 ring-border/50",
      )}
      style={shouldAnimate ? { animationDelay: `${Math.min(animationIndex * 40, 600)}ms` } : undefined}
    >
      <CheckRuling />

      {/* Rank — fixed w-8, tabular-nums for alignment */}
      <div className="flex w-8 shrink-0 items-center justify-center tabular-nums">
        <RankBadge rank={rank} {...(badges[0] && { badge: badges[0] })} />
      </div>

      {/* Avatar + Name + Teams */}
      <div className="flex flex-1 items-center gap-3 min-w-0">
        <Avatar className="h-8 w-8 shrink-0">
          {user.image && <AvatarImage src={user.image} alt={displayName} />}
          <AvatarFallback className="text-xs bg-primary text-primary-foreground">
            {initial}
          </AvatarFallback>
        </Avatar>
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground truncate">
              {displayName}
            </span>
            <TokenTierBadge totalTokens={total_tokens} />
          </div>
          {teams.length > 0 && (
            <div className="hidden sm:flex gap-1 flex-wrap">
              {teams.map((team) => (
                <span
                  key={team.id}
                  className="inline-flex items-center gap-1 text-xs leading-tight text-muted-foreground bg-muted px-1.5 py-0.5 rounded"
                >
                  <TeamLogoBadge logoUrl={team.logo_url} name={team.name} />
                  {team.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Session count (hidden on mobile) */}
      <div className="hidden sm:block w-24 shrink-0 text-right">
        <span className="text-xs tabular-nums text-chart-2" title="Sessions">
          {session_count != null ? session_count.toLocaleString("en-US") : "\u2014"}
        </span>
      </div>

      {/* Duration (hidden on mobile) */}
      <div className="hidden sm:block w-24 shrink-0 text-right">
        <span className="text-xs tabular-nums text-chart-7" title="Total duration">
          {total_duration_seconds != null ? formatDuration(total_duration_seconds) : "\u2014"}
        </span>
      </div>

      {/* Total — check-style handwriting font, full number */}
      <div className="relative z-10 w-[120px] sm:w-[280px] shrink-0 text-right flex items-center justify-end">
        <span className="font-handwriting text-[28px] sm:text-[39px] leading-none tracking-tight text-foreground whitespace-nowrap">
          {formatTokensFull(total_tokens)}
        </span>
      </div>
    </div>
  );

  return (
    <button type="button" className="block w-full text-left" onClick={() => onSelect(entry)}>
      {content}
    </button>
  );
}
