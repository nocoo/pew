"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  Github,
  Trophy,
  Medal,
  Award,
  ArrowLeft,
  Users,
  ChevronDown,
  Zap,
  Camera,
  Calendar,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTokens, formatTokensFull } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import {
  useSeasonLeaderboard,
  type SeasonTeamEntry,
} from "@/hooks/use-season-leaderboard";
import type { SeasonListItem } from "@/hooks/use-seasons";
import type { SeasonStatus } from "@pew/core";

// ---------------------------------------------------------------------------
// Slug → season ID resolver
// ---------------------------------------------------------------------------

function useSeasonIdFromSlug(slug: string) {
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      try {
        const res = await fetch("/api/seasons");
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as { seasons: SeasonListItem[] };
        const match = data.seasons.find((s) => s.slug === slug);
        if (!match) {
          throw new Error("Season not found");
        }
        if (!cancelled) {
          setSeasonId(match.id);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    resolve();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return { seasonId, loading, error };
}

// ---------------------------------------------------------------------------
// Status badge (same as seasons list page)
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<SeasonStatus, string> = {
  active:
    "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/25",
  upcoming:
    "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/25",
  ended: "bg-muted text-muted-foreground border-border",
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
// Rank decorations
// ---------------------------------------------------------------------------

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return <Trophy className="h-5 w-5 text-yellow-500" strokeWidth={1.5} />;
  }
  if (rank === 2) {
    return <Medal className="h-5 w-5 text-gray-400" strokeWidth={1.5} />;
  }
  if (rank === 3) {
    return <Award className="h-5 w-5 text-amber-600" strokeWidth={1.5} />;
  }
  return (
    <span className="flex h-5 w-5 items-center justify-center text-xs font-medium text-muted-foreground">
      {rank}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Team row with expandable members
// ---------------------------------------------------------------------------

function TeamRow({
  entry,
  index,
}: {
  entry: SeasonTeamEntry;
  index: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasMembers = entry.members && entry.members.length > 0;

  return (
    <div
      className="animate-fade-up"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <button
        onClick={() => hasMembers && setExpanded(!expanded)}
        className={cn(
          "relative flex w-full items-center gap-4 overflow-hidden rounded-[var(--radius-card)] bg-secondary px-4 py-4 text-left transition-colors",
          hasMembers && "hover:bg-accent cursor-pointer",
          entry.rank <= 3 && "ring-1 ring-border/50",
          expanded && "rounded-b-none",
        )}
      >
        {/* Check ruling texture */}
        <CheckRuling />

        {/* Rank */}
        <div className="flex w-8 shrink-0 items-center justify-center">
          <RankBadge rank={entry.rank} />
        </div>

        {/* Team name + member count */}
        <div className="flex flex-1 items-center gap-3 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <Users className="h-4 w-4 text-primary" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-medium text-foreground truncate">
              {entry.team.name}
            </span>
            {hasMembers && (
              <span className="text-[10px] text-muted-foreground">
                {entry.members!.length}{" "}
                {entry.members!.length === 1 ? "member" : "members"}
              </span>
            )}
          </div>
        </div>

        {/* Token breakdown (hidden on mobile) */}
        <div className="hidden sm:flex items-center gap-6 text-xs text-muted-foreground">
          <span title="Input tokens">
            {formatTokens(entry.input_tokens)} in
          </span>
          <span title="Output tokens">
            {formatTokens(entry.output_tokens)} out
          </span>
        </div>

        {/* Total */}
        <div className="relative z-10 shrink-0 text-right">
          <span className="font-handwriting text-[39px] leading-none tracking-tight text-foreground">
            {formatTokensFull(entry.total_tokens)}
          </span>
        </div>

        {/* Expand indicator */}
        {hasMembers && (
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
              expanded && "rotate-180",
            )}
          />
        )}
      </button>

      {/* Expanded member list */}
      {expanded && hasMembers && (
        <div className="rounded-b-[var(--radius-card)] border-t border-border bg-secondary/50 px-4 py-2 space-y-1">
          {entry.members!.map((member) => {
            const displayName = member.name ?? "Anonymous";
            const initial = displayName[0]?.toUpperCase() ?? "?";
            return (
              <div
                key={member.user_id}
                className="flex items-center gap-3 py-1.5 px-10"
              >
                <Avatar className="h-6 w-6 shrink-0">
                  {member.image && (
                    <AvatarImage src={member.image} alt={displayName} />
                  )}
                  <AvatarFallback className="text-[10px] bg-primary text-primary-foreground">
                    {initial}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm text-foreground truncate flex-1 min-w-0">
                  {displayName}
                </span>
                <div className="hidden sm:flex items-center gap-4 text-xs text-muted-foreground">
                  <span>{formatTokens(member.input_tokens)} in</span>
                  <span>{formatTokens(member.output_tokens)} out</span>
                </div>
                <span className="text-sm font-medium text-foreground tabular-nums shrink-0">
                  {formatTokensFull(member.total_tokens)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function LeaderboardSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 rounded-[var(--radius-card)] bg-secondary px-4 py-4"
        >
          <Skeleton className="h-5 w-8" />
          <Skeleton className="h-8 w-8 rounded-full" />
          <Skeleton className="h-4 w-32" />
          <div className="flex-1" />
          <Skeleton className="h-6 w-28" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SeasonLeaderboardPage() {
  const { slug } = useParams<{ slug: string }>();
  const {
    seasonId,
    loading: resolving,
    error: resolveError,
  } = useSeasonIdFromSlug(slug);
  const { data, loading, refreshing, error } =
    useSeasonLeaderboard(seasonId);

  const isLoading = resolving || (loading && !data);

  return (
    <div className="relative flex min-h-screen flex-col bg-background">
      {/* Top-right icons — same pattern as main leaderboard */}
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
            {data ? (
              <>
                <h1 className="tracking-tight text-foreground">
                  <span className="text-[47px] font-bold font-handwriting leading-none mr-2">
                    {data.season.name}
                  </span>
                </h1>
                <div className="mt-0.5 flex items-center gap-2 flex-wrap">
                  <StatusBadge status={data.season.status} />
                  {data.season.is_snapshot ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                      <Camera className="h-3 w-3" />
                      Final Results
                    </span>
                  ) : data.season.status === "active" ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2.5 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
                      <Zap className="h-3 w-3" />
                      Live
                    </span>
                  ) : null}
                  <span className="text-sm text-muted-foreground inline-flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" />
                    {data.season.start_date} &mdash; {data.season.end_date}
                  </span>
                </div>
              </>
            ) : isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-48" />
                <Skeleton className="h-4 w-56" />
              </div>
            ) : null}
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
          {/* Back link */}
          <Link
            href="/leaderboard/seasons"
            className={cn(
              "flex items-center gap-2 rounded-lg bg-secondary px-3 py-[10px] text-sm font-medium transition-colors",
              "text-muted-foreground hover:text-foreground hover:bg-accent",
            )}
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
            Back to Seasons
          </Link>
        </div>

        {/* Error */}
        {(resolveError || error) && (
          <div className="rounded-[var(--radius-card)] bg-destructive/10 p-4 text-sm text-destructive">
            {resolveError || error}
          </div>
        )}

        {/* Loading */}
        {isLoading && <LeaderboardSkeleton />}

        {/* Content */}
        {data && (
          <div
            className={cn(
              "space-y-3 transition-opacity duration-200",
              refreshing && "opacity-60",
            )}
          >
            {data.entries.length === 0 ? (
              <div className="rounded-[var(--radius-card)] bg-secondary p-8 text-center text-sm text-muted-foreground">
                <Trophy className="mx-auto h-12 w-12 mb-4 opacity-30" />
                <p className="text-lg">No teams registered yet</p>
                <p className="text-sm mt-1">
                  Teams need to register before they appear on the leaderboard.
                </p>
              </div>
            ) : (
              data.entries.map((entry, i) => (
                <TeamRow key={entry.team.id} entry={entry} index={i} />
              ))
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="px-6 py-3">
        <p className="text-center text-xs text-muted-foreground">
          &copy; {new Date().getFullYear()} pew.md
          <span className="mx-1.5">&middot;</span>
          <a href="/privacy" className="hover:text-foreground transition-colors">
            Privacy
          </a>
        </p>
      </footer>
    </div>
  );
}
