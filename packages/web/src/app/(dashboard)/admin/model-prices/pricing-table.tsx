"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DynamicPricingEntryDto } from "@/lib/rpc-types";
import {
  sortEntries,
  filterEntries,
  filterByFacets,
  originChipClass,
  formatPrice,
  formatContext,
  providerIconPath,
  type SortKey,
  type SortDirection,
} from "./pricing-table-helpers";

interface Props {
  entries: DynamicPricingEntryDto[];
}

const PAGE_SIZE = 50;

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "model", label: "Model" },
  { key: "provider", label: "Provider" },
  { key: "displayName", label: "Display name" },
  { key: "inputPerMillion", label: "Input", numeric: true },
  { key: "outputPerMillion", label: "Output", numeric: true },
  { key: "cachedPerMillion", label: "Cached", numeric: true },
  { key: "contextWindow", label: "Context", numeric: true },
  { key: "origin", label: "Origin" },
  { key: "updatedAt", label: "Updated" },
];

const KNOWN_ORIGINS = ["baseline", "openrouter", "models.dev", "admin"] as const;

export function PricingTable({ entries }: Props) {
  const [filter, setFilter] = useState("");
  const [provider, setProvider] = useState("");
  const [origin, setOrigin] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("provider");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");
  const [page, setPage] = useState(0);

  const providers = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) {
      if (e.provider) set.add(e.provider);
    }
    return Array.from(set).sort();
  }, [entries]);

  const visible = useMemo(() => {
    const faceted = filterByFacets(entries, {
      provider: provider || undefined,
      origin: origin || undefined,
    });
    return sortEntries(filterEntries(faceted, filter), sortKey, sortDir);
  }, [entries, filter, provider, origin, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paged = visible.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const rangeStart = visible.length === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const rangeEnd = Math.min((safePage + 1) * PAGE_SIZE, visible.length);

  const resetPage = () => setPage(0);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    resetPage();
  };

  if (entries.length === 0) {
    return (
      <div className="rounded-card bg-secondary p-8 text-center text-sm text-muted-foreground">
        No pricing data available — check the meta banner for sync status.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="search"
          value={filter}
          onChange={(e) => { setFilter(e.target.value); resetPage(); }}
          placeholder="Filter by model, display name, or provider…"
          className="w-full max-w-sm rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring/20 transition-shadow"
        />
        <div className="relative flex items-center rounded-lg bg-secondary p-1">
          <span className="pl-2 pr-1 text-xs text-muted-foreground select-none">Provider:</span>
          <select
            value={provider}
            onChange={(e) => { setProvider(e.target.value); resetPage(); }}
            className="appearance-none rounded-md bg-transparent pl-2 pr-6 py-1.5 text-xs font-medium text-foreground outline-none cursor-pointer"
          >
            <option value="">All</option>
            {providers.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" strokeWidth={2} />
        </div>
        <div className="relative flex items-center rounded-lg bg-secondary p-1">
          <span className="pl-2 pr-1 text-xs text-muted-foreground select-none">Origin:</span>
          <select
            value={origin}
            onChange={(e) => { setOrigin(e.target.value); resetPage(); }}
            className="appearance-none rounded-md bg-transparent pl-2 pr-6 py-1.5 text-xs font-medium text-foreground outline-none cursor-pointer"
          >
            <option value="">All</option>
            {KNOWN_ORIGINS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" strokeWidth={2} />
        </div>
      </div>

      <div className="rounded-xl bg-secondary p-1 overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => toggleSort(col.key)}
                  className={cn(
                    "px-4 py-3 text-xs font-medium text-muted-foreground cursor-pointer select-none",
                    col.numeric ? "text-right" : "text-left",
                  )}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {sortKey === col.key &&
                      (sortDir === "asc" ? (
                        <ArrowUp className="h-3 w-3" strokeWidth={1.5} />
                      ) : (
                        <ArrowDown className="h-3 w-3" strokeWidth={1.5} />
                      ))}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.map((e) => (
              <tr
                key={`${e.provider}/${e.model}`}
                className="border-b border-border/50 last:border-0 hover:bg-accent/50 transition-colors"
              >
                <td className="px-4 py-3 text-sm font-mono text-foreground" title={e.aliases?.join(", ")}>
                  {e.model}
                </td>
                <td className="px-4 py-3 text-sm">
                  <span className="inline-flex items-center gap-1.5">
                    {(() => {
                      const icon = providerIconPath(e.provider);
                      return icon ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={icon.src}
                          alt=""
                          className={cn("h-3.5 w-3.5 shrink-0", icon.invert && "dark:invert")}
                        />
                      ) : null;
                    })()}
                    {e.provider ?? "—"}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-muted-foreground">{e.displayName ?? "—"}</td>
                <td className="px-4 py-3 text-sm text-right tabular-nums">
                  {formatPrice(e.inputPerMillion)}
                </td>
                <td className="px-4 py-3 text-sm text-right tabular-nums">
                  {formatPrice(e.outputPerMillion)}
                </td>
                <td className="px-4 py-3 text-sm text-right tabular-nums">
                  {formatPrice(e.cachedPerMillion)}
                </td>
                <td className="px-4 py-3 text-sm text-right tabular-nums">
                  {formatContext(e.contextWindow)}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-medium",
                      originChipClass(e.origin),
                    )}
                  >
                    {e.origin}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap" title={e.updatedAt}>
                  {e.updatedAt.slice(0, 10)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Showing {rangeStart}–{rangeEnd} of {visible.length} models
        </span>
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className="rounded p-1 hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-2">
              {safePage + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
              className="rounded p-1 hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
