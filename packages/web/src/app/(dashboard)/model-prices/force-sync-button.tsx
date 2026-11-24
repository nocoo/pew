"use client";

import { useEffect, useState } from "react";
import { Banner } from "@nocoo/basalt/components/banner";
import { Button } from "@nocoo/basalt/components/button";
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
      setState({ kind: "error", message: "Could not refresh prices. Please try again." });
    } catch {
      setState({
        kind: "error",
        message: "Could not refresh prices. Please try again.",
      });
    }
  };

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        onClick={handleClick}
        disabled={state.kind === "syncing"}
        variant="secondary"
        size="sm"
      >
        {state.kind === "syncing" ? "Refreshing…" : "Refresh prices"}
      </Button>
      {state.kind === "ok" && <Banner tone="neutral" size="sm" description="Prices updated" />}
      {state.kind === "partial" && (
        <Banner tone="warning" size="sm" description="Some prices could not be refreshed" />
      )}
      {state.kind === "error" && <Banner tone="danger" size="sm" description={state.message} />}
    </span>
  );
}
