import { Badge } from "@nocoo/basalt/components/badge";
import { STATUS_LABELS } from "@/lib/season-status-config";
import type { SeasonStatus } from "@pew/core";

const STATUS_BADGE_TONE: Record<SeasonStatus, "success" | "info" | "neutral"> = {
  active: "success",
  upcoming: "info",
  ended: "neutral",
};

export function StatusBadge({ status }: { status: SeasonStatus }) {
  return (
    <Badge tone={STATUS_BADGE_TONE[status]} dot={status === "active"}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}
