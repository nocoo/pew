"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Trophy, Medal, Award, Users } from "lucide-react";
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
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const { data, loading, error } = useLeaderboard({
    period,
    teamId: selectedTeam,
  });

  // Fetch user's teams for the filter dropdown
  const fetchTeams = useCallback(async () => {
    try {
      const res = await fetch("/api/teams");
      if (res.ok) {
        const json = await res.json();
        setTeams(json.teams ?? []);
      }
    } catch {
      // Silently fail — teams are optional
    }
  }, []);

  useEffect(() => {
    fetchTeams();
  }, [fetchTeams]);

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold font-display">Leaderboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Who&apos;s burning the most tokens?
        </p>
      </div>

      {/* Controls row */}
      <div className="flex flex-col sm:flex-row gap-3">
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
    </div>
  );
}
