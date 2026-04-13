import { cn } from "@/lib/utils";
import { STATUS_BADGE_STYLES, STATUS_LABELS } from "@/lib/season-status-config";
import type { SeasonStatus } from "@pew/core";

export function StatusBadge({ status }: { status: SeasonStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        STATUS_BADGE_STYLES[status],
      )}
    >
      {status === "active" && (
        <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
      )}
      {STATUS_LABELS[status]}
    </span>
  );
}
