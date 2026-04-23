"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  Trophy,
  Calendar,
  Users,
  Camera,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TIMELINE_DOT_COLORS } from "@/lib/season-status-config";
import { Skeleton } from "@/components/ui/skeleton";
import { useSeasons, type SeasonListItem } from "@/hooks/use-seasons";
import { formatSeasonDate } from "@/lib/seasons";
import { CheckRuling } from "@/components/leaderboard/check-ruling";
import { StatusBadge } from "@/components/leaderboard/status-badge";
import { LeaderboardNav } from "@/components/leaderboard/leaderboard-nav";
import { LeaderboardPageTitle } from "@/components/leaderboard/leaderboard-page-title";

// ---------------------------------------------------------------------------
// Timeline dot — status indicator with optional pulse for active seasons
// ---------------------------------------------------------------------------

function TimelineDot({ status }: { status: "active" | "upcoming" | "ended" }) {
  const baseClass = "h-3 w-3 rounded-full shrink-0";

  if (status === "active") {
    return (
      <span className="relative flex h-3 w-3 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
        <span className={cn(baseClass, "relative", TIMELINE_DOT_COLORS[status])} />
      </span>
    );
  }

  return <span className={cn(baseClass, TIMELINE_DOT_COLORS[status])} />;
}

// ---------------------------------------------------------------------------
// Season card — unified with main leaderboard row style
// ---------------------------------------------------------------------------

function SeasonCard({
  season,
  index,
  isLast,
}: {
  season: SeasonListItem;
  index: number;
  isLast: boolean;
}) {
  return (
    <div
      className="relative flex gap-4 animate-fade-up"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      {/* Timeline column — dot + connector line */}
      <div className="relative flex flex-col items-center pt-4">
        <TimelineDot status={season.status} />
        {/* Vertical connector — extends through gap to next card, hidden for last item */}
        {!isLast && (
          <div className="absolute top-7 left-1/2 -translate-x-1/2 w-0.5 h-[calc(100%+8px-4px)] bg-border" />
        )}
      </div>

      {/* Card content */}
      <Link
        href={`/leaderboard/seasons/${season.slug}`}
        className={cn(
          "group relative flex-1 block overflow-hidden rounded-card bg-secondary px-4 py-3 transition-colors",
          "hover:bg-accent cursor-pointer",
        )}
      >
        <CheckRuling />

        <div className="relative z-10 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold tracking-tight group-hover:text-primary transition-colors">
                {season.name}
              </h3>
              <StatusBadge status={season.status} />
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                {formatSeasonDate(season.start_date)} &mdash; {formatSeasonDate(season.end_date)}
              </span>
              <span className="inline-flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                {season.team_count} {season.team_count === 1 ? "team" : "teams"}
              </span>
              {season.has_snapshot && (
                <span className="inline-flex items-center gap-1">
                  <Camera className="h-3.5 w-3.5" />
                  Final Results
                </span>
              )}
              {season.status === "active" && !season.has_snapshot && (
                <span className="inline-flex items-center gap-1">
                  <Zap className="h-3.5 w-3.5" />
                  Live
                </span>
              )}
            </div>
          </div>

          <Trophy className="h-5 w-5 text-muted-foreground/50 group-hover:text-primary/50 transition-colors shrink-0 mt-1" />
        </div>
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function SeasonCardSkeleton() {
  return (
    <div className="rounded-card bg-secondary px-4 py-3">
      <div className="flex items-start justify-between">
        <div className="flex-1 space-y-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <div className="flex gap-4">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-20" />
          </div>
        </div>
        <Skeleton className="h-5 w-5 rounded" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SeasonsPage() {
  const { data, loading, error } = useSeasons();

  // Sort seasons chronologically (newest first by end_date)
  const seasons = data?.seasons;
  const sortedSeasons = useMemo(() => {
    if (!seasons) return [];
    return [...seasons].sort(
      (a, b) => new Date(b.end_date).getTime() - new Date(a.end_date).getTime()
    );
  }, [seasons]);

  return (
    <>
      {/* Header */}
      <LeaderboardPageTitle
        subtitle="Seasons"
        description="Compete as teams across time-boxed seasons."
      />

      {/* Main content */}
      <main className="flex-1 py-4 space-y-4">
        {/* Tab nav */}
        <LeaderboardNav />

        {/* Error */}
        {error && (
          <div className="rounded-card bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && !data && (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <SeasonCardSkeleton key={i} />
            ))}
          </div>
        )}

        {/* Content — Timeline layout */}
        {data && (
          <div className="space-y-2">
            {sortedSeasons.length === 0 ? (
              <div className="rounded-card bg-secondary p-8 text-center text-sm text-muted-foreground">
                <Trophy className="mx-auto h-12 w-12 mb-4 opacity-30" />
                <p className="text-lg">No seasons yet</p>
                <p className="text-sm mt-1">
                  Check back later for upcoming competitions.
                </p>
              </div>
            ) : (
              sortedSeasons.map((season, i) => (
                <SeasonCard
                  key={season.id}
                  season={season}
                  index={i}
                  isLast={i === sortedSeasons.length - 1}
                />
              ))
            )}
          </div>
        )}
      </main>
    </>
  );
}
