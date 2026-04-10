"use client";

import { Suspense, useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { useSearchParams, useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { modelColor } from "@/lib/palette";
import { shortModel } from "@/lib/model-helpers";
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

// ---------------------------------------------------------------------------
// ModelSelector dropdown
// ---------------------------------------------------------------------------

function ModelSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (model: string) => void;
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

  const color = modelColor(value);

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
        {shortModel(value)}
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200",
            open && "rotate-180",
          )}
          strokeWidth={1.5}
        />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-0.5 min-w-[220px] max-h-[320px] overflow-y-auto rounded-lg border border-border bg-background p-1 shadow-lg">
          {MODEL_LIST.map((model) => {
            const c = modelColor(model);
            return (
              <button
                key={model}
                onClick={() => {
                  onChange(model);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
                  value === model
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: c.color }}
                />
                {shortModel(model)}
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
const MAX_ENTRIES = 100;

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
  const { status } = useSession();
  const isAuthenticated = status === "authenticated";
  const isSessionLoading = status === "loading";
  const searchParams = useSearchParams();
  const router = useRouter();

  // Derive selected model from URL (single source of truth)
  // Accept any non-empty model param — backend will return empty if no match,
  // allowing deep-links to DB-extended models not in the static dropdown
  const urlModel = searchParams.get("model");
  const selectedModel = urlModel && urlModel.trim() ? urlModel : DEFAULT_MODEL;

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

  const teamId = scope.type === "team" ? scope.id ?? null : null;
  const orgId = scope.type === "org" ? scope.id ?? null : null;

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
  /* eslint-disable react-hooks/set-state-in-effect -- async fetch and localStorage read */
  useEffect(() => {
    if (isSessionLoading) return;

    if (!isAuthenticated) {
      setScopeInitialized(true);
      return;
    }

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
          Top users by model — who&apos;s pushing each model the hardest?
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
          {/* Model selector */}
          <ModelSelector value={selectedModel} onChange={handleModelChange} />

          {/* Period tabs */}
          <PeriodTabs value={period} onChange={setPeriod} />

          {/* Scope dropdown */}
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

        {/* Content */}
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

        {/* Empty state */}
        {!loading && entries.length === 0 && !error && (
          <div className="rounded-[var(--radius-card)] bg-secondary p-8 text-center text-sm text-muted-foreground">
            No usage data for {shortModel(selectedModel)} in this period.
          </div>
        )}
      </main>

      {/* User profile dialog */}
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
