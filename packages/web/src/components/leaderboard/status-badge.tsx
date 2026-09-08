import { Badge } from "@nocoo/basalt/components/badge";
import { STATUS_LABELS } from "@/lib/season-status-config";
import type { SeasonStatus } from "@pew/core";

const STATUS_BADGE_VARIANT: Record<SeasonStatus, "success" | "info" | "secondary"> = {
  active: "success",
  upcoming: "info",
  ended: "secondary",
};

export function StatusBadge({ status }: { status: SeasonStatus }) {
  return (
    <Badge variant={STATUS_BADGE_VARIANT[status]} dot={status === "active"}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}
