"use client";

import { useMemo, Fragment, useState, useCallback } from "react";
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
  ChevronDown,
  ChevronUp,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  useAchievements,
  useAchievementMembers,
  type Achievement,
  type EarnedByUser,
  type AchievementMember,
} from "@/hooks/use-achievements";
import {
  type AchievementTier,
  type AchievementCategory,
  CATEGORY_LABELS,
  formatShortTokens,
} from "@/lib/achievement-helpers";
import { LeaderboardNav } from "@/components/leaderboard/leaderboard-nav";
import { LeaderboardPageTitle } from "@/components/leaderboard/leaderboard-page-title";
import { Skeleton } from "@/components/ui/skeleton";
import { UserProfileDialog } from "@/components/user-profile-dialog";

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
  progressBg: string;
}> = {
  locked: {
    gradient: "from-muted/50 to-muted/30",
    iconColor: "text-muted-foreground/50",
    ringColor: "stroke-muted-foreground/30",
    glow: "",
    badgeColor: "text-muted-foreground",
    badgeBg: "bg-muted",
    progressBg: "bg-muted-foreground/40",
  },
  bronze: {
    gradient: "from-chart-7/30 to-chart-7/10",
    iconColor: "text-chart-7",
    ringColor: "stroke-chart-7",
    glow: "shadow-[0_0_12px_-2px] shadow-chart-7/30",
    badgeColor: "text-chart-7",
    badgeBg: "bg-chart-7/10",
    progressBg: "bg-chart-7",
  },
  silver: {
    gradient: "from-chart-2/30 to-chart-2/10",
    iconColor: "text-chart-2",
    ringColor: "stroke-chart-2",
    glow: "shadow-[0_0_12px_-2px] shadow-chart-2/30",
    badgeColor: "text-chart-2",
    badgeBg: "bg-chart-2/10",
    progressBg: "bg-chart-2",
  },
  gold: {
    gradient: "from-chart-6/30 to-chart-6/10",
    iconColor: "text-chart-6",
    ringColor: "stroke-chart-6",
    glow: "shadow-[0_0_16px_-2px] shadow-chart-6/40",
    badgeColor: "text-chart-6",
    badgeBg: "bg-chart-6/10",
    progressBg: "bg-chart-6",
  },
  diamond: {
    gradient: "from-primary/30 to-chart-8/20",
    iconColor: "text-primary",
    ringColor: "stroke-primary",
    glow: "shadow-[0_0_20px_-2px] shadow-primary/50",
    badgeColor: "text-primary",
    badgeBg: "bg-primary/10",
    progressBg: "bg-primary",
  },
};

// ---------------------------------------------------------------------------
// Progress Ring
// ---------------------------------------------------------------------------

const RING_SIZE = 56;
const RING_STROKE = 3;

interface AchievementRingProps {
  progress: number;
  tier: AchievementTier;
  icon: string;
  size?: number;
}

function AchievementRing({ progress, tier, icon, size = RING_SIZE }: AchievementRingProps) {
  const radius = (size - RING_STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - progress);
  const styles = TIER_STYLES[tier];
  const Icon = ICON_MAP[icon] ?? Sparkles;
  const isUnlocked = tier !== "locked";
  const iconSize = size * 0.36;

  return (
    <div className={cn("relative inline-flex items-center justify-center shrink-0", styles.glow, "rounded-full")}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={RING_STROKE}
          className="stroke-muted-foreground/10"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={cn(styles.ringColor, "transition-[stroke-dashoffset] duration-700 ease-out")}
        />
      </svg>
      <div className={cn(
        "absolute rounded-full bg-gradient-to-br flex items-center justify-center",
        styles.gradient
      )} style={{ inset: size * 0.07 }}>
        <Icon
          className={cn(styles.iconColor, isUnlocked && tier !== "bronze" && "drop-shadow-sm")}
          style={{ width: iconSize, height: iconSize }}
          strokeWidth={1.5}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// User profile dialog target type
// ---------------------------------------------------------------------------

interface UserTarget {
  id: string;
  slug: string | null;
  name: string;
  image: string | null;
}

// ---------------------------------------------------------------------------
// Earned By Avatars (compact preview)
// ---------------------------------------------------------------------------

interface EarnedByAvatarsProps {
  earnedBy: EarnedByUser[];
  totalEarned: number;
  onUserClick: (user: UserTarget) => void;
}

function EarnedByAvatars({ earnedBy, totalEarned, onUserClick }: EarnedByAvatarsProps) {
  if (earnedBy.length === 0) return null;

  const displayCount = Math.min(earnedBy.length, 4);
  const remainingCount = totalEarned - displayCount;

  return (
    <div className="flex items-center gap-1.5 mt-2">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Earned by</span>
      <div className="flex -space-x-1.5">
        {earnedBy.slice(0, displayCount).map((user) => (
          <button
            key={user.id}
            type="button"
            aria-label={`View ${user.name}'s profile`}
            onClick={(e) => {
              e.stopPropagation();
              onUserClick({ id: user.id, slug: user.slug, name: user.name, image: user.image });
            }}
            className="cursor-pointer rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Avatar className="h-5 w-5 ring-2 ring-background hover:ring-primary transition-all">
              {user.image && <AvatarImage src={user.image} alt={user.name} />}
              <AvatarFallback className="text-[8px] bg-muted text-muted-foreground">
                {user.name[0]?.toUpperCase() ?? "?"}
              </AvatarFallback>
            </Avatar>
          </button>
        ))}
      </div>
      {remainingCount > 0 && (
        <span className="text-[10px] text-muted-foreground">
          +{remainingCount} more
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Member List (expanded view)
// ---------------------------------------------------------------------------

interface MemberListProps {
  members: AchievementMember[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  onLoadMore: () => void;
  unit: string;
  onUserClick: (user: UserTarget) => void;
}

function MemberList({ members, loading, error, hasMore, onLoadMore, unit, onUserClick }: MemberListProps) {
  if (error) {
    return (
      <div className="text-xs text-destructive text-center py-4">
        Failed to load members: {error}
      </div>
    );
  }

  if (members.length === 0 && !loading) {
    return (
      <div className="text-xs text-muted-foreground text-center py-4">
        No members yet. Be the first to earn this achievement!
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {members.map((member, i) => {
        const tierStyle = TIER_STYLES[member.tier];

        return (
          <button
            key={member.id}
            type="button"
            onClick={() => onUserClick({ id: member.id, slug: member.slug, name: member.name, image: member.image })}
            className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors text-left"
          >
            <span className="text-xs text-muted-foreground w-5 text-right tabular-nums">
              {i + 1}
            </span>
            <Avatar className="h-8 w-8">
              {member.image && <AvatarImage src={member.image} alt={member.name} />}
              <AvatarFallback className="text-xs bg-muted text-muted-foreground">
                {member.name[0]?.toUpperCase() ?? "?"}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">{member.name}</span>
                <span className={cn(
                  "shrink-0 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider",
                  tierStyle.badgeBg,
                  tierStyle.badgeColor,
                )}>
                  {member.tier}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                {formatShortTokens(member.currentValue)} {unit}
              </div>
            </div>
          </button>
        );
      })}

      {loading && (
        <div className="flex items-center justify-center py-2">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}

      {hasMore && !loading && (
        <button
          type="button"
          onClick={onLoadMore}
          className="w-full text-xs text-muted-foreground hover:text-foreground py-2 transition-colors"
        >
          Load more...
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Achievement Card (Expandable)
// ---------------------------------------------------------------------------

interface AchievementCardProps {
  achievement: Achievement;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
  onUserClick: (user: UserTarget) => void;
}

function AchievementCard({ achievement, index, isExpanded, onToggle, onUserClick }: AchievementCardProps) {
  const styles = TIER_STYLES[achievement.tier];
  const isUnlocked = achievement.tier !== "locked";
  const isMaxed = achievement.tier === "diamond";
  const pct = Math.round(achievement.progress * 100);

  // Fetch members when expanded
  const { data: membersData, loading: membersLoading, error: membersError, hasMore, loadMore } = useAchievementMembers(
    isExpanded ? achievement.id : null
  );

  return (
    <div
      className={cn(
        "flex flex-col rounded-xl p-4 transition-all animate-fade-up",
        isUnlocked ? "bg-secondary/80 hover:bg-card" : "bg-muted/30 hover:bg-muted/50",
        isExpanded && "ring-1 ring-border",
      )}
      style={{ animationDelay: `${Math.min(index * 30, 400)}ms` }}
    >
      {/* Clickable header */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        className="w-full text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-lg"
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
              <span className="ml-auto shrink-0 text-muted-foreground">
                {isExpanded ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
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
              className={cn("h-full rounded-full transition-[width] duration-700 ease-out", styles.progressBg)}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* Earned by avatars (only when collapsed) */}
        {!isExpanded && (
          <EarnedByAvatars
            earnedBy={achievement.earnedBy}
            totalEarned={achievement.totalEarned}
            onUserClick={onUserClick}
          />
        )}
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-border">
          {/* Tier thresholds */}
          <div className="mb-4">
            <div className="text-xs font-medium text-muted-foreground mb-2">Tier Thresholds</div>
            <div className="flex gap-2 flex-wrap">
              {(["bronze", "silver", "gold", "diamond"] as const).map((tier, i) => {
                const tierStyle = TIER_STYLES[tier];
                const threshold = achievement.tiers[i] ?? 0;
                const isReached = achievement.currentValue >= threshold;
                return (
                  <div
                    key={tier}
                    className={cn(
                      "px-2 py-1 rounded text-xs",
                      isReached ? tierStyle.badgeBg : "bg-muted/50",
                      isReached ? tierStyle.badgeColor : "text-muted-foreground",
                    )}
                  >
                    <span className="font-medium capitalize">{tier}</span>
                    <span className="ml-1 tabular-nums">{formatShortTokens(threshold)}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Members list */}
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-2">
              Leaderboard {achievement.totalEarned > 0 && `(${achievement.totalEarned})`}
            </div>
            <MemberList
              members={membersData?.members ?? []}
              loading={membersLoading}
              error={membersError}
              hasMore={hasMore}
              onLoadMore={loadMore}
              unit={achievement.unit}
              onUserClick={onUserClick}
            />
          </div>
        </div>
      )}
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
    <div className="flex flex-wrap items-center gap-4 rounded-xl bg-secondary/50 p-4 text-sm animate-fade-up" style={{ animationDelay: "120ms" }}>
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
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // User profile dialog state
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [profileTarget, setProfileTarget] = useState<UserTarget | null>(null);

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

  const handleToggle = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const handleUserClick = useCallback((user: UserTarget) => {
    setProfileTarget(user);
    setProfileDialogOpen(true);
  }, []);

  return (
    <>
      {/* Header */}
      <LeaderboardPageTitle
        subtitle="Achievements"
        description="Track your AI coding milestones and compete with others."
      />

      {/* Main content */}
      <main className="flex-1 py-4 space-y-4">
        {/* Tab nav */}
        <LeaderboardNav />

        {/* Error */}
        {error && (
          <div className="rounded-[var(--radius-card)] bg-destructive/10 p-4 text-sm text-destructive">
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
                        <AchievementCard
                          key={ach.id}
                          achievement={ach}
                          index={i}
                          isExpanded={expandedId === ach.id}
                          onToggle={() => handleToggle(ach.id)}
                          onUserClick={handleUserClick}
                        />
                      ))}
                    </div>
                  </div>
                </Fragment>
              );
            })}
          </>
        )}
      </main>

      {/* User profile dialog - lazy mounted to avoid useAdmin/useSeasons firing while closed */}
      {profileDialogOpen && (
        <UserProfileDialog
          open={profileDialogOpen}
          onOpenChange={setProfileDialogOpen}
          slug={profileTarget?.slug ?? profileTarget?.id ?? null}
          name={profileTarget?.name ?? null}
          image={profileTarget?.image ?? null}
        />
      )}
    </>
  );
}
