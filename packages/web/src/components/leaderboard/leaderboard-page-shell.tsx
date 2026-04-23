"use client";

import { useCallback, useState } from "react";
import type { LeaderboardEntry, LeaderboardPeriod } from "@/hooks/use-leaderboard";
import { TableHeader } from "@/components/leaderboard/table-header";
import { LeaderboardSkeleton } from "@/components/leaderboard/leaderboard-skeleton";
import { LeaderboardRow } from "@/components/leaderboard/leaderboard-row";
import { UserProfileDialog } from "@/components/user-profile-dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PERIOD_TO_TAB } from "@/components/leaderboard/period-tabs";
import { ROW_CLASSES } from "@/components/leaderboard/leaderboard-layout";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_ENTRIES = 100;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LeaderboardPageShellProps {
  /** Leaderboard entries to display */
  entries: LeaderboardEntry[];
  /** Whether initial data is loading */
  loading: boolean;
  /** Whether more data is being loaded */
  loadingMore: boolean;
  /** Error message if fetch failed */
  error: string | null;
  /** Whether more entries can be loaded */
  hasMore: boolean;
  /** Load more entries callback */
  loadMore: () => void;
  /** Index where animation should start (for staggered entry) */
  animationStartIndex: number;
  /** Current period for profile dialog default tab */
  period: LeaderboardPeriod;
  /** Custom empty state message */
  emptyMessage?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Shared page shell for leaderboard pages.
 * Handles:
 * - Loading skeleton
 * - Error state
 * - Empty state
 * - Load-more button
 * - Profile dialog wiring
 */
export function LeaderboardPageShell({
  entries,
  loading,
  loadingMore,
  error,
  hasMore,
  loadMore,
  animationStartIndex,
  period,
  emptyMessage = "No usage data for this period yet.",
}: LeaderboardPageShellProps) {
  // Dialog state for user profile popup
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogEntry, setDialogEntry] = useState<LeaderboardEntry | null>(null);

  const handleRowSelect = useCallback((entry: LeaderboardEntry) => {
    setDialogEntry(entry);
    setDialogOpen(true);
  }, []);

  return (
    <TooltipProvider>
      {/* Error */}
      {error && (
        <div className="rounded-card bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load leaderboard: {error}
        </div>
      )}

      {/* Table header row — show when there are entries or during initial load */}
      {(entries.length > 0 || loading) && <TableHeader />}

      {/* Loading — skeleton on initial load only (no entries yet, no error) */}
      {loading && !error && entries.length === 0 && <LeaderboardSkeleton />}

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
              className={`w-full ${ROW_CLASSES} text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50`}
            >
              {loadingMore ? "Loading..." : "Show more"}
            </button>
          )}
        </div>
      )}

      {/* Empty state — only show after loading completes with no results */}
      {!loading && entries.length === 0 && !error && (
        <div className="rounded-card bg-secondary p-8 text-center text-sm text-muted-foreground">
          {emptyMessage}
        </div>
      )}

      {/* User profile dialog — lazy mounted to avoid useAdmin/useSeasons firing while closed */}
      {dialogOpen && (
        <UserProfileDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          slug={dialogEntry?.user.slug ?? dialogEntry?.user.id ?? null}
          name={dialogEntry?.user.name ?? null}
          image={dialogEntry?.user.image ?? null}
          badges={dialogEntry?.badges ?? []}
          defaultTab={PERIOD_TO_TAB[period]}
        />
      )}
    </TooltipProvider>
  );
}
