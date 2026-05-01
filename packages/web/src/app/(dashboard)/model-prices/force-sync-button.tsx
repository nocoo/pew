"use client";

import { useEffect, useState } from "react";
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

const AUTO_DISMISS_MS = 4000;

export function ForceSyncButton({ onComplete }: Props) {
  const [state, setState] = useState<State>({ kind: "idle" });

  useEffect(() => {
    if (state.kind === "idle" || state.kind === "syncing") return;
    const t = setTimeout(() => setState({ kind: "idle" }), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [state]);

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

  return (
    <span className="inline-flex items-center gap-2">
      <Button onClick={handleClick} disabled={state.kind === "syncing"} variant="secondary" size="sm">
        {state.kind === "syncing" ? "Syncing…" : "Force sync"}
      </Button>
      {state.kind === "ok" && (
        <span className="text-[10px] text-emerald-600 dark:text-emerald-400">
          Synced {state.outcome.entriesWritten} entries
        </span>
      )}
      {state.kind === "partial" && (
        <span className="text-[10px] text-yellow-600 dark:text-yellow-400">
          Partial: {state.outcome.entriesWritten} written, {state.outcome.errors.length} failed
        </span>
      )}
      {state.kind === "error" && (
        <span className="text-[10px] text-destructive">{state.message}</span>
      )}
    </span>
  );
}
