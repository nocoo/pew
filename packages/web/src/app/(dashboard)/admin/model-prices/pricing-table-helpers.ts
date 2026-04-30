/**
 * Pure helpers for the /admin/model-prices table.
 *
 * Sort/filter/format logic is split out so it can be unit-tested without
 * pulling in @testing-library/react (not a dep of @pew/web).
 */

import type {
  DynamicPricingEntryDto,
  DynamicPricingOrigin,
} from "@/lib/rpc-types";

export type SortKey =
  | "model"
  | "provider"
  | "displayName"
  | "inputPerMillion"
  | "outputPerMillion"
  | "cachedPerMillion"
  | "contextWindow"
  | "origin"
  | "updatedAt";

export type SortDirection = "asc" | "desc";

const NUMERIC_KEYS = new Set<SortKey>([
  "inputPerMillion",
  "outputPerMillion",
  "cachedPerMillion",
  "contextWindow",
]);

function compareNumeric(a: number | null, b: number | null): number {
  // Nulls sort to the end regardless of direction caller flips.
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}

function compareString(a: string | null, b: string | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a.localeCompare(b);
}

export function sortEntries(
  entries: DynamicPricingEntryDto[],
  key: SortKey = "provider",
  direction: SortDirection = "asc",
): DynamicPricingEntryDto[] {
  const sign = direction === "asc" ? 1 : -1;
  const copy = entries.slice();
  copy.sort((a, b) => {
    let primary: number;
    if (NUMERIC_KEYS.has(key)) {
      primary =
        sign *
        compareNumeric(
          a[key] as number | null,
          b[key] as number | null,
        );
    } else {
      primary =
        sign *
        compareString(
          a[key] as string | null,
          b[key] as string | null,
        );
    }
    if (primary !== 0) return primary;
    // Stable secondary sort: provider asc, then model asc.
    if (key !== "provider") {
      const byProvider = compareString(a.provider, b.provider);
      if (byProvider !== 0) return byProvider;
    }
    if (key !== "model") {
      return compareString(a.model, b.model);
    }
    return 0;
  });
  return copy;
}

export function filterEntries(
  entries: DynamicPricingEntryDto[],
  query: string,
): DynamicPricingEntryDto[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return entries;
  return entries.filter((e) => {
    if (e.model.toLowerCase().includes(q)) return true;
    if (e.displayName?.toLowerCase().includes(q)) return true;
    if (e.provider?.toLowerCase().includes(q)) return true;
    return false;
  });
}

export function originChipClass(origin: DynamicPricingOrigin): string {
  switch (origin) {
    case "baseline":
      return "bg-muted text-muted-foreground";
    case "openrouter":
      return "bg-blue-500/10 text-blue-600 dark:text-blue-400";
    case "models.dev":
      return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
    case "admin":
      return "bg-purple-500/10 text-purple-600 dark:text-purple-400";
  }
}

export function formatNullable(value: number | null, prefix = ""): string {
  if (value == null) return "—";
  return `${prefix}${value}`;
}
