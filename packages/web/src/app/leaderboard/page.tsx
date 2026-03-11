"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { Github, Trophy, Medal, Award, Users, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTokens } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import {
  useLeaderboard,
  type LeaderboardPeriod,
  type LeaderboardEntry,
} from "@/hooks/use-leaderboard";
import { useAdmin } from "@/hooks/use-admin";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Team {
  id: string;
  name: string;
  slug: string;
}

// ---------------------------------------------------------------------------
// Period tabs
// ---------------------------------------------------------------------------

const PERIODS: { value: LeaderboardPeriod; label: string }[] = [
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "all", label: "All Time" },
];

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
// Row component
// ---------------------------------------------------------------------------

function LeaderboardRow({
  entry,
  showHiddenBadge,
  index,
}: {
  entry: LeaderboardEntry;
  showHiddenBadge?: boolean;
  index: number;
}) {
  const { rank, user, teams, total_tokens, input_tokens, output_tokens } =
    entry;
  const displayName = user.name ?? "Anonymous";
  const initial = displayName[0]?.toUpperCase() ?? "?";

  const content = (
    <div
      className={cn(
        "flex items-center gap-4 rounded-[var(--radius-card)] bg-secondary px-4 py-3 transition-colors animate-fade-up",
        user.slug && "hover:bg-accent cursor-pointer",
        rank <= 3 && "ring-1 ring-border/50",
      )}
      style={{ animationDelay: `${index * 40}ms` }}
    >
      {/* Rank */}
      <div className="flex w-8 shrink-0 items-center justify-center">
        <RankBadge rank={rank} />
      </div>

      {/* Avatar + Name + Teams */}
      <div className="flex flex-1 items-center gap-3 min-w-0">
        <Avatar className="h-8 w-8 shrink-0">
          {user.image && <AvatarImage src={user.image} alt={displayName} />}
          <AvatarFallback className="text-xs bg-primary text-primary-foreground">
            {initial}
          </AvatarFallback>
        </Avatar>
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground truncate">
              {displayName}
            </span>
            {showHiddenBadge && user.is_public === false && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                <EyeOff className="h-3 w-3" strokeWidth={1.5} />
                hidden
              </span>
            )}
          </div>
          {teams.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              {teams.map((team) => (
                <span
                  key={team.id}
                  className="text-[10px] leading-tight text-muted-foreground bg-muted px-1.5 py-0.5 rounded"
                >
                  {team.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Token breakdown (hidden on mobile) */}
      <div className="hidden sm:flex items-center gap-6 text-xs text-muted-foreground">
        <span title="Input tokens">{formatTokens(input_tokens)} in</span>
        <span title="Output tokens">{formatTokens(output_tokens)} out</span>
      </div>

      {/* Total */}
      <div className="shrink-0 text-right">
        <span className="text-sm font-semibold text-foreground font-display">
          {formatTokens(total_tokens)}
        </span>
      </div>
    </div>
  );

  if (user.slug) {
    return <Link href={`/u/${user.slug}`}>{content}</Link>;
  }
  return content;
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function LeaderboardSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 10 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 rounded-[var(--radius-card)] bg-secondary px-4 py-3"
        >
          <Skeleton className="h-5 w-8" />
          <Skeleton className="h-8 w-8 rounded-full" />
          <Skeleton className="h-4 w-32" />
          <div className="flex-1" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function LeaderboardPage() {
  const [period, setPeriod] = useState<LeaderboardPeriod>("week");
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [showAll, setShowAll] = useState(false);
  const { isAdmin } = useAdmin();
  const { data, loading, refreshing, error } = useLeaderboard({
    period,
    teamId: selectedTeam,
    admin: showAll,
  });

  // Fetch user's teams for the filter dropdown (only works if logged in)
  const fetchTeams = useCallback(async () => {
    try {
      const res = await fetch("/api/teams");
      if (res.ok) {
        const json = await res.json();
        setTeams(json.teams ?? []);
      }
    } catch {
      // Silently fail — teams are optional, viewer may not be logged in
    }
  }, []);

  useEffect(() => {
    fetchTeams();
  }, [fetchTeams]);

  return (
    <div className="relative flex min-h-screen flex-col bg-background">
      {/* Top-right icons — same pattern as landing page */}
      <div className="absolute right-6 top-4 z-50 flex items-center gap-1">
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
          className="flex items-center gap-3 animate-fade-up"
          style={{ animationDelay: "0ms" }}
        >
          <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <Image
              src="/logo-24.png"
              alt="Pew"
              width={24}
              height={24}
              className="shrink-0"
            />
            <span className="font-bold tracking-tighter text-foreground">
              pew
            </span>
          </Link>
        </div>
        <h1
          className="mt-6 text-2xl font-bold font-display animate-fade-up"
          style={{ animationDelay: "60ms" }}
        >
          Leaderboard
        </h1>
        <p
          className="mt-1 text-sm text-muted-foreground animate-fade-up"
          style={{ animationDelay: "120ms" }}
        >
          Who&apos;s burning the most tokens?
        </p>
      </header>

      {/* Main content */}
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-4 space-y-4">
        {/* Controls row */}
        <div
          className="flex flex-col sm:flex-row gap-3 animate-fade-up"
          style={{ animationDelay: "180ms" }}
        >
          {/* Period tabs */}
          <div className="flex gap-1 rounded-lg bg-secondary p-1 flex-1">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                onClick={() => setPeriod(p.value)}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  period === p.value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Team filter */}
          {teams.length > 0 && (
            <div className="flex gap-1 rounded-lg bg-secondary p-1 shrink-0">
              <button
                onClick={() => setSelectedTeam(null)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  !selectedTeam
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Global
              </button>
              {teams.map((team) => (
                <button
                  key={team.id}
                  onClick={() => setSelectedTeam(team.id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    selectedTeam === team.id
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Users className="h-3.5 w-3.5" strokeWidth={1.5} />
                  {team.name}
                </button>
              ))}
            </div>
          )}

          {/* Admin toggle */}
          {isAdmin && (
            <label className="flex items-center gap-2 shrink-0 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showAll}
                onChange={(e) => setShowAll(e.target.checked)}
                className="h-4 w-4 rounded border-border accent-primary"
              />
              <span className="text-xs font-medium text-muted-foreground">
                Show All
              </span>
            </label>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-[var(--radius-card)] bg-destructive/10 p-4 text-sm text-destructive">
            Failed to load leaderboard: {error}
          </div>
        )}

        {/* Loading — skeleton only on initial load */}
        {loading && !data && <LeaderboardSkeleton />}

        {/* Content — stays visible during refreshing with opacity transition */}
        {data && (
          <div
            className={cn(
              "space-y-2 transition-opacity duration-200",
              refreshing && "opacity-60",
            )}
          >
            {data.entries.length === 0 ? (
              <div className="rounded-[var(--radius-card)] bg-secondary p-8 text-center text-sm text-muted-foreground">
                No usage data for this period yet.
              </div>
            ) : (
              data.entries.map((entry, i) => (
                <LeaderboardRow
                  key={entry.rank}
                  entry={entry}
                  showHiddenBadge={showAll}
                  index={i}
                />
              ))
            )}
          </div>
        )}
      </main>

      {/* Footer — same pattern as landing page */}
      <footer className="px-6 py-3">
        <p className="text-center text-xs text-muted-foreground">
          Powered by{" "}
          <Link href="/" className="text-primary hover:underline">
            pew
          </Link>{" "}
          &mdash; AI token usage tracker
        </p>
      </footer>
    </div>
  );
}
