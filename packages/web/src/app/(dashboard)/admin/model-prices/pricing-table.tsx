"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DynamicPricingEntryDto } from "@/lib/rpc-types";
import {
  sortEntries,
  filterEntries,
  originChipClass,
  formatNullable,
  type SortKey,
  type SortDirection,
} from "./pricing-table-helpers";

interface Props {
  entries: DynamicPricingEntryDto[];
}

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

export function PricingTable({ entries }: Props) {
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("provider");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");

  const visible = useMemo(() => {
    return sortEntries(filterEntries(entries, filter), sortKey, sortDir);
  }, [entries, filter, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
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
      <input
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by model, display name, or provider…"
        className="w-full max-w-sm rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring/20 transition-shadow"
      />

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
            {visible.map((e) => (
              <tr
                key={`${e.provider}/${e.model}`}
                className="border-b border-border/50 last:border-0 hover:bg-accent/50 transition-colors"
              >
                <td className="px-4 py-3 text-sm font-mono text-foreground" title={e.aliases?.join(", ")}>
                  {e.model}
                </td>
                <td className="px-4 py-3 text-sm">{e.provider ?? "—"}</td>
                <td className="px-4 py-3 text-sm text-muted-foreground">{e.displayName ?? "—"}</td>
                <td className="px-4 py-3 text-sm text-right tabular-nums">
                  {formatNullable(e.inputPerMillion, "$")}
                </td>
                <td className="px-4 py-3 text-sm text-right tabular-nums">
                  {formatNullable(e.outputPerMillion, "$")}
                </td>
                <td className="px-4 py-3 text-sm text-right tabular-nums">
                  {formatNullable(e.cachedPerMillion, "$")}
                </td>
                <td className="px-4 py-3 text-sm text-right tabular-nums">
                  {formatNullable(e.contextWindow)}
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
                <td className="px-4 py-3 text-xs text-muted-foreground" title={e.updatedAt}>
                  {e.updatedAt.slice(0, 10)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-muted-foreground">
        Showing {visible.length} of {entries.length} models
      </div>
    </div>
  );
}
