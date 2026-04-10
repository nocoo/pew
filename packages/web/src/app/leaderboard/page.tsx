"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import {
  Globe,
  Users,
  Building2,
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
import { CheckRuling } from "@/components/leaderboard/check-ruling";
import { RankBadge } from "@/components/leaderboard/rank-badge";
import { TableHeader } from "@/components/leaderboard/table-header";
import { LeaderboardSkeleton } from "@/components/leaderboard/leaderboard-skeleton";
import { LeaderboardNav } from "@/components/leaderboard/leaderboard-nav";
import { PageHeader } from "@/components/leaderboard/page-header";
import { TokenTierBadge } from "@/components/leaderboard/token-tier-badge";
import { UserProfileDialog, type ProfileDialogTab } from "@/components/user-profile-dialog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Team {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
}

interface Organization {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
}

/** Scope selection: global, or org/team with ID */
interface ScopeSelection {
  type: "global" | "org" | "team";
  id?: string;
}

// ---------------------------------------------------------------------------
// localStorage persistence
// ---------------------------------------------------------------------------

const SCOPE_STORAGE_KEY = "pew:leaderboard:scope";

function loadScopeFromStorage(): ScopeSelection | null {
  try {
    const stored = localStorage.getItem(SCOPE_STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as ScopeSelection;
    if (parsed.type === "global" || ((parsed.type === "org" || parsed.type === "team") && parsed.id)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function saveScopeToStorage(scope: ScopeSelection): void {
  try {
    localStorage.setItem(SCOPE_STORAGE_KEY, JSON.stringify(scope));
  } catch {
    // Silently fail
  }
}

// ---------------------------------------------------------------------------
// Period tabs
// ---------------------------------------------------------------------------

const PERIODS: { value: LeaderboardPeriod; label: string }[] = [
  { value: "week", label: "Last 7 Days" },
  { value: "month", label: "Last 30 Days" },
  { value: "all", label: "All Time" },
];

/** Map leaderboard period to profile dialog tab */
const PERIOD_TO_TAB: Record<LeaderboardPeriod, ProfileDialogTab> = {
  week: "7d",
  month: "30d",
  all: "total",
};

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
// Org logo inline icon (with fallback)
// ---------------------------------------------------------------------------

function OrgLogoIcon({
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
    return <Building2 className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground", className)} strokeWidth={1.5} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- external org logos, can't use next/image
    <img
      src={logoUrl}
      alt={name}
      className={cn("h-3.5 w-3.5 shrink-0 rounded-sm object-cover", className)}
      onError={() => setError(true)}
    />
  );
}

// ---------------------------------------------------------------------------
// Scope dropdown (org + team filter)
// ---------------------------------------------------------------------------

function ScopeDropdown({
  value,
  onChange,
  organizations,
  teams,
}: {
  value: ScopeSelection;
  onChange: (v: ScopeSelection) => void;
  organizations: Organization[];
  teams: Team[];
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

  // Find selected item
  const selectedOrg = value.type === "org" ? organizations.find((o) => o.id === value.id) : null;
  const selectedTeam = value.type === "team" ? teams.find((t) => t.id === value.id) : null;
  const label = value.type === "global" ? "Global" : selectedOrg?.name ?? selectedTeam?.name ?? "Global";

  const labelIcon =
    value.type === "global" ? (
      <Globe className={iconClass} strokeWidth={1.5} />
    ) : selectedOrg ? (
      <OrgLogoIcon logoUrl={selectedOrg.logoUrl} name={selectedOrg.name} />
    ) : selectedTeam ? (
      <TeamLogoIcon logoUrl={selectedTeam.logo_url} name={selectedTeam.name} />
    ) : (
      <Globe className={iconClass} strokeWidth={1.5} />
    );

  // Hide dropdown if no orgs or teams
  if (organizations.length === 0 && teams.length === 0) return null;

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
        <div className="absolute left-0 top-full z-50 mt-1 min-w-[180px] max-h-[320px] overflow-y-auto rounded-lg border border-border bg-background p-1 shadow-lg">
          {/* Global option */}
          <DropdownItem
            active={value.type === "global"}
            onClick={() => {
              onChange({ type: "global" });
              setOpen(false);
            }}
          >
            <Globe className={iconClass} strokeWidth={1.5} />
            Global
          </DropdownItem>

          {/* Organizations group */}
          {organizations.length > 0 && (
            <>
              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mt-1">
                Organizations
              </div>
              {organizations.map((org) => (
                <DropdownItem
                  key={org.id}
                  active={value.type === "org" && value.id === org.id}
                  onClick={() => {
                    onChange({ type: "org", id: org.id });
                    setOpen(false);
                  }}
                >
                  <OrgLogoIcon logoUrl={org.logoUrl} name={org.name} />
                  {org.name}
                </DropdownItem>
              ))}
            </>
          )}

          {/* Teams group */}
          {teams.length > 0 && (
            <>
              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mt-1">
                Teams
              </div>
              {teams.map((team) => (
                <DropdownItem
                  key={team.id}
                  active={value.type === "team" && value.id === team.id}
                  onClick={() => {
                    onChange({ type: "team", id: team.id });
                    setOpen(false);
                  }}
                >
                  <TeamLogoIcon logoUrl={team.logo_url} name={team.name} />
                  {team.name}
                </DropdownItem>
              ))}
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
  index,
  animationStartIndex,
  onSelect,
}: {
  entry: LeaderboardEntry;
  index: number;
  /** Index of first newly loaded entry — entries before this don't animate */
  animationStartIndex: number;
  /** Callback when user clicks the row */
  onSelect: (entry: LeaderboardEntry) => void;
}) {
  const { rank, user, teams, total_tokens, session_count, total_duration_seconds } =
    entry;
  const displayName = user.name ?? "Anonymous";
  const initial = displayName[0]?.toUpperCase() ?? "?";

  // Only animate newly loaded entries (index >= animationStartIndex)
  const shouldAnimate = index >= animationStartIndex;
  const animationIndex = index - animationStartIndex;

  const content = (
    <div
      className={cn(
        "relative flex items-center gap-3 overflow-hidden rounded-[var(--radius-card)] bg-secondary px-4 py-3 transition-colors hover:bg-accent cursor-pointer",
        shouldAnimate && "animate-fade-up",
        rank <= 3 && "ring-1 ring-border/50",
      )}
      style={shouldAnimate ? { animationDelay: `${Math.min(animationIndex * 40, 600)}ms` } : undefined}
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
      <div className="relative z-10 w-[160px] sm:w-[280px] shrink-0 text-right flex items-center justify-end">
        <span className="font-handwriting text-[32px] sm:text-[39px] leading-none tracking-tight text-foreground whitespace-nowrap">
          {formatTokensFull(total_tokens)}
        </span>
      </div>
    </div>
  );

  return (
    <button type="button" className="block w-full text-left" onClick={() => onSelect(entry)}>
      {content}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20;
const MAX_ENTRIES = 100;

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function LeaderboardPage() {
  const { status } = useSession();
  const isAuthenticated = status === "authenticated";
  const isSessionLoading = status === "loading";

  const [period, setPeriod] = useState<LeaderboardPeriod>("week");
  const [scope, setScope] = useState<ScopeSelection>({ type: "global" });
  const [scopeInitialized, setScopeInitialized] = useState(false);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);

  // Dialog state for user profile popup
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogEntry, setDialogEntry] = useState<LeaderboardEntry | null>(null);

  const handleRowSelect = useCallback((entry: LeaderboardEntry) => {
    setDialogEntry(entry);
    setDialogOpen(true);
  }, []);

  const teamId = scope.type === "team" ? scope.id ?? null : null;
  const orgId = scope.type === "org" ? scope.id ?? null : null;

  // Delay fetch until scope is initialized:
  // - Session loading: wait (don't know if user is authenticated yet)
  // - Authenticated: wait for orgs/teams + localStorage scope restore
  // - Unauthenticated: fetch immediately with global scope
  const {
    entries,
    loading,
    loadingMore,
    error,
    hasMore,
    loadMore,
    animationStartIndex,
  } = useLeaderboard({
    period,
    teamId,
    orgId,
    limit: PAGE_SIZE,
    enabled: scopeInitialized && !isSessionLoading,
  });

  // Fetch user's organizations and teams
  const fetchOrgsAndTeams = useCallback(async () => {
    try {
      const [orgsRes, teamsRes] = await Promise.all([
        fetch("/api/organizations/mine"),
        fetch("/api/teams"),
      ]);

      if (orgsRes.ok) {
        const orgsJson = await orgsRes.json();
        setOrganizations(orgsJson.organizations ?? []);
      }
      if (teamsRes.ok) {
        const teamsJson = await teamsRes.json();
        setTeams(teamsJson.teams ?? []);
      }
    } catch {
      // Silently fail — scope dropdown optional
    }
  }, []);

  // Initialize scope from localStorage and fetch orgs/teams
  // Wait for session to resolve before deciding auth state
  /* eslint-disable react-hooks/set-state-in-effect -- async fetch and localStorage read */
  useEffect(() => {
    // Still loading session - wait
    if (isSessionLoading) {
      return;
    }

    // Unauthenticated - use global scope immediately
    if (!isAuthenticated) {
      setScopeInitialized(true);
      return;
    }

    // Authenticated - fetch orgs/teams and restore scope
    fetchOrgsAndTeams().then(() => {
      const stored = loadScopeFromStorage();
      if (stored) {
        setScope(stored);
      }
      setScopeInitialized(true);
    });
  }, [isSessionLoading, isAuthenticated, fetchOrgsAndTeams]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Validate stored scope against available orgs/teams
  // (intentionally calling setState in effect to correct invalid state after async load)
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!scopeInitialized) return;

    if (scope.type === "org" && scope.id) {
      const valid = organizations.some((o) => o.id === scope.id);
      if (!valid) {
        setScope({ type: "global" });
        saveScopeToStorage({ type: "global" });
      }
    } else if (scope.type === "team" && scope.id) {
      const valid = teams.some((t) => t.id === scope.id);
      if (!valid) {
        setScope({ type: "global" });
        saveScopeToStorage({ type: "global" });
      }
    }
  }, [scopeInitialized, scope, organizations, teams]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Handle scope change
  const handleScopeChange = (newScope: ScopeSelection) => {
    setScope(newScope);
    saveScopeToStorage(newScope);
  };

  return (
    <>
      {/* Header */}
      <PageHeader>
        <h1 className="tracking-tight text-foreground">
          <span className="text-[36px] font-bold font-handwriting leading-none mr-2">pew</span>
          <span className="text-[19px] font-normal text-muted-foreground">
            Leaderboard
          </span>
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Join the ultimate AI token horse race today.
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

          {/* Scope dropdown (org/team filter) — only show for authenticated users */}
          {isAuthenticated && (
            <ScopeDropdown
              value={scope}
              onChange={handleScopeChange}
              organizations={organizations}
              teams={teams}
            />
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-[var(--radius-card)] bg-destructive/10 p-4 text-sm text-destructive">
            Failed to load leaderboard: {error}
          </div>
        )}

        {/* Table header row */}
        <TableHeader />

        {/* Loading — skeleton on initial load */}
        {loading && <LeaderboardSkeleton />}

        {/* Content — no opacity change during pagination */}
        {entries.length > 0 && (
          <div className="space-y-2">
            {entries.map((entry, i) => (
              <LeaderboardRow
                key={entry.user.id}
                entry={entry}
                index={i}
                animationStartIndex={animationStartIndex}
                onSelect={handleRowSelect}
              />
            ))}
            {/* Load more button — hide when reached max or no more data */}
            {hasMore && entries.length < MAX_ENTRIES && (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="w-full rounded-[var(--radius-card)] bg-secondary py-3 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
              >
                {loadingMore ? "Loading..." : "Show more"}
              </button>
            )}
          </div>
        )}

        {/* Empty state — only show after loading completes with no results */}
        {!loading && entries.length === 0 && !error && (
          <div className="rounded-[var(--radius-card)] bg-secondary p-8 text-center text-sm text-muted-foreground">
            No usage data for this period yet.
          </div>
        )}
      </main>

      {/* User profile dialog — stays in-page, preserves scroll & pagination */}
      <UserProfileDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        slug={dialogEntry?.user.slug ?? dialogEntry?.user.id ?? null}
        name={dialogEntry?.user.name ?? null}
        image={dialogEntry?.user.image ?? null}
        defaultTab={PERIOD_TO_TAB[period]}
      />
    </>
  );
}
