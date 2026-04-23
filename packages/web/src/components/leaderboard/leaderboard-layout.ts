/**
 * Shared layout constants for leaderboard tables.
 *
 * Keeps row/skeleton/header column widths and shared card classes
 * in a single place so they stay in sync automatically.
 */

// ---------------------------------------------------------------------------
// Shared row card classes
// ---------------------------------------------------------------------------

/** Base card classes shared by rows, skeleton rows and auxiliary UI. */
export const ROW_CLASSES = "rounded-card bg-secondary px-4 py-3";

// ---------------------------------------------------------------------------
// Column widths — must stay in sync across TableHeader, Row & Skeleton
// ---------------------------------------------------------------------------

/** Rank column (tabular-nums centred). */
export const COL_RANK = "w-8 shrink-0";

/** Session count column (hidden on mobile). */
export const COL_SESSIONS = "hidden sm:block w-24 shrink-0";

/** Duration column (hidden on mobile). */
export const COL_DURATION = "hidden sm:block w-24 shrink-0";

/** Total-tokens column (responsive width). */
export const COL_TOKENS = "w-[120px] sm:w-[280px] shrink-0";
