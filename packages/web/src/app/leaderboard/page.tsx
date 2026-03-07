"use client";

import { useState } from "react";
import Link from "next/link";
import { Zap, Trophy, Medal, Award } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTokens } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useLeaderboard,
  type LeaderboardPeriod,
  type LeaderboardEntry,
} from "@/hooks/use-leaderboard";

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

function LeaderboardRow({ entry }: { entry: LeaderboardEntry }) {
  const { rank, user, total_tokens, input_tokens, output_tokens } = entry;
  const displayName = user.name ?? "Anonymous";
  const initial = displayName[0]?.toUpperCase() ?? "?";

  const content = (
    <div
      className={cn(
        "flex items-center gap-4 rounded-[var(--radius-card)] bg-secondary px-4 py-3 transition-colors",
        user.slug && "hover:bg-accent cursor-pointer",
        rank <= 3 && "ring-1 ring-border/50",
      )}
    >
      {/* Rank */}
      <div className="flex w-8 shrink-0 items-center justify-center">
        <RankBadge rank={rank} />
      </div>

      {/* Avatar + Name */}
      <div className="flex flex-1 items-center gap-3 min-w-0">
        <Avatar className="h-8 w-8 shrink-0">
          {user.image && (
            <AvatarImage src={user.image} alt={displayName} />
          )}
          <AvatarFallback className="text-xs bg-primary text-primary-foreground">
            {initial}
          </AvatarFallback>
        </Avatar>
        <span className="text-sm font-medium text-foreground truncate">
          {displayName}
        </span>
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
  const { data, loading, error } = useLeaderboard({ period });

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="mx-auto max-w-3xl flex items-center justify-between px-4 md:px-6 h-14">
          <Link
            href="/"
            className="flex items-center gap-2 text-foreground hover:text-primary transition-colors"
          >
            <Zap className="h-5 w-5 text-primary" strokeWidth={1.5} />
            <span className="font-bold tracking-tighter">zebra</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 md:px-6 py-6 md:py-8 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold font-display">Leaderboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Who&apos;s burning the most tokens?
          </p>
        </div>

        {/* Period tabs */}
        <div className="flex gap-1 rounded-lg bg-secondary p-1">
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

        {/* Error */}
        {error && (
          <div className="rounded-[var(--radius-card)] bg-destructive/10 p-4 text-sm text-destructive">
            Failed to load leaderboard: {error}
          </div>
        )}

        {/* Loading */}
        {loading && <LeaderboardSkeleton />}

        {/* Content */}
        {!loading && data && (
          <div className="space-y-2">
            {data.entries.length === 0 ? (
              <div className="rounded-[var(--radius-card)] bg-secondary p-8 text-center text-sm text-muted-foreground">
                No usage data for this period yet.
              </div>
            ) : (
              data.entries.map((entry) => (
                <LeaderboardRow key={entry.rank} entry={entry} />
              ))
            )}
          </div>
        )}

        {/* Footer */}
        <footer className="pt-4 pb-8 text-center">
          <p className="text-xs text-muted-foreground">
            Powered by{" "}
            <Link href="/" className="text-primary hover:underline">
              Zebra
            </Link>{" "}
            — Track your AI coding tool usage
          </p>
        </footer>
      </main>
    </div>
  );
}
