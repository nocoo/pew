"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { DynamicPricingMetaDto } from "@/lib/rpc-types";

interface Props {
  meta: DynamicPricingMetaDto | null;
  servedFrom: "kv" | "baseline";
  children?: ReactNode;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return iso;
  const diff = Date.now() - t;
  if (diff < HOUR_MS) return `${Math.max(1, Math.round(diff / 60000))} min ago`;
  if (diff < DAY_MS) return `${Math.round(diff / HOUR_MS)} h ago`;
  return `${Math.round(diff / DAY_MS)} d ago`;
}

function staleness(iso: string): "fresh" | "stale" | "danger" {
  const ageMs = Date.now() - new Date(iso).getTime();
  if (ageMs > 7 * DAY_MS) return "danger";
  if (ageMs > 36 * HOUR_MS) return "stale";
  return "fresh";
}

export function PricingMetaBanner({ meta, servedFrom, children }: Props) {
  if (!meta) {
    return (
      <div className="rounded-card bg-destructive/10 p-4 text-sm text-destructive">
        Pricing meta unavailable — worker-read may be down.
      </div>
    );
  }

  const stale = staleness(meta.lastSyncedAt);
  const stalenessClass =
    stale === "danger"
      ? "text-destructive"
      : stale === "stale"
        ? "text-yellow-700 dark:text-yellow-300"
        : "text-muted-foreground";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card bg-secondary px-4 py-3 text-sm">
        <span className={cn("font-medium", stalenessClass)} title={meta.lastSyncedAt}>
          Last synced: {formatRelative(meta.lastSyncedAt)}
        </span>
        <span className="hidden sm:inline text-border">|</span>
        <div className="flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
          <span className="rounded-full bg-accent px-2 py-0.5">total {meta.modelCount}</span>
          <span className="rounded-full bg-accent px-2 py-0.5">baseline {meta.baselineCount}</span>
          <span className="rounded-full bg-accent px-2 py-0.5">openrouter {meta.openRouterCount}</span>
          <span className="rounded-full bg-accent px-2 py-0.5">models.dev {meta.modelsDevCount}</span>
        </div>
        {children && <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>}
      </div>

      {servedFrom === "baseline" && (
        <div className="rounded-card bg-orange-500/10 p-3 text-xs text-orange-700 dark:text-orange-300">
          Showing bundled baseline — KV cache is empty (cold start) or worker-read is unreachable.
        </div>
      )}

      {meta.lastErrors && meta.lastErrors.length > 0 && (
        <div className="rounded-card bg-destructive/10 p-3 text-xs text-destructive space-y-1">
          {meta.lastErrors.map((e, i) => (
            <div key={i} className="font-mono">
              [{e.source}] {e.message} — at {e.at}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
