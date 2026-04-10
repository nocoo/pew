"use client";

import { cn } from "@/lib/utils";
import type { LeaderboardPeriod } from "@/hooks/use-leaderboard";
import type { ProfileDialogTab } from "@/components/user-profile-dialog";

// ---------------------------------------------------------------------------
// Constants (re-exported for consumers)
// ---------------------------------------------------------------------------

export const PERIODS: { value: LeaderboardPeriod; label: string }[] = [
  { value: "week", label: "Last 7 Days" },
  { value: "month", label: "Last 30 Days" },
  { value: "all", label: "All Time" },
];

/** Map leaderboard period to profile dialog tab */
export const PERIOD_TO_TAB: Record<LeaderboardPeriod, ProfileDialogTab> = {
  week: "7d",
  month: "30d",
  all: "total",
};

// ---------------------------------------------------------------------------
// PeriodTabs
// ---------------------------------------------------------------------------

export function PeriodTabs({
  value,
  onChange,
}: {
  value: LeaderboardPeriod;
  onChange: (p: LeaderboardPeriod) => void;
}) {
  return (
    <div className="flex gap-1 rounded-lg bg-secondary p-1 flex-1">
      {PERIODS.map((p) => (
        <button
          key={p.value}
          onClick={() => onChange(p.value)}
          className={cn(
            "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            value === p.value
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
