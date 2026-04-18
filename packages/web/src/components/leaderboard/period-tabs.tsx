"use client";

import { cn } from "@/lib/utils";
import type { LeaderboardPeriod } from "@/hooks/use-leaderboard";
import type { ProfileDialogTab } from "@/components/user-profile-dialog";

// ---------------------------------------------------------------------------
// Constants (re-exported for consumers)
// ---------------------------------------------------------------------------

export const PERIODS: { value: LeaderboardPeriod; label: string; shortLabel: string }[] = [
  { value: "week", label: "Last 7 Days", shortLabel: "7D" },
  { value: "month", label: "Last 30 Days", shortLabel: "30D" },
  { value: "all", label: "All Time", shortLabel: "All" },
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
            "flex-1 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            value === p.value
              ? "bg-secondary text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <span className="sm:hidden">{p.shortLabel}</span>
          <span className="hidden sm:inline">{p.label}</span>
        </button>
      ))}
    </div>
  );
}
