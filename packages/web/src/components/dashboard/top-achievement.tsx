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

// ---------------------------------------------------------------------------
// TopAchievement Component
// ---------------------------------------------------------------------------

export interface TopAchievementProps {
  achievements: Achievement[];
  loading?: boolean;
  className?: string;
}

/**
 * Displays the user's top achievements in a responsive grid.
 * - Large screens (lg+): 3 cols × 2 rows = 6 max
 * - Medium screens (sm+): 2 cols × 2 rows = 4 max
 * - Small screens: 1 col × 2 rows = 2 max
 */
export function TopAchievement({
  achievements,
  loading = false,
  className,
}: TopAchievementProps) {
  if (loading) {
    return (
      <div className={cn("space-y-3", className)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Top Achievements
            </span>
          </div>
          <div className="h-7 w-7 shrink-0" aria-hidden="true" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  // Filter to only unlocked achievements (already sorted by tier/progress from API)
  // Limit to 6 max (2 rows × 3 cols on large screens)
  const unlocked = achievements.filter((a) => a.tier !== "locked").slice(0, 6);

  // If no achievements unlocked, show placeholder
  if (unlocked.length === 0) {
    return (
      <div className={cn("space-y-3", className)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Top Achievements
            </span>
          </div>
          <div className="h-7 w-7 shrink-0" aria-hidden="true" />
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

  return (
    <div className={cn("flex flex-col", className)}>
      {/* Section title — height matches Goal Tracker (h-7 placeholder for alignment) */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Top Achievements
          </span>
        </div>
        <div className="h-7 w-7 shrink-0" aria-hidden="true" />
      </div>

      <div className="flex-1">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {unlocked.map((ach) => {
          const styles = TIER_STYLES[ach.tier];
          const Icon = ICON_MAP[ach.icon] ?? Trophy;

          return (
            <div
              key={ach.id}
              className="flex items-center gap-3 rounded-xl bg-secondary/50 p-3"
            >
              {/* Icon */}
              <div className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br",
                styles.gradient,
              )}>
                <Icon className={cn("h-5 w-5", styles.iconColor)} strokeWidth={1.5} />
              </div>

              {/* Content — vertical stack for better readability */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-sm font-medium text-foreground">
                    {ach.name}
                  </span>
                  <span className={cn(
                    "shrink-0 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider",
                    styles.badgeBg,
                    styles.badgeColor,
                  )}>
                    {ach.tier}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {ach.tier === "diamond"
                    ? `${ach.displayValue} achieved!`
                    : `${ach.displayValue} / ${ach.displayThreshold}`}
                </p>
              </div>
            </div>
          );
        })}
        </div>
      </div>

      {/* Footer — fixed height for alignment across cards */}
      <div className="mt-auto flex h-10 items-center border-t border-border/50 pt-3">
        <Link
          href="/leaderboard/achievements"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          View all achievements
          <ChevronRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
