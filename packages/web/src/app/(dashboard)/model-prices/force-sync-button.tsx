"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { SyncOutcomeDto } from "@/lib/rpc-types";

interface Props {
  onComplete?: (outcome: SyncOutcomeDto) => void;
}

type State =
  | { kind: "idle" }
  | { kind: "syncing" }
  | { kind: "ok"; outcome: SyncOutcomeDto }
  | { kind: "partial"; outcome: SyncOutcomeDto }
  | { kind: "error"; message: string };

export function ForceSyncButton({ onComplete }: Props) {
  const [state, setState] = useState<State>({ kind: "idle" });

  const handleClick = async () => {
    setState({ kind: "syncing" });
    try {
      const res = await fetch("/api/admin/pricing/rebuild", { method: "POST" });
      const body = (await res.json()) as SyncOutcomeDto | { error: string };

      if (res.status === 200) {
        const outcome = body as SyncOutcomeDto;
        setState({ kind: "ok", outcome });
        onComplete?.(outcome);
        return;
      }
      if (res.status === 207) {
        const outcome = body as SyncOutcomeDto;
        setState({ kind: "partial", outcome });
        onComplete?.(outcome);
        return;
      }
      const message =
        (body as { error?: string }).error ?? `Sync failed (HTTP ${res.status})`;
      setState({ kind: "error", message });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  };

  const disabled = state.kind === "syncing";

  return (
    <>
      <Button onClick={handleClick} disabled={disabled} variant="secondary" size="sm">
        {state.kind === "syncing" ? "Syncing…" : "Force sync"}
      </Button>

      {state.kind === "ok" && (
        <div className="w-full rounded-card bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300">
          Synced {state.outcome.entriesWritten} entries.
        </div>
      )}

      {state.kind === "partial" && (
        <div className="w-full rounded-card bg-yellow-500/10 p-3 text-xs text-yellow-700 dark:text-yellow-300 space-y-1">
          <div>
            Partial sync: wrote {state.outcome.entriesWritten} entries; some
            sources failed.
          </div>
          {state.outcome.errors.map((e, i) => (
            <div key={i} className="font-mono">
              [{e.source}] {e.message}
            </div>
          ))}
        </div>
      )}

      {state.kind === "error" && (
        <div className="w-full rounded-card bg-destructive/10 p-3 text-xs text-destructive">
          {state.message}
        </div>
      )}
    </>
  );
}
