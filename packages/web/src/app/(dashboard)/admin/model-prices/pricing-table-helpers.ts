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
      const av = a[key] as number | null;
      const bv = b[key] as number | null;
      // Nulls always sort to the end regardless of direction.
      if (av == null && bv == null) primary = 0;
      else if (av == null) primary = 1;
      else if (bv == null) primary = -1;
      else primary = sign * (av - bv);
    } else {
      const av = a[key] as string | null;
      const bv = b[key] as string | null;
      if (av == null && bv == null) primary = 0;
      else if (av == null) primary = 1;
      else if (bv == null) primary = -1;
      else primary = sign * av.localeCompare(bv);
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

export function formatPrice(value: number | null): string {
  if (value == null) return "—";
  return `$${value.toFixed(2)}`;
}

export function formatContext(value: number | null): string {
  if (value == null) return "—";
  if (value >= 1_000_000) return `${value / 1_000_000}M`;
  if (value >= 1_000) {
    const k = value / 1_000;
    return `${k % 1 === 0 ? k : k}K`;
  }
  return String(value);
}

export interface FacetFilter {
  provider?: string | undefined;
  origin?: string | undefined;
}

export function filterByFacets(
  entries: DynamicPricingEntryDto[],
  facets: FacetFilter,
): DynamicPricingEntryDto[] {
  let result = entries;
  if (facets.provider) {
    result = result.filter((e) => e.provider === facets.provider);
  }
  if (facets.origin) {
    result = result.filter((e) => e.origin === facets.origin);
  }
  return result;
}
