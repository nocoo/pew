"use client";

import { useMemo, Fragment } from "react";
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
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAchievements, type Achievement, type EarnedByUser } from "@/hooks/use-achievements";
import { type AchievementTier, type AchievementCategory, CATEGORY_LABELS } from "@/lib/achievement-helpers";
import { LeaderboardNav } from "@/components/leaderboard/leaderboard-nav";
import { PageHeader } from "@/components/leaderboard/page-header";
import { Skeleton } from "@/components/ui/skeleton";

// ---------------------------------------------------------------------------
// Icon map — all icons from achievement definitions
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
// Tier visual system
// ---------------------------------------------------------------------------

const TIER_STYLES: Record<AchievementTier, {
  gradient: string;
  iconColor: string;
  ringColor: string;
  glow: string;
  badgeColor: string;
  badgeBg: string;
}> = {
  locked: {
    gradient: "from-muted/50 to-muted/30",
    iconColor: "text-muted-foreground/50",
    ringColor: "stroke-muted-foreground/30",
    glow: "",
    badgeColor: "text-muted-foreground",
    badgeBg: "bg-muted",
  },
  bronze: {
    gradient: "from-chart-7/30 to-chart-7/10",
    iconColor: "text-chart-7",
    ringColor: "stroke-chart-7",
    glow: "shadow-[0_0_12px_-2px] shadow-chart-7/30",
    badgeColor: "text-chart-7",
    badgeBg: "bg-chart-7/10",
  },
  silver: {
    gradient: "from-chart-2/30 to-chart-2/10",
    iconColor: "text-chart-2",
    ringColor: "stroke-chart-2",
    glow: "shadow-[0_0_12px_-2px] shadow-chart-2/30",
    badgeColor: "text-chart-2",
    badgeBg: "bg-chart-2/10",
  },
  gold: {
    gradient: "from-chart-6/30 to-chart-6/10",
    iconColor: "text-chart-6",
    ringColor: "stroke-chart-6",
    glow: "shadow-[0_0_16px_-2px] shadow-chart-6/40",
    badgeColor: "text-chart-6",
    badgeBg: "bg-chart-6/10",
  },
  diamond: {
    gradient: "from-primary/30 to-chart-8/20",
    iconColor: "text-primary",
    ringColor: "stroke-primary",
    glow: "shadow-[0_0_20px_-2px] shadow-primary/50",
    badgeColor: "text-primary",
    badgeBg: "bg-primary/10",
  },
};

// ---------------------------------------------------------------------------
// Progress Ring
// ---------------------------------------------------------------------------

const RING_SIZE = 56;
const RING_STROKE = 3;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

interface AchievementRingProps {
  progress: number;
  tier: AchievementTier;
  icon: string;
}

function AchievementRing({ progress, tier, icon }: AchievementRingProps) {
  const offset = RING_CIRCUMFERENCE * (1 - progress);
  const styles = TIER_STYLES[tier];
  const Icon = ICON_MAP[icon] ?? Sparkles;
  const isUnlocked = tier !== "locked";

  return (
    <div className={cn("relative inline-flex items-center justify-center shrink-0", styles.glow, "rounded-full")}>
      <svg
        width={RING_SIZE}
        height={RING_SIZE}
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        className="-rotate-90"
      >
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          strokeWidth={RING_STROKE}
          className="stroke-muted-foreground/10"
        />
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={offset}
          className={cn(styles.ringColor, "transition-[stroke-dashoffset] duration-700 ease-out")}
        />
      </svg>
      <div className={cn(
        "absolute inset-2 rounded-full bg-gradient-to-br flex items-center justify-center",
        styles.gradient
      )}>
        <Icon
          className={cn("h-5 w-5", styles.iconColor, isUnlocked && tier !== "bronze" && "drop-shadow-sm")}
          strokeWidth={1.5}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Earned By Avatars
// ---------------------------------------------------------------------------

interface EarnedByAvatarsProps {
  earnedBy: EarnedByUser[];
  totalEarned: number;
  achievementId: string;
}

function EarnedByAvatars({ earnedBy, totalEarned, achievementId }: EarnedByAvatarsProps) {
  if (earnedBy.length === 0) return null;

  const displayCount = Math.min(earnedBy.length, 4);
  const remainingCount = totalEarned - displayCount;

  return (
    <div className="flex items-center gap-1.5 mt-2">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Earned by</span>
      <div className="flex -space-x-1.5">
        {earnedBy.slice(0, displayCount).map((user) => {
          const profilePath = user.slug ? `/u/${user.slug}` : `/u/${user.id}`;
          return (
            <Link key={user.id} href={profilePath} className="relative block">
              <Avatar className="h-5 w-5 ring-2 ring-background hover:ring-primary transition-[box-shadow]">
                {user.image && <AvatarImage src={user.image} alt={user.name} />}
                <AvatarFallback className="text-[8px] bg-muted text-muted-foreground">
                  {user.name[0]?.toUpperCase() ?? "?"}
                </AvatarFallback>
              </Avatar>
            </Link>
          );
        })}
      </div>
      {remainingCount > 0 && (
        <Link
          href={`/leaderboard/achievements/${achievementId}/members`}
          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          +{remainingCount} more
        </Link>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Achievement Card (Expanded)
// ---------------------------------------------------------------------------

interface AchievementCardProps {
  achievement: Achievement;
  index: number;
}

function AchievementCard({ achievement, index }: AchievementCardProps) {
  const styles = TIER_STYLES[achievement.tier];
  const isUnlocked = achievement.tier !== "locked";
  const isMaxed = achievement.tier === "diamond";
  const pct = Math.round(achievement.progress * 100);

  return (
    <div
      className={cn(
        "flex flex-col rounded-xl p-4 transition-colors animate-fade-up",
        isUnlocked ? "bg-card/80 hover:bg-card" : "bg-muted/30 hover:bg-muted/50",
      )}
      style={{ animationDelay: `${Math.min(index * 30, 400)}ms` }}
    >
      {/* Top row: ring + name/tier */}
      <div className="flex items-start gap-3">
        <AchievementRing
          progress={achievement.progress}
          tier={achievement.tier}
          icon={achievement.icon}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn(
              "text-sm font-medium truncate",
              isUnlocked ? "text-foreground" : "text-muted-foreground"
            )}>
              {achievement.name}
            </span>
            <span className={cn(
              "shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider",
              styles.badgeBg,
              styles.badgeColor,
            )}>
              {achievement.tier === "locked" ? "Locked" : achievement.tier}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground italic line-clamp-2">
            "{achievement.flavorText}"
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
          <span className="font-medium tabular-nums">{achievement.displayValue}</span>
          <span>/</span>
          <span className="tabular-nums">{achievement.displayThreshold}</span>
          <span>{achievement.unit}</span>
          {!isMaxed && (
            <span className="ml-auto tabular-nums">{pct}% → {achievement.tier === "locked" ? "Bronze" : achievement.tier === "bronze" ? "Silver" : achievement.tier === "silver" ? "Gold" : "Diamond"}</span>
          )}
          {isMaxed && (
            <span className="ml-auto flex items-center gap-1 text-primary">
              <Sparkles className="h-3 w-3" strokeWidth={2} />
              Max
            </span>
          )}
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-[width] duration-700 ease-out", styles.badgeBg)}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Earned by avatars */}
      <EarnedByAvatars
        earnedBy={achievement.earnedBy}
        totalEarned={achievement.totalEarned}
        achievementId={achievement.id}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary Bar
// ---------------------------------------------------------------------------

interface SummaryBarProps {
  totalUnlocked: number;
  totalAchievements: number;
  diamondCount: number;
  currentStreak: number;
}

function SummaryBar({ totalUnlocked, totalAchievements, diamondCount, currentStreak }: SummaryBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl bg-card/50 p-4 text-sm animate-fade-up" style={{ animationDelay: "120ms" }}>
      <div className="flex items-center gap-2">
        <Trophy className="h-4 w-4 text-chart-6" strokeWidth={1.5} />
        <span className="font-medium">{totalUnlocked}</span>
        <span className="text-muted-foreground">/ {totalAchievements} Unlocked</span>
      </div>
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" strokeWidth={1.5} />
        <span className="font-medium">{diamondCount}</span>
        <span className="text-muted-foreground">Diamond</span>
      </div>
      <div className="flex items-center gap-2">
        <Flame className="h-4 w-4 text-chart-7" strokeWidth={1.5} />
        <span className="font-medium">{currentStreak}</span>
        <span className="text-muted-foreground">day streak</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function AchievementsSkeleton() {
  return (
    <div className="space-y-6">
      {/* Summary skeleton */}
      <Skeleton className="h-14 w-full rounded-xl" />

      {/* Category skeletons */}
      {[1, 2, 3].map((i) => (
        <div key={i} className="space-y-3">
          <Skeleton className="h-5 w-32" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[1, 2, 3].map((j) => (
              <Skeleton key={j} className="h-32 rounded-xl" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const CATEGORY_ORDER: AchievementCategory[] = [
  "volume",
  "consistency",
  "efficiency",
  "spending",
  "diversity",
  "sessions",
  "special",
];

export default function AchievementsPage() {
  const { data, loading, error } = useAchievements();

  // Group achievements by category
  const grouped = useMemo(() => {
    if (!data) return new Map<AchievementCategory, Achievement[]>();

    const map = new Map<AchievementCategory, Achievement[]>();
    for (const ach of data.achievements) {
      const list = map.get(ach.category) ?? [];
      list.push(ach);
      map.set(ach.category, list);
    }
    return map;
  }, [data]);

  return (
    <>
      {/* Header */}
      <PageHeader>
        <h1 className="tracking-tight text-foreground">
          <span className="text-[36px] font-bold font-handwriting leading-none mr-2">pew</span>
          <span className="text-[19px] font-normal text-muted-foreground">
            Achievements
          </span>
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Track your AI coding milestones and compete with others.
        </p>
      </PageHeader>

      {/* Main content */}
      <main className="flex-1 py-4 space-y-6">
        {/* Tab nav */}
        <LeaderboardNav />

        {/* Error */}
        {error && (
          <div className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">
            Failed to load achievements: {error}
          </div>
        )}

        {/* Loading */}
        {loading && <AchievementsSkeleton />}

        {/* Content */}
        {data && (
          <>
            {/* Summary bar */}
            <SummaryBar
              totalUnlocked={data.summary.totalUnlocked}
              totalAchievements={data.summary.totalAchievements}
              diamondCount={data.summary.diamondCount}
              currentStreak={data.summary.currentStreak}
            />

            {/* Category sections */}
            {CATEGORY_ORDER.map((category) => {
              const achievements = grouped.get(category);
              if (!achievements || achievements.length === 0) return null;

              return (
                <Fragment key={category}>
                  <div className="space-y-3 animate-fade-up" style={{ animationDelay: "180ms" }}>
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {CATEGORY_LABELS[category]}
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {achievements.map((ach, i) => (
                        <AchievementCard key={ach.id} achievement={ach} index={i} />
                      ))}
                    </div>
                  </div>
                </Fragment>
              );
            })}
          </>
        )}
      </main>
    </>
  );
}
