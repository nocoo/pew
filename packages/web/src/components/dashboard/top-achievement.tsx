"use client";

import Link from "next/link";
import {
  Flame,
  Trophy,
  Zap,
  DollarSign,
  Calendar,
  Shield,
  Sparkles,
  Brain,
  MessageSquare,
  FileText,
  Sunset,
  Moon,
  Sunrise,
  Clock,
  TrendingUp,
  Wrench,
  Layers,
  Monitor,
  MessageCircle,
  Inbox,
  Bot,
  Award,
  Crown,
  Rocket,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Achievement } from "@/hooks/use-achievements";
import type { AchievementTier } from "@/lib/achievement-helpers";
import { Skeleton } from "@/components/ui/skeleton";

// ---------------------------------------------------------------------------
// Icon map
// ---------------------------------------------------------------------------

const ICON_MAP: Record<string, LucideIcon> = {
  Flame,
  Trophy,
  Zap,
  DollarSign,
  Calendar,
  Shield,
  Sparkles,
  Brain,
  MessageSquare,
  FileText,
  Sunset,
  Moon,
  Sunrise,
  Clock,
  TrendingUp,
  Wrench,
  Layers,
  Monitor,
  MessageCircle,
  Inbox,
  Bot,
  Award,
  Crown,
  Rocket,
};

// ---------------------------------------------------------------------------
// Tier styles
// ---------------------------------------------------------------------------

const TIER_STYLES: Record<AchievementTier, {
  gradient: string;
  iconColor: string;
  badgeColor: string;
  badgeBg: string;
}> = {
  locked: {
    gradient: "from-muted/50 to-muted/30",
    iconColor: "text-muted-foreground/50",
    badgeColor: "text-muted-foreground",
    badgeBg: "bg-muted",
  },
  bronze: {
    gradient: "from-chart-7/30 to-chart-7/10",
    iconColor: "text-chart-7",
    badgeColor: "text-chart-7",
    badgeBg: "bg-chart-7/10",
  },
  silver: {
    gradient: "from-chart-2/30 to-chart-2/10",
    iconColor: "text-chart-2",
    badgeColor: "text-chart-2",
    badgeBg: "bg-chart-2/10",
  },
  gold: {
    gradient: "from-chart-6/30 to-chart-6/10",
    iconColor: "text-chart-6",
    badgeColor: "text-chart-6",
    badgeBg: "bg-chart-6/10",
  },
  diamond: {
    gradient: "from-primary/30 to-chart-8/20",
    iconColor: "text-primary",
    badgeColor: "text-primary",
    badgeBg: "bg-primary/10",
  },
};

const TIER_RANK: Record<AchievementTier, number> = {
  diamond: 4,
  gold: 3,
  silver: 2,
  bronze: 1,
  locked: 0,
};

// ---------------------------------------------------------------------------
// TopAchievement Component
// ---------------------------------------------------------------------------

export interface TopAchievementProps {
  achievements: Achievement[];
  loading?: boolean;
  className?: string;
}

/**
 * Displays the user's highest-tier achievement with a link to view all.
 * Shows the single best achievement (by tier, then by progress).
 */
export function TopAchievement({
  achievements,
  loading = false,
  className,
}: TopAchievementProps) {
  if (loading) {
    return (
      <div className={cn("space-y-3", className)}>
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Top Achievement
          </span>
        </div>
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    );
  }

  // Find the highest-tier achievement
  const sorted = [...achievements].sort((a, b) => {
    const rankDiff = TIER_RANK[b.tier] - TIER_RANK[a.tier];
    if (rankDiff !== 0) return rankDiff;
    return b.progress - a.progress;
  });

  const top = sorted[0];

  // If no achievements or all locked, show placeholder
  if (!top || top.tier === "locked") {
    return (
      <div className={cn("space-y-3", className)}>
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Top Achievement
          </span>
        </div>
        <div className="rounded-xl bg-muted/30 p-4">
          <p className="text-sm text-muted-foreground">
            Start using AI tools to unlock achievements!
          </p>
          <Link
            href="/leaderboard/achievements"
            className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            View all achievements
            <ChevronRight className="h-3 w-3" />
          </Link>
        </div>
      </div>
    );
  }

  const styles = TIER_STYLES[top.tier];
  const Icon = ICON_MAP[top.icon] ?? Trophy;

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center gap-2">
        <Trophy className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Top Achievement
        </span>
      </div>

      <Link
        href="/leaderboard/achievements"
        className="block rounded-xl bg-card/50 p-4 transition-colors hover:bg-card group"
      >
        <div className="flex items-center gap-3">
          {/* Icon */}
          <div className={cn(
            "flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br",
            styles.gradient,
          )}>
            <Icon className={cn("h-6 w-6", styles.iconColor)} strokeWidth={1.5} />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground truncate">
                {top.name}
              </span>
              <span className={cn(
                "shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider",
                styles.badgeBg,
                styles.badgeColor,
              )}>
                {top.tier}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground truncate">
              {top.tier === "diamond"
                ? `${top.displayValue} achieved!`
                : `${top.displayValue} / ${top.displayThreshold}`}
            </p>
          </div>

          {/* Arrow */}
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5" />
        </div>

        <p className="mt-3 text-xs text-primary">
          View all achievements →
        </p>
      </Link>
    </div>
  );
}
