/**
 * Shared season status configuration.
 *
 * Centralizes status-based colors and labels used across:
 * - status-badge.tsx
 * - seasons/page.tsx (TimelineDot)
 * - seasons/[slug]/page.tsx (live/final pills)
 */

import type { SeasonStatus } from "@pew/core";

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export const STATUS_LABELS: Record<SeasonStatus, string> = {
  active: "Active",
  upcoming: "Upcoming",
  ended: "Ended",
};

// ---------------------------------------------------------------------------
// Badge styles (Tailwind classes for StatusBadge)
// ---------------------------------------------------------------------------

export const STATUS_BADGE_STYLES: Record<SeasonStatus, string> = {
  active:
    "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/25",
  upcoming:
    "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/25",
  ended: "bg-muted text-muted-foreground border-border",
};

// ---------------------------------------------------------------------------
// Timeline dot colors (for seasons list page)
// ---------------------------------------------------------------------------

export const TIMELINE_DOT_COLORS: Record<SeasonStatus, string> = {
  active: "bg-green-500",
  upcoming: "bg-blue-500",
  ended: "bg-muted-foreground",
};

// ---------------------------------------------------------------------------
// Pill styles (for live/final indicators on season detail page)
// ---------------------------------------------------------------------------

export const LIVE_PILL_STYLE =
  "border-green-500/25 bg-green-500/15 text-green-700 dark:text-green-400";

export const FINAL_PILL_STYLE =
  "border-border bg-muted text-muted-foreground";
