"use client";

import { Button } from "@nocoo/basalt/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nocoo/basalt/components/dialog";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { useAdmin } from "@/hooks/use-admin";
import { useSeasons, type SeasonListItem } from "@/hooks/use-seasons";

function SnapshotAlertInner() {
  const { data, loading } = useSeasons({ status: "ended" });
  const [dismissed, setDismissed] = useState(false);

  if (loading || !data) return null;

  const unsnapshotted = data.seasons.filter((s) => !s.has_snapshot);
  if (unsnapshotted.length === 0) return null;
  if (dismissed) return null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) setDismissed(true);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-basalt-warning-tint">
              <AlertTriangle className="size-4 text-basalt-warning" strokeWidth={1.5} />
            </div>
            <DialogTitle className="text-lg">Seasons Pending Snapshot</DialogTitle>
          </div>
          <DialogDescription>
            The following ended seasons haven&apos;t been snapshotted yet. Leaderboard
            results are still based on live data.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-1.5">
          {unsnapshotted.map((s) => (
            <SeasonRow key={s.id} season={s} />
          ))}
        </ul>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setDismissed(true)}>
            Dismiss
          </Button>
          <Button size="sm" asChild>
            <a href="/admin/seasons">Go to Seasons</a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SeasonRow({ season }: { season: SeasonListItem }) {
  const endDate = new Date(season.end_date);
  const formatted = endDate.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return (
    <li className="flex items-center gap-2 text-sm text-basalt-foreground">
      <span className="size-1.5 shrink-0 rounded-full bg-basalt-warning" />
      <span>
        {season.name}{" "}
        <span className="text-basalt-muted-foreground">(ended {formatted})</span>
      </span>
    </li>
  );
}

export function SnapshotAlert() {
  const { isAdmin, loading } = useAdmin();
  if (loading || !isAdmin) return null;
  return <SnapshotAlertInner />;
}
