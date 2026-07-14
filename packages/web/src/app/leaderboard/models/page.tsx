"use client";

import { Suspense, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { modelColor } from "@/lib/palette";
import { shortModel } from "@/lib/model-helpers";
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
// Model list — Top 20 by token usage from D1 (2026-04-10 snapshot)
// URL params are NOT validated against this list, so deep-links to any model work.
// ---------------------------------------------------------------------------

const MODEL_LIST = [
  // OpenAI GPT-5.x
  "gpt-5.4",
  "gpt-5.2",
  "gpt-5.3-codex",
  "gpt-5-codex",
  "gpt-5.2-codex",
  "gpt-5.1-codex-max",
  "gpt-5.1",
  "gpt-5.1-codex",
  // Anthropic Claude 4.x
  "claude-opus-4.6-1m",
  "claude-opus-4.6",
  "claude-opus-4.5",
  "claude-sonnet-4.6",
  "claude-sonnet-4",
  "claude-sonnet-4.5",
  "claude-haiku-4.5",
  // Google Gemini 3.x
  "gemini-3-pro-preview",
  // Zhipu GLM-5.x
  "glm-5.1",
  "glm-5",
  "glm-4.7",
];
const DEFAULT_MODEL = "claude-opus-4.6-1m";

const MODEL_ITEMS: FilterDropdownItem[] = MODEL_LIST.map((m) => ({
  key: m,
  label: shortModel(m),
  color: modelColor(m).color,
}));

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ModelsLeaderboardPage() {
  return (
    <Suspense>
      <ModelsLeaderboardContent />
    </Suspense>
  );
}

function ModelsLeaderboardContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Derive selected model from URL (single source of truth)
  // Accept any non-empty model param — backend will return empty if no match,
  // allowing deep-links to DB-extended models not in the static dropdown
  const urlModel = searchParams.get("model");
  const selectedModel = urlModel?.trim() ? urlModel : DEFAULT_MODEL;

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

  // Update URL when model changes (URL is source of truth, not local state)
  const handleModelChange = useCallback(
    (model: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (model === DEFAULT_MODEL) {
        params.delete("model");
      } else {
        params.set("model", model);
      }
      const qs = params.toString();
      router.replace(`/leaderboard/models${qs ? `?${qs}` : ""}`, { scroll: false });
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
    model: selectedModel,
    limit: PAGE_SIZE,
    enabled: scopeInitialized && !isSessionLoading,
  });

  return (
    <>
      {/* Header */}
      <LeaderboardPageTitle
        subtitle="Leaderboard"
        description="Top users by model — who's pushing each model the hardest?"
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
          {/* Model selector */}
          <FilterDropdown
            value={selectedModel}
            items={MODEL_ITEMS}
            onChange={handleModelChange}
            panelMinWidth="220px"
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
          emptyMessage={`No usage data for ${shortModel(selectedModel)} in this period.`}
        />
      </main>
    </>
  );
}
