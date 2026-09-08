"use client";

import { useState, useCallback } from "react";
import { useParams } from "next/navigation";
import {
  Users,
  ChevronDown,
  Zap,
  Camera,
} from "lucide-react";
import { Badge } from "@nocoo/basalt/components/badge";
import { Banner } from "@nocoo/basalt/components/banner";
import { Button } from "@nocoo/basalt/components/button";
import { Empty } from "@nocoo/basalt/components/empty";
import { Breadcrumbs } from "@nocoo/basalt/components/breadcrumbs";
import { cn, formatTokensFull } from "@/lib/utils";
import { formatDuration } from "@/lib/date-helpers";
import { getSeasonEndExclusiveISO } from "@/lib/season-helpers";

import { teamColor, withAlpha } from "@/lib/palette";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useSeasonLeaderboard,
  type SeasonTeamEntry,
  type SeasonMember,
} from "@/hooks/use-season-leaderboard";
import { CheckRuling } from "@/components/leaderboard/check-ruling";
import { SeasonCountdown } from "@/components/leaderboard/season-countdown";
import { RankBadge } from "@/components/leaderboard/rank-badge";
import { StatusBadge } from "@/components/leaderboard/status-badge";
import { LeaderboardSkeleton } from "@/components/leaderboard/leaderboard-skeleton";
import { PageHeader } from "@/components/leaderboard/page-header";
import { TokenTierBadge } from "@/components/leaderboard/token-tier-badge";
import { UserProfileDialog } from "@/components/user-profile-dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
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
        <span className="w-[160px] sm:w-[280px] shrink-0 text-right">Tokens</span>
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
  const items = [
    { href: "/leaderboard", label: "Leaderboard" },
    { href: "/leaderboard/seasons", label: "Seasons" },
    ...(seasonName ? [{ label: seasonName }] : []),
  ];
  return (
    <div className="animate-fade-up" style={{ animationDelay: "120ms" }}>
      <Breadcrumbs items={items} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Team row with expandable members
// ---------------------------------------------------------------------------

function TeamRow({
  entry,
  index,
  onMemberClick,
  onExpand,
  membersLoading,
}: {
  entry: SeasonTeamEntry;
  index: number;
  onMemberClick: (member: SeasonMember) => void;
  onExpand?: () => void;
  membersLoading?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const members = entry.members ?? [];
  const hasMembers = members.length > 0;
  const canExpand = hasMembers || membersLoading !== undefined;
  const tc = teamColor(entry.team.name);

  const handleToggle = () => {
    const newExpanded = !expanded;
    setExpanded(newExpanded);
    // Trigger lazy load when expanding for the first time
    if (newExpanded && !hasMembers && onExpand) {
      onExpand();
    }
  };

  return (
    <div
      className="animate-fade-up"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <Button
        type="button"
        variant="ghost"
        onClick={() => canExpand && handleToggle()}
        className={cn(
          "relative flex h-auto w-full items-center gap-3 overflow-hidden rounded-card bg-secondary px-4 py-3 text-left hover:bg-secondary",
          canExpand && "cursor-pointer hover:bg-accent",
          entry.rank <= 3 && "ring-1 ring-border/50",
          expanded && "rounded-b-none",
        )}
      >
        <CheckRuling />

        {/* Rank — fixed w-8, tabular-nums */}
        <div className="flex w-8 shrink-0 items-center justify-center tabular-nums">
          <RankBadge rank={entry.rank} />
        </div>

        {/* Team icon / logo */}
        <div className="flex flex-1 items-center gap-3 min-w-0">
          {entry.team.logoUrl ? (
            // biome-ignore lint/performance/noImgElement: user-supplied image URL, not amenable to next/image domain allowlist -- external team logos
            <img
              src={entry.team.logoUrl}
              alt={entry.team.name}
              className="h-8 w-8 shrink-0 rounded-full object-cover"
            />
          ) : (
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
              style={{ backgroundColor: withAlpha(tc.token, 0.15) }}
            >
              <Users className="h-4 w-4" style={{ color: tc.color }} />
            </div>
          )}
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground truncate">
                {entry.team.name}
              </span>
              <TokenTierBadge totalTokens={entry.total_tokens} />
            </div>
            {hasMembers && (
              <span className="text-[10px] text-muted-foreground">
                {members.length}{" "}
                {members.length === 1 ? "member" : "members"}
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
        <div className="relative z-10 w-[160px] sm:w-[280px] shrink-0 text-right flex items-center justify-end">
          <span className="font-handwriting text-[32px] sm:text-[39px] leading-none tracking-tight text-foreground whitespace-nowrap">
            {formatTokensFull(entry.total_tokens)}
          </span>
        </div>

        {/* Expand indicator */}
        {canExpand && (
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
              expanded && "rotate-180",
            )}
          />
        )}
      </Button>

      {/* Expanded member list */}
      {expanded && (
        <div className="rounded-b-card border-t border-border bg-secondary/50 px-4 py-2 space-y-1">
          {membersLoading ? (
            <div className="flex items-center justify-center py-4">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
              <span className="ml-2 text-sm text-muted-foreground">
                Loading members...
              </span>
            </div>
          ) : hasMembers ? (
            members.map((member) => {
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
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      onMemberClick(member);
                    }}
                    className="flex h-auto min-w-0 items-center gap-3 px-0 py-0 hover:bg-transparent hover:opacity-80"
                  >
                    <Avatar className="h-8 w-8 shrink-0">
                      {member.image && (
                        <AvatarImage src={member.image} alt={displayName} />
                      )}
                      <AvatarFallback className="text-[10px] bg-primary text-primary-foreground">
                        {initial}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm text-muted-foreground truncate">
                        {displayName}
                      </span>
                      <TokenTierBadge totalTokens={member.total_tokens} />
                    </div>
                  </Button>
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
                <div className="relative z-10 w-[160px] sm:w-[280px] shrink-0 text-right flex items-center justify-end">
                  <span className="font-handwriting text-[32px] sm:text-[39px] leading-none tracking-tight text-muted-foreground whitespace-nowrap">
                    {formatTokensFull(member.total_tokens)}
                  </span>
                </div>

                {/* Chevron spacer — matches team row expand indicator */}
                <div className="w-4 shrink-0" />
              </div>
            );
          })
          ) : (
            <Empty title="No members to display" />
          )}
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
  const { data, loading, refreshing, error, loadTeamMembers, loadingTeamIds } =
    useSeasonLeaderboard(slug);

  const isLoading = loading && !data;

  // Profile dialog state
  const [dialogMember, setDialogMember] = useState<SeasonMember | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleMemberClick = useCallback((member: SeasonMember) => {
    setDialogMember(member);
    setDialogOpen(true);
  }, []);

  // Compute exclusive end date for the dialog (end_date is inclusive at minute precision)
  const seasonEndExclusive = data?.season.end_date
    ? getSeasonEndExclusiveISO(data.season.end_date)
    : undefined;

  return (
    <TooltipProvider>
      {/* Header — context-aware: shows season name + status when loaded */}
      <PageHeader>
        {data ? (
          <>
            <h1 className="tracking-tight text-foreground">
              <span className="text-[36px] font-bold font-handwriting leading-none mr-2">
                {data.season.name}
              </span>
            </h1>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <StatusBadge status={data.season.status} />
              {data.season.is_snapshot ? (
                <Badge variant="secondary">
                  <Camera className="h-3 w-3" />
                  Final Results
                </Badge>
              ) : data.season.status === "active" ? (
                <Badge variant="success">
                  <Zap className="h-3 w-3" />
                  Live
                </Badge>
              ) : null}
              <SeasonCountdown
                status={data.season.status}
                startDate={data.season.start_date}
                endDate={data.season.end_date}
              />
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
          <Banner variant="error" description={error} />
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
              <Empty
                title="No teams registered yet"
                description="Teams need to register before they appear on the leaderboard."
                icon={<Trophy className="h-12 w-12 opacity-30" />}
                className="rounded-basalt-card bg-basalt-secondary p-8"
              />
            ) : (
              data.entries.map((entry, i) => (
                <TeamRow
                  key={entry.team.id}
                  entry={entry}
                  index={i}
                  onMemberClick={handleMemberClick}
                  onExpand={() => loadTeamMembers(entry.team.id)}
                  membersLoading={loadingTeamIds.has(entry.team.id)}
                />
              ))
            )}
          </div>
        )}
      </main>

      {/* Profile dialog — lazy mounted to avoid useAdmin/useSeasons firing while closed */}
      {dialogOpen && dialogMember && data && seasonEndExclusive && (
        <UserProfileDialog
          open={dialogOpen}
          onOpenChange={(v) => {
            setDialogOpen(v);
            if (!v) setDialogMember(null);
          }}
          slug={dialogMember.slug ?? dialogMember.user_id}
          name={dialogMember.name}
          image={dialogMember.image}
          defaultTab="season"
          seasonName={data.season.name}
          seasonStart={data.season.start_date}
          seasonEnd={seasonEndExclusive}
        />
      )}
    </TooltipProvider>
  );
}
