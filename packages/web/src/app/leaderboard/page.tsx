"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import {
  useLeaderboard,
  type LeaderboardPeriod,
  type LeaderboardEntry,
} from "@/hooks/use-leaderboard";
import { LeaderboardNav } from "@/components/leaderboard/leaderboard-nav";
import { PageHeader } from "@/components/leaderboard/page-header";
import { TableHeader } from "@/components/leaderboard/table-header";
import { LeaderboardSkeleton } from "@/components/leaderboard/leaderboard-skeleton";
import { LeaderboardRow } from "@/components/leaderboard/leaderboard-row";
import { PeriodTabs, PERIOD_TO_TAB } from "@/components/leaderboard/period-tabs";
import {
  ScopeDropdown,
  loadScopeFromStorage,
  saveScopeToStorage,
  type ScopeSelection,
  type Organization,
  type Team,
} from "@/components/leaderboard/scope-dropdown";
import { UserProfileDialog } from "@/components/user-profile-dialog";

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
          <PeriodTabs value={period} onChange={setPeriod} />

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
