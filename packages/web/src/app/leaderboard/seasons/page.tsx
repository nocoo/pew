"use client";

import Link from "next/link";
import Image from "next/image";
import {
  Trophy,
  ArrowLeft,
  Calendar,
  Users,
  Camera,
  Zap,
  Github,
  ShieldCheck,
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
// Check-style ruling lines (right-side texture)
// ---------------------------------------------------------------------------

function CheckRuling() {
  return (
    <div
      className="pointer-events-none absolute inset-y-0 right-0 w-1/3 opacity-[0.04]"
      aria-hidden="true"
    >
      <div className="absolute inset-0 flex flex-col justify-evenly">
        <div className="h-px bg-foreground" />
        <div className="h-px bg-foreground" />
        <div className="h-px bg-foreground" />
        <div className="h-px bg-foreground" />
        <div className="h-px bg-foreground" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Season card — unified with main leaderboard row style
// ---------------------------------------------------------------------------

function SeasonCard({ season, index }: { season: SeasonListItem; index: number }) {
  return (
    <Link
      href={`/leaderboard/seasons/${season.slug}`}
      className={cn(
        "group relative block overflow-hidden rounded-[var(--radius-card)] bg-secondary px-4 py-4 transition-colors animate-fade-up",
        "hover:bg-accent cursor-pointer",
      )}
      style={{ animationDelay: `${index * 50}ms` }}
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
    <div className="rounded-[var(--radius-card)] bg-secondary px-4 py-4">
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
    <div className="relative flex min-h-screen flex-col bg-background">
      {/* Top-right icons */}
      <div className="absolute right-6 top-4 z-50 flex items-center gap-1">
        <a
          href="/privacy"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-[color] duration-200 hover:text-foreground"
          aria-label="Privacy policy"
        >
          <ShieldCheck className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
        </a>
        <a
          href="https://github.com/nicnocquee/pew"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-[color] duration-200 hover:text-foreground"
          aria-label="View source on GitHub"
        >
          <Github className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
        </a>
        <ThemeToggle />
      </div>

      {/* Header */}
      <header className="mx-auto w-full max-w-3xl px-6 pt-10 pb-2">
        <div
          className="flex items-center gap-5 animate-fade-up"
          style={{ animationDelay: "0ms" }}
        >
          <Link
            href="/"
            className="shrink-0 hover:opacity-80 transition-opacity"
          >
            <Image
              src="/logo-80.png"
              alt="pew"
              width={48}
              height={48}
            />
          </Link>
          <div className="flex flex-col">
            <h1 className="tracking-tight text-foreground">
              <span className="text-[47px] font-bold font-handwriting leading-none mr-2">pew</span>
              <span className="text-[19px] font-normal text-muted-foreground">
                Seasons
              </span>
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Compete as teams across time-boxed seasons.
            </p>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-4 space-y-4">
        {/* Controls row */}
        <div
          className="relative z-20 flex items-center gap-3 animate-fade-up"
          style={{ animationDelay: "180ms" }}
        >
          <Link
            href="/leaderboard"
            className={cn(
              "flex items-center gap-2 rounded-lg bg-secondary px-3 py-[10px] text-sm font-medium transition-colors shrink-0",
              "text-muted-foreground hover:text-foreground hover:bg-accent",
            )}
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
            Back to Leaderboard
          </Link>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-[var(--radius-card)] bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && !data && (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <SeasonCardSkeleton key={i} />
            ))}
          </div>
        )}

        {/* Content */}
        {data && (
          <div className="space-y-3">
            {data.seasons.length === 0 ? (
              <div className="rounded-[var(--radius-card)] bg-secondary p-8 text-center text-sm text-muted-foreground">
                <Trophy className="mx-auto h-12 w-12 mb-4 opacity-30" />
                <p className="text-lg">No seasons yet</p>
                <p className="text-sm mt-1">
                  Check back later for upcoming competitions.
                </p>
              </div>
            ) : (
              data.seasons.map((season, i) => (
                <SeasonCard key={season.id} season={season} index={i} />
              ))
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="px-6 py-3">
        <p className="text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} pew.md
          <span className="mx-1.5">·</span>
          <a href="/privacy" className="hover:text-foreground transition-colors">
            Privacy
          </a>
        </p>
      </footer>
    </div>
  );
}
