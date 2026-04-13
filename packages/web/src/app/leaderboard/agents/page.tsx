"use client";

import { Suspense, useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { agentColor } from "@/lib/palette";
import { sourceLabel } from "@/hooks/use-usage-data";
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
// Agent list (matches VALID_SOURCES in API route)
// ---------------------------------------------------------------------------

const AGENTS = [
  "claude-code",
  "codex",
  "copilot-cli",
  "gemini-cli",
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

// ---------------------------------------------------------------------------
// AgentSelector dropdown
// ---------------------------------------------------------------------------

function AgentSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (source: string) => void;
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

  const color = agentColor(value);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-2 rounded-lg bg-secondary px-3 py-[10px] text-sm font-medium transition-colors",
          "text-foreground hover:bg-accent",
        )}
      >
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: color.color }}
        />
        {sourceLabel(value)}
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200",
            open && "rotate-180",
          )}
          strokeWidth={1.5}
        />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-0.5 min-w-[200px] max-h-[320px] overflow-y-auto rounded-lg border border-border bg-background p-1 shadow-lg space-y-1">
          {AGENTS.map((agent) => {
            const c = agentColor(agent);
            return (
              <button
                key={agent}
                onClick={() => {
                  onChange(agent);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
                  value === agent
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: c.color }}
                />
                {sourceLabel(agent)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20;

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
      <PageHeader>
        <h1 className="tracking-tight text-foreground">
          <span className="text-[36px] font-bold font-handwriting leading-none mr-2">pew</span>
          <span className="text-[19px] font-normal text-muted-foreground">
            Leaderboard
          </span>
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Top users by agent — who&apos;s burning the most tokens?
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
          {/* Agent selector */}
          <AgentSelector value={selectedAgent} onChange={handleAgentChange} />

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
