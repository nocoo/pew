"use client";

import { useEffect, useState } from "react";
import { Calendar, Clock } from "lucide-react";
import { formatSeasonDate } from "@/lib/seasons";
import { getSeasonEndExclusive } from "@/lib/season-helpers";
import type { SeasonStatus } from "@pew/core";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format remaining ms as "Xd Xh Xm Xs" — omits zero leading segments. */
function formatCountdown(ms: number): string {
  if (ms <= 0) return "0s";

  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0 || d > 0) parts.push(`${h}h`);
  if (m > 0 || h > 0 || d > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);

  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface SeasonCountdownProps {
  status: SeasonStatus;
  startDate: string;
  endDate: string;
}

export function SeasonCountdown({
  status,
  startDate,
  endDate,
}: SeasonCountdownProps) {
  const [now, setNow] = useState(() => Date.now());

  // Tick every second for active/upcoming seasons
  useEffect(() => {
    if (status === "ended") return;

    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [status]);

  const fullRange = `${formatSeasonDate(startDate)} — ${formatSeasonDate(endDate)}`;

  // Ended — show static date range, no tooltip needed
  if (status === "ended") {
    return (
      <span className="text-sm text-muted-foreground inline-flex items-center gap-1">
        <Calendar className="h-3.5 w-3.5" />
        {fullRange}
      </span>
    );
  }

  // Active or upcoming — show countdown with tooltip for full range
  // Use exclusive end boundary (end_date + 60s) for active seasons
  // to align with when data actually stops changing
  const targetMs =
    status === "active"
      ? getSeasonEndExclusive(endDate)
      : new Date(startDate).getTime();
  const remaining = Math.max(0, targetMs - now);
  const label = status === "active" ? "Ends in" : "Starts in";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="text-sm text-muted-foreground inline-flex items-center gap-1 cursor-default">
          <Clock className="h-3.5 w-3.5" />
          {label} {formatCountdown(remaining)}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <span>{fullRange}</span>
      </TooltipContent>
    </Tooltip>
  );
}
