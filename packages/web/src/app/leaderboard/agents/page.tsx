"use client";

import { Suspense, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { agentColor } from "@/lib/palette";
import { sourceLabel } from "@/hooks/use-usage-data";
import {
  useLeaderboard,
  type LeaderboardPeriod,
} from "@/hooks/use-leaderboard";
import { useLeaderboardScope } from "@/hooks/use-leaderboard-scope";
import { LeaderboardNav } from "@/components/leaderboard/leaderboard-nav";
import { LeaderboardPageTitle } from "@/components/leaderboard/leaderboard-page-title";
import { PeriodTabs } from "@/components/leaderboard/period-tabs";
import { ScopeDropdown } from "@/components/leaderboard/scope-dropdown";
import { LeaderboardPageShell } from "@/components/leaderboard/leaderboard-page-shell";
import {
  FilterDropdown,
  type FilterDropdownItem,
} from "@/components/leaderboard/filter-dropdown";
import { PAGE_SIZE } from "@/lib/leaderboard-constants";

// ---------------------------------------------------------------------------
// Agent list (matches VALID_SOURCES in API route)
// ---------------------------------------------------------------------------

const AGENTS = [
  "claude-code",
  "codex",
  "copilot-cli",
  "gemini-cli",
  "grok",
  "hermes",
  "kosmos",
  "opencode",
  "openclaw",
  "pi",
  "pmstudio",
  "vscode-copilot",
] as const;

const AGENT_SET = new Set<string>(AGENTS);
const DEFAULT_AGENT = "claude-code";

const AGENT_ITEMS: FilterDropdownItem[] = AGENTS.map((a) => ({
  key: a,
  label: sourceLabel(a),
  color: agentColor(a).color,
}));

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AgentsLeaderboardPage() {
  return (
    <Suspense>
      <AgentsLeaderboardContent />
    </Suspense>
  );
}

function AgentsLeaderboardContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Derive selected agent from URL (single source of truth)
  const urlSource = searchParams.get("source");
  const selectedAgent = urlSource && AGENT_SET.has(urlSource) ? urlSource : DEFAULT_AGENT;

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

  // Update URL when agent changes (URL is source of truth, not local state)
  const handleAgentChange = useCallback(
    (agent: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (agent === DEFAULT_AGENT) {
        params.delete("source");
      } else {
        params.set("source", agent);
      }
      const qs = params.toString();
      router.replace(`/leaderboard/agents${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [searchParams, router],
  );

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
    source: selectedAgent,
    limit: PAGE_SIZE,
    enabled: scopeInitialized && !isSessionLoading,
  });

  return (
    <>
      {/* Header */}
      <LeaderboardPageTitle
        subtitle="Leaderboard"
        description="Top users by agent — who's burning the most tokens?"
      />

      {/* Main content */}
      <main className="flex-1 py-4 space-y-4">
        {/* Tab nav */}
        <LeaderboardNav />

        {/* Controls row */}
        <div
          className="relative z-20 flex items-center gap-3 animate-fade-up"
          style={{ animationDelay: "180ms" }}
        >
          {/* Agent selector */}
          <FilterDropdown
            value={selectedAgent}
            items={AGENT_ITEMS}
            onChange={handleAgentChange}
          />

          {/* Period tabs */}
          <PeriodTabs value={period} onChange={setPeriod} />

          {/* Scope dropdown */}
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
          emptyMessage={`No usage data for ${sourceLabel(selectedAgent)} in this period.`}
        />
      </main>
    </>
  );
}
