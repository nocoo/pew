"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  Users,
  ChevronDown,
  ChevronRight,
  Zap,
  Camera,
  Calendar,
} from "lucide-react";
import { cn, formatTokensFull } from "@/lib/utils";
import { formatDuration } from "@/lib/date-helpers";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useSeasonLeaderboard,
  type SeasonTeamEntry,
} from "@/hooks/use-season-leaderboard";
import { formatSeasonDate } from "@/lib/seasons";
import { CheckRuling } from "@/components/leaderboard/check-ruling";
import { RankBadge } from "@/components/leaderboard/rank-badge";
import { StatusBadge } from "@/components/leaderboard/status-badge";
import { LeaderboardSkeleton } from "@/components/leaderboard/leaderboard-skeleton";
import { PageHeader } from "@/components/leaderboard/page-header";
import { TokenTierBadge } from "@/components/leaderboard/token-tier-badge";
import { Trophy } from "lucide-react";

// ---------------------------------------------------------------------------
// Season table header
// ---------------------------------------------------------------------------

function SeasonTableHeader() {
  return (
    <div className="animate-fade-up" style={{ animationDelay: "200ms" }}>
      <div className="flex items-center gap-3 px-4 pb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
        <span className="w-8 shrink-0 text-center">Rank</span>
        <span className="flex-1">Team</span>
        <span className="hidden sm:block w-24 shrink-0 text-right">Sessions</span>
        <span className="hidden sm:block w-24 shrink-0 text-right">Duration</span>
        <span className="w-[140px] sm:w-[220px] shrink-0 text-right">Tokens</span>
        {/* Expand chevron spacer */}
        <span className="w-4 shrink-0" />
      </div>
      <div className="h-px bg-border/50" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Breadcrumb navigation
// ---------------------------------------------------------------------------

function Breadcrumb({ seasonName }: { seasonName?: string | undefined }) {
  return (
    <nav
      className="flex items-center gap-1.5 text-sm text-muted-foreground animate-fade-up"
      style={{ animationDelay: "120ms" }}
      aria-label="Breadcrumb"
    >
      <Link
        href="/leaderboard"
        className="hover:text-foreground transition-colors"
      >
        Leaderboard
      </Link>
      <ChevronRight className="h-3.5 w-3.5" />
      <Link
        href="/leaderboard/seasons"
        className="hover:text-foreground transition-colors"
      >
        Seasons
      </Link>
      {seasonName && (
        <>
          <ChevronRight className="h-3.5 w-3.5" />
          <span className="text-foreground font-medium truncate">
            {seasonName}
          </span>
        </>
      )}
    </nav>
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
          "relative flex w-full items-center gap-3 overflow-hidden rounded-[var(--radius-card)] bg-secondary px-4 py-3 text-left transition-colors",
          hasMembers && "hover:bg-accent cursor-pointer",
          entry.rank <= 3 && "ring-1 ring-border/50",
          expanded && "rounded-b-none",
        )}
      >
        <CheckRuling />

        {/* Rank — fixed w-8, tabular-nums */}
        <div className="flex w-8 shrink-0 items-center justify-center tabular-nums">
          <RankBadge rank={entry.rank} />
        </div>

        {/* Team name + member count */}
        <div className="flex flex-1 items-center gap-3 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <Users className="h-4 w-4 text-primary" />
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground truncate">
                {entry.team.name}
              </span>
              <TokenTierBadge totalTokens={entry.total_tokens} />
            </div>
            {hasMembers && (
              <span className="text-[10px] text-muted-foreground">
                {entry.members!.length}{" "}
                {entry.members!.length === 1 ? "member" : "members"}
              </span>
            )}
          </div>
        </div>

        {/* Session count (hidden on mobile) */}
        <div className="hidden sm:block w-24 shrink-0 text-right">
          <span className="text-xs tabular-nums text-chart-2" title="Sessions">
            {entry.session_count.toLocaleString("en-US")}
          </span>
        </div>

        {/* Duration (hidden on mobile) */}
        <div className="hidden sm:block w-24 shrink-0 text-right">
          <span className="text-xs tabular-nums text-chart-7" title="Total duration">
            {formatDuration(entry.total_duration_seconds)}
          </span>
        </div>

        {/* Total */}
        <div className="relative z-10 w-[140px] sm:w-[220px] shrink-0 text-right flex items-center justify-end">
          <span className="font-handwriting text-[32px] sm:text-[39px] leading-none tracking-tight text-foreground whitespace-nowrap">
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
                className="flex items-center gap-3 py-1.5"
              >
                {/* Rank spacer — matches team row w-8 rank column */}
                <div className="w-8 shrink-0" />

                {/* Avatar + name — aligned with team icon + name */}
                <div className="flex flex-1 items-center gap-3 min-w-0">
                  <Avatar className="h-8 w-8 shrink-0">
                    {member.image && (
                      <AvatarImage src={member.image} alt={displayName} />
                    )}
                    <AvatarFallback className="text-[10px] bg-primary text-primary-foreground">
                      {initial}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm text-muted-foreground truncate min-w-0">
                    {displayName}
                  </span>
                </div>

                {/* Session count — same width as team row */}
                <div className="hidden sm:block w-24 shrink-0 text-right">
                  <span className="text-xs tabular-nums text-chart-2">
                    {member.session_count.toLocaleString("en-US")}
                  </span>
                </div>

                {/* Duration — same width as team row */}
                <div className="hidden sm:block w-24 shrink-0 text-right">
                  <span className="text-xs tabular-nums text-chart-7">
                    {formatDuration(member.total_duration_seconds)}
                  </span>
                </div>

                {/* Tokens — same width and font size as team row */}
                <div className="relative z-10 w-[140px] sm:w-[220px] shrink-0 text-right flex items-center justify-end">
                  <span className="font-handwriting text-[32px] sm:text-[39px] leading-none tracking-tight text-muted-foreground whitespace-nowrap">
                    {formatTokensFull(member.total_tokens)}
                  </span>
                </div>

                {/* Chevron spacer — matches team row expand indicator */}
                <div className="w-4 shrink-0" />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SeasonLeaderboardPage() {
  const { slug } = useParams<{ slug: string }>();

  // Pass slug directly to the API (supports both UUID and slug since Phase 3)
  const { data, loading, refreshing, error } = useSeasonLeaderboard(slug);

  const isLoading = loading && !data;

  return (
    <>
      {/* Header — context-aware: shows season name + status when loaded */}
      <PageHeader>
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
                {formatSeasonDate(data.season.start_date)} &mdash; {formatSeasonDate(data.season.end_date)}
              </span>
            </div>
          </>
        ) : isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-48" />
            <Skeleton className="h-4 w-56" />
          </div>
        ) : null}
      </PageHeader>

      {/* Main content */}
      <main className="flex-1 py-4 space-y-4">
        {/* Breadcrumb navigation */}
        <Breadcrumb seasonName={data?.season.name} />

        {/* Error */}
        {error && (
          <div className="rounded-[var(--radius-card)] bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Loading */}
        {isLoading && <LeaderboardSkeleton count={5} />}

        {/* Table header */}
        {data && data.entries.length > 0 && <SeasonTableHeader />}

        {/* Content */}
        {data && (
          <div
            className={cn(
              "space-y-2 transition-opacity duration-200",
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
    </>
  );
}
