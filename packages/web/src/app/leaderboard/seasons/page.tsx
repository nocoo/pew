"use client";

import Link from "next/link";
import {
  Trophy,
  ArrowLeft,
  Calendar,
  Users,
  Camera,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { useSeasons, type SeasonListItem } from "@/hooks/use-seasons";
import type { SeasonStatus } from "@pew/core";

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<SeasonStatus, string> = {
  active:
    "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/25",
  upcoming:
    "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/25",
  ended:
    "bg-muted text-muted-foreground border-border",
};

const STATUS_LABELS: Record<SeasonStatus, string> = {
  active: "Active",
  upcoming: "Upcoming",
  ended: "Ended",
};

function StatusBadge({ status }: { status: SeasonStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        STATUS_STYLES[status],
      )}
    >
      {status === "active" && (
        <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
      )}
      {STATUS_LABELS[status]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Season card
// ---------------------------------------------------------------------------

function SeasonCard({ season }: { season: SeasonListItem }) {
  return (
    <Link
      href={`/leaderboard/seasons/${season.slug}`}
      className={cn(
        "group block rounded-xl border bg-card p-5 transition-all",
        "hover:border-primary/30 hover:shadow-md",
        "animate-fade-up",
      )}
    >
      <div className="flex items-start justify-between gap-3">
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
              {season.start_date} &mdash; {season.end_date}
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
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function SeasonCardSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-5">
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

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Top bar */}
      <div className="fixed top-4 right-4 z-50 flex items-center gap-2">
        <ThemeToggle />
      </div>

      <main className="flex-1 mx-auto w-full max-w-3xl px-6 py-12">
        {/* Back link */}
        <Link
          href="/leaderboard"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Leaderboard
        </Link>

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Trophy className="h-8 w-8 text-primary" />
            Seasons
          </h1>
          <p className="mt-2 text-muted-foreground">
            Compete as teams across time-boxed seasons. Rankings are based on
            total token usage within the season period.
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive mb-6">
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && !data && (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <SeasonCardSkeleton key={i} />
            ))}
          </div>
        )}

        {/* Content */}
        {data && (
          <div className="space-y-4">
            {data.seasons.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Trophy className="mx-auto h-12 w-12 mb-4 opacity-30" />
                <p className="text-lg">No seasons yet</p>
                <p className="text-sm mt-1">
                  Check back later for upcoming competitions.
                </p>
              </div>
            ) : (
              data.seasons.map((season, i) => (
                <div
                  key={season.id}
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  <SeasonCard season={season} />
                </div>
              ))
            )}
          </div>
        )}
      </main>
    </div>
  );
}
