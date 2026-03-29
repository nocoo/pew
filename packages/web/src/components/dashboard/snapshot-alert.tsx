"use client";

/**
 * Admin-only dialog that warns when ended seasons haven't been snapshotted.
 *
 * Self-contained: owns admin check + data fetching internally.
 * Session-scoped dismiss — reappears on page reload so admins are reminded.
 */

import { useState } from "react";
import { Dialog } from "radix-ui";
import { AlertTriangle } from "lucide-react";
import { useAdmin } from "@/hooks/use-admin";
import { useSeasons, type SeasonListItem } from "@/hooks/use-seasons";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Inner component — only mounted when admin is confirmed (avoids unnecessary
// /api/seasons call for non-admin users).
// ---------------------------------------------------------------------------

function SnapshotAlertInner() {
  const { data, loading } = useSeasons({ status: "ended" });
  const [dismissed, setDismissed] = useState(false);

  if (loading || !data) return null;

  const unsnapshotted = data.seasons.filter((s) => !s.has_snapshot);
  if (unsnapshotted.length === 0) return null;
  if (dismissed) return null;

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) setDismissed(true); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-card p-6 shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95">
          {/* Header */}
          <div className="flex items-center gap-2 mb-4">
            <div className="flex size-8 items-center justify-center rounded-lg bg-warning/10">
              <AlertTriangle className="size-4 text-warning" strokeWidth={1.5} />
            </div>
            <Dialog.Title className="text-lg font-semibold text-foreground">
              Seasons Pending Snapshot
            </Dialog.Title>
          </div>

          <Dialog.Description className="text-sm text-muted-foreground mb-4">
            The following ended seasons haven&apos;t been snapshotted yet. Leaderboard
            results are still based on live data.
          </Dialog.Description>

          {/* Season list */}
          <ul className="mb-6 space-y-1.5">
            {unsnapshotted.map((s) => (
              <SeasonRow key={s.id} season={s} />
            ))}
          </ul>

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setDismissed(true)}>
              Dismiss
            </Button>
            <Button size="sm" asChild>
              <a href="/admin/seasons">Go to Seasons</a>
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ---------------------------------------------------------------------------
// Season row
// ---------------------------------------------------------------------------

function SeasonRow({ season }: { season: SeasonListItem }) {
  const endDate = new Date(season.end_date);
  const formatted = endDate.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  return (
    <li className="flex items-center gap-2 text-sm text-foreground">
      <span className="size-1.5 shrink-0 rounded-full bg-warning" />
      <span>
        {season.name}{" "}
        <span className="text-muted-foreground">(ended {formatted})</span>
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Public component — gate on admin status
// ---------------------------------------------------------------------------

export function SnapshotAlert() {
  const { isAdmin, loading } = useAdmin();

  if (loading || !isAdmin) return null;

  return <SnapshotAlertInner />;
}
