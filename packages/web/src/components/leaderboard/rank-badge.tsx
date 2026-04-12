import { Trophy, Medal, Award } from "lucide-react";
import { BadgeIcon } from "@/components/badges/badge-icon";
import type { LeaderboardBadge } from "@/hooks/use-leaderboard";

interface RankBadgeProps {
  rank: number;
  /** If provided, show badge instead of rank indicator */
  badge?: LeaderboardBadge;
}

/**
 * Rank decoration — shows user badge if available, otherwise
 * trophy/medal/award icons for top 3, plain number for 4+.
 */
export function RankBadge({ rank, badge }: RankBadgeProps) {
  // If user has an active badge, show it instead of rank
  if (badge) {
    return (
      <BadgeIcon
        text={badge.text}
        shape={badge.shape}
        colorBg={badge.colorBg}
        colorText={badge.colorText}
        size="sm"
      />
    );
  }

  if (rank === 1) {
    return <Trophy className="h-5 w-5 text-rank-gold" strokeWidth={1.5} />;
  }
  if (rank === 2) {
    return <Medal className="h-5 w-5 text-rank-silver" strokeWidth={1.5} />;
  }
  if (rank === 3) {
    return <Award className="h-5 w-5 text-rank-bronze" strokeWidth={1.5} />;
  }
  return (
    <span className="flex h-5 w-5 items-center justify-center text-xs font-medium tabular-nums text-muted-foreground">
      {rank}
    </span>
  );
}
