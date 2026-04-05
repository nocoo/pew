"use client";

import Link from "next/link";
import { Sparkles, Trophy, Flame, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useUserAchievements,
  type UserAchievement,
} from "@/hooks/use-user-achievements";
import type { AchievementTier } from "@/lib/achievement-helpers";

// ---------------------------------------------------------------------------
// Icon map (subset for profile display)
// ---------------------------------------------------------------------------

import {
  Zap,
  DollarSign,
  Calendar,
  Shield,
  Brain,
  MessageSquare,
  FileText,
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
} from "lucide-react";

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
// Tier styles (matching achievements page)
// ---------------------------------------------------------------------------

const TIER_STYLES: Record<AchievementTier, {
  gradient: string;
  iconColor: string;
  ringColor: string;
  badgeColor: string;
  badgeBg: string;
}> = {
  locked: {
    gradient: "from-muted/50 to-muted/30",
    iconColor: "text-muted-foreground/50",
    ringColor: "stroke-muted-foreground/30",
    badgeColor: "text-muted-foreground",
    badgeBg: "bg-muted/50",
  },
  bronze: {
    gradient: "from-amber-700/20 to-amber-900/10",
    iconColor: "text-amber-600",
    ringColor: "stroke-amber-600",
    badgeColor: "text-amber-700 dark:text-amber-500",
    badgeBg: "bg-amber-600/10",
  },
  silver: {
    gradient: "from-slate-400/20 to-slate-500/10",
    iconColor: "text-slate-400",
    ringColor: "stroke-slate-400",
    badgeColor: "text-slate-600 dark:text-slate-400",
    badgeBg: "bg-slate-400/10",
  },
  gold: {
    gradient: "from-yellow-500/20 to-amber-500/10",
    iconColor: "text-yellow-500",
    ringColor: "stroke-yellow-500",
    badgeColor: "text-yellow-600 dark:text-yellow-500",
    badgeBg: "bg-yellow-500/10",
  },
  diamond: {
    gradient: "from-cyan-400/20 to-blue-500/10",
    iconColor: "text-cyan-400",
    ringColor: "stroke-cyan-400",
    badgeColor: "text-cyan-600 dark:text-cyan-400",
    badgeBg: "bg-cyan-400/10",
  },
};

// ---------------------------------------------------------------------------
// Progress Ring (compact)
// ---------------------------------------------------------------------------

const RING_SIZE = 40;
const RING_STROKE = 2.5;

function AchievementRing({
  progress,
  tier,
  icon,
}: {
  progress: number;
  tier: AchievementTier;
  icon: string;
}) {
  const radius = (RING_SIZE - RING_STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - progress);
  const styles = TIER_STYLES[tier];
  const Icon = ICON_MAP[icon] ?? Sparkles;
  const isUnlocked = tier !== "locked";
  const iconSize = RING_SIZE * 0.4;

  return (
    <div className="relative inline-flex items-center justify-center shrink-0">
      <svg
        width={RING_SIZE}
        height={RING_SIZE}
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        className="transform -rotate-90"
      >
        {/* Background ring */}
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={radius}
          fill="none"
          className="stroke-muted/50"
          strokeWidth={RING_STROKE}
        />
        {/* Progress ring */}
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={radius}
          fill="none"
          className={cn(styles.ringColor, "transition-all duration-700 ease-out")}
          strokeWidth={RING_STROKE}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      {/* Icon */}
      <div className="absolute inset-0 flex items-center justify-center">
        <Icon
          className={cn(styles.iconColor, "transition-colors")}
          style={{ width: iconSize, height: iconSize }}
          strokeWidth={isUnlocked ? 2 : 1.5}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Achievement Card (compact for profile)
// ---------------------------------------------------------------------------

function AchievementCard({ achievement }: { achievement: UserAchievement }) {
  const styles = TIER_STYLES[achievement.tier];
  const isUnlocked = achievement.tier !== "locked";
  const pct = Math.round(achievement.progress * 100);

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg p-3 transition-colors",
        isUnlocked ? "bg-card/60" : "bg-muted/20"
      )}
    >
      <AchievementRing
        progress={achievement.progress}
        tier={achievement.tier}
        icon={achievement.icon}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "text-sm font-medium truncate",
              isUnlocked ? "text-foreground" : "text-muted-foreground"
            )}
          >
            {achievement.name}
          </span>
          <span
            className={cn(
              "shrink-0 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider",
              styles.badgeBg,
              styles.badgeColor
            )}
          >
            {achievement.tier === "locked" ? "Locked" : achievement.tier}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
          <span className="tabular-nums">{achievement.displayValue}</span>
          <span>/</span>
          <span className="tabular-nums">{achievement.displayThreshold}</span>
          <span className="ml-auto tabular-nums">{pct}%</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function AchievementsSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg p-3 bg-muted/20">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface ProfileAchievementsProps {
  slug: string;
}

export function ProfileAchievements({ slug }: ProfileAchievementsProps) {
  const { data, loading, error } = useUserAchievements(slug);

  if (error) {
    return null; // Silently hide on error
  }

  if (loading) {
    return (
      <div className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs md:text-sm text-muted-foreground">Achievements</p>
        </div>
        <AchievementsSkeleton />
      </div>
    );
  }

  if (!data || data.achievements.length === 0) {
    return null; // No achievements to show
  }

  const { achievements, summary } = data;

  return (
    <div className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs md:text-sm text-muted-foreground">Achievements</p>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Trophy className="h-3.5 w-3.5 text-chart-6" strokeWidth={1.5} />
            <span className="font-medium text-foreground">{summary.totalUnlocked}</span>
            <span>/ {summary.totalAchievements}</span>
          </div>
          {summary.diamondCount > 0 && (
            <div className="flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-cyan-400" strokeWidth={1.5} />
              <span className="font-medium text-foreground">{summary.diamondCount}</span>
            </div>
          )}
          {summary.currentStreak > 0 && (
            <div className="flex items-center gap-1.5">
              <Flame className="h-3.5 w-3.5 text-chart-7" strokeWidth={1.5} />
              <span className="font-medium text-foreground">{summary.currentStreak}</span>
            </div>
          )}
        </div>
      </div>

      {/* Achievement grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {achievements.map((ach) => (
          <AchievementCard key={ach.id} achievement={ach} />
        ))}
      </div>

      {/* View all link */}
      <div className="mt-4 pt-3 border-t border-border/50 text-center">
        <Link
          href="/leaderboard/achievements"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          View all achievements →
        </Link>
      </div>
    </div>
  );
}
