"use client";

import { useState } from "react";
import {
  useLeaderboard,
  type LeaderboardPeriod,
} from "@/hooks/use-leaderboard";
import { useLeaderboardScope } from "@/hooks/use-leaderboard-scope";
import { LeaderboardNav } from "@/components/leaderboard/leaderboard-nav";
import { PageHeader } from "@/components/leaderboard/page-header";
import { PeriodTabs } from "@/components/leaderboard/period-tabs";
import { ScopeDropdown } from "@/components/leaderboard/scope-dropdown";
import { LeaderboardPageShell } from "@/components/leaderboard/leaderboard-page-shell";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function LeaderboardPage() {
  const [period, setPeriod] = useState<LeaderboardPeriod>("week");

  const {
    scope,
    setScope,
    organizations,
    teams,
    scopeInitialized,
    isSessionLoading,
    isAuthenticated,
    teamId,
    orgId,
  } = useLeaderboardScope();

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
            <div className="hidden sm:block">
              <ScopeDropdown
                value={scope}
                onChange={setScope}
                organizations={organizations}
                teams={teams}
              />
            </div>
          )}
        </div>

        {/* Shared page shell: error, table, loading, empty, dialog */}
        <LeaderboardPageShell
          entries={entries}
          loading={loading}
          loadingMore={loadingMore}
          error={error}
          hasMore={hasMore}
          loadMore={loadMore}
          animationStartIndex={animationStartIndex}
          period={period}
        />
      </main>
    </>
  );
}
