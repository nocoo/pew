"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import {
  Globe,
  Users,
  ShieldCheck,
  EyeOff,
  ChevronDown,
} from "lucide-react";
import { cn, formatTokensFull } from "@/lib/utils";
import { formatDuration } from "@/lib/date-helpers";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  useLeaderboard,
  type LeaderboardPeriod,
  type LeaderboardEntry,
} from "@/hooks/use-leaderboard";
import { useAdmin } from "@/hooks/use-admin";
import { CheckRuling } from "@/components/leaderboard/check-ruling";
import { RankBadge } from "@/components/leaderboard/rank-badge";
import { TableHeader } from "@/components/leaderboard/table-header";
import { LeaderboardSkeleton } from "@/components/leaderboard/leaderboard-skeleton";
import { LeaderboardNav } from "@/components/leaderboard/leaderboard-nav";
import { PageHeader } from "@/components/leaderboard/page-header";
import { TokenTierBadge } from "@/components/leaderboard/token-tier-badge";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Team {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
}

/** Scope dropdown value: "global" | "all" (admin) | team id */
type ScopeValue = "global" | "all" | string;

// ---------------------------------------------------------------------------
// Period tabs
// ---------------------------------------------------------------------------

const PERIODS: { value: LeaderboardPeriod; label: string }[] = [
  { value: "week", label: "Last 7 Days" },
  { value: "month", label: "Last 30 Days" },
  { value: "all", label: "All Time" },
];

// ---------------------------------------------------------------------------
// Team logo inline icon (with fallback)
// ---------------------------------------------------------------------------

function TeamLogoIcon({
  logoUrl,
  name,
  className,
}: {
  logoUrl: string | null;
  name: string;
  className?: string;
}) {
  const [error, setError] = useState(false);
  const [prevUrl, setPrevUrl] = useState(logoUrl);

  if (logoUrl !== prevUrl) {
    setPrevUrl(logoUrl);
    setError(false);
  }

  if (!logoUrl || error) {
    return <Users className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground", className)} strokeWidth={1.5} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- external team logos, can't use next/image
    <img
      src={logoUrl}
      alt={name}
      className={cn("h-3.5 w-3.5 shrink-0 rounded-sm object-cover", className)}
      onError={() => setError(true)}
    />
  );
}

/** Tiny inline logo for team badges in leaderboard rows */
function TeamLogoBadge({ logoUrl, name }: { logoUrl: string | null; name: string }) {
  const [error, setError] = useState(false);
  const [prevUrl, setPrevUrl] = useState(logoUrl);

  if (logoUrl !== prevUrl) {
    setPrevUrl(logoUrl);
    setError(false);
  }

  if (!logoUrl || error) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- external team logos, can't use next/image
    <img
      src={logoUrl}
      alt={name}
      className="h-2.5 w-2.5 shrink-0 rounded-[2px] object-cover"
      onError={() => setError(true)}
    />
  );
}

// ---------------------------------------------------------------------------
// Scope dropdown (replaces team buttons + admin checkbox)
// ---------------------------------------------------------------------------

function ScopeDropdown({
  value,
  onChange,
  teams,
  isAdmin,
}: {
  value: ScopeValue;
  onChange: (v: ScopeValue) => void;
  teams: Team[];
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const iconClass = "h-3.5 w-3.5 shrink-0 text-muted-foreground";

  const label =
    value === "global"
      ? "Global"
      : value === "all"
        ? "All Users"
        : teams.find((t) => t.id === value)?.name ?? "Global";

  const selectedTeam = teams.find((t) => t.id === value);

  const labelIcon =
    value === "global" ? (
      <Globe className={iconClass} strokeWidth={1.5} />
    ) : value === "all" ? (
      <ShieldCheck className={iconClass} strokeWidth={1.5} />
    ) : selectedTeam ? (
      <TeamLogoIcon logoUrl={selectedTeam.logo_url} name={selectedTeam.name} />
    ) : (
      <Users className={iconClass} strokeWidth={1.5} />
    );

  if (teams.length === 0 && !isAdmin) return null;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-2 rounded-lg bg-secondary px-3 py-[10px] text-sm font-medium transition-colors",
          "text-foreground hover:bg-accent",
        )}
      >
        {labelIcon}
        {label}
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200",
            open && "rotate-180",
          )}
          strokeWidth={1.5}
        />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-[160px] rounded-lg border border-border bg-background p-1 shadow-lg">
          <DropdownItem
            active={value === "global"}
            onClick={() => {
              onChange("global");
              setOpen(false);
            }}
          >
            <Globe className={iconClass} strokeWidth={1.5} />
            Global
          </DropdownItem>
          {teams.map((team) => (
            <DropdownItem
              key={team.id}
              active={value === team.id}
              onClick={() => {
                onChange(team.id);
                setOpen(false);
              }}
            >
              <TeamLogoIcon logoUrl={team.logo_url} name={team.name} />
              {team.name}
            </DropdownItem>
          ))}
          {isAdmin && (
            <>
              <div className="mx-2 my-1 border-t border-border" />
              <DropdownItem
                active={value === "all"}
                onClick={() => {
                  onChange("all");
                  setOpen(false);
                }}
              >
                <ShieldCheck className={iconClass} strokeWidth={1.5} />
                All Users
                <span className="ml-auto text-[10px] text-muted-foreground">
                  admin
                </span>
              </DropdownItem>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function DropdownItem({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Row component — check-style design
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
  const { rank, user, teams, total_tokens, session_count, total_duration_seconds } =
    entry;
  const displayName = user.name ?? "Anonymous";
  const initial = displayName[0]?.toUpperCase() ?? "?";

  const content = (
    <div
      className={cn(
        "relative flex items-center gap-3 overflow-hidden rounded-[var(--radius-card)] bg-secondary px-4 py-3 transition-colors animate-fade-up",
        user.slug && "hover:bg-accent cursor-pointer",
        rank <= 3 && "ring-1 ring-border/50",
      )}
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <CheckRuling />

      {/* Rank — fixed w-8, tabular-nums for alignment */}
      <div className="flex w-8 shrink-0 items-center justify-center tabular-nums">
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
            <TokenTierBadge totalTokens={total_tokens} />
            {showHiddenBadge && user.is_public === false && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
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
                  className="inline-flex items-center gap-1 text-xs leading-tight text-muted-foreground bg-muted px-1.5 py-0.5 rounded"
                >
                  <TeamLogoBadge logoUrl={team.logo_url} name={team.name} />
                  {team.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Session count (hidden on mobile) */}
      <div className="hidden sm:block w-24 shrink-0 text-right">
        <span className="text-xs tabular-nums text-chart-2" title="Sessions">
          {session_count.toLocaleString("en-US")}
        </span>
      </div>

      {/* Duration (hidden on mobile) */}
      <div className="hidden sm:block w-24 shrink-0 text-right">
        <span className="text-xs tabular-nums text-chart-7" title="Total duration">
          {formatDuration(total_duration_seconds)}
        </span>
      </div>

      {/* Total — check-style handwriting font, full number */}
      <div className="relative z-10 w-[140px] sm:w-[220px] shrink-0 text-right flex items-center justify-end">
        <span className="font-handwriting text-[32px] sm:text-[39px] leading-none tracking-tight text-foreground whitespace-nowrap">
          {formatTokensFull(total_tokens)}
        </span>
      </div>
    </div>
  );

  if (user.slug) {
    return (
      <Link href={`/u/${user.slug}`} className="block">
        {content}
      </Link>
    );
  }
  return content;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function LeaderboardPage() {
  const [period, setPeriod] = useState<LeaderboardPeriod>("week");
  const [scope, setScope] = useState<ScopeValue>("global");
  const [teams, setTeams] = useState<Team[]>([]);
  const { isAdmin } = useAdmin();

  const teamId = scope !== "global" && scope !== "all" ? scope : null;
  const admin = scope === "all";

  const { data, loading, refreshing, error } = useLeaderboard({
    period,
    teamId,
    admin,
  });

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

  /* eslint-disable react-hooks/set-state-in-effect -- async fetch, setState is after await */
  useEffect(() => {
    fetchTeams();
  }, [fetchTeams]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const showHiddenBadge = scope === "all";

  return (
    <>
      {/* Header */}
      <PageHeader>
        <h1 className="tracking-tight text-foreground">
          <span className="text-[47px] font-bold font-handwriting leading-none mr-2">pew</span>
          <span className="text-[19px] font-normal text-muted-foreground">
            Leaderboard
          </span>
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Who&apos;s burning the most tokens?
        </p>
      </PageHeader>

      {/* Main content */}
      <main className="flex-1 py-4 space-y-4">
        {/* Tab nav */}
        <LeaderboardNav />

        {/* Controls row */}
        <div
          className="relative z-20 flex items-center gap-3 animate-fade-up"
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
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Scope dropdown (teams + admin show-all) */}
          <ScopeDropdown
            value={scope}
            onChange={setScope}
            teams={teams}
            isAdmin={isAdmin}
          />
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-[var(--radius-card)] bg-destructive/10 p-4 text-sm text-destructive">
            Failed to load leaderboard: {error}
          </div>
        )}

        {/* Table header row */}
        <TableHeader />

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
                  showHiddenBadge={showHiddenBadge}
                  index={i}
                />
              ))
            )}
          </div>
        )}
      </main>
    </>
  );
}
