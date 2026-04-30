"use client";

import { cn } from "@/lib/utils";
import type { DynamicPricingMetaDto } from "@/lib/rpc-types";

interface Props {
  meta: DynamicPricingMetaDto | null;
  servedFrom: "kv" | "baseline";
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

export function PricingMetaBanner({ meta, servedFrom }: Props) {
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
      ? "bg-destructive/10 text-destructive"
      : stale === "stale"
        ? "bg-yellow-500/10 text-yellow-700 dark:text-yellow-300"
        : "bg-muted text-muted-foreground";

  return (
    <div className="space-y-2">
      <div className={cn("rounded-card p-4 text-sm flex flex-wrap items-center gap-x-4 gap-y-2", stalenessClass)}>
        <span className="font-medium">Last synced:</span>
        <span title={meta.lastSyncedAt}>{formatRelative(meta.lastSyncedAt)}</span>
        <span className="text-xs opacity-70">({meta.lastSyncedAt})</span>
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

      <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
        <span className="rounded-full bg-accent px-2 py-0.5">total {meta.modelCount}</span>
        <span className="rounded-full bg-accent px-2 py-0.5">baseline {meta.baselineCount}</span>
        <span className="rounded-full bg-accent px-2 py-0.5">openrouter {meta.openRouterCount}</span>
        <span className="rounded-full bg-accent px-2 py-0.5">models.dev {meta.modelsDevCount}</span>
        <span className="rounded-full bg-accent px-2 py-0.5">admin {meta.adminOverrideCount}</span>
      </div>
    </div>
  );
}
