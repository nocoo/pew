import type { DynamicPricingEntryDto } from "@/lib/rpc-types";

/**
 * Find all pricing entries that match a given model identifier.
 *
 * Matches by exact `model` string OR membership in any entry's `aliases`
 * list. The same logical model can show up multiple times across origins
 * (baseline / openrouter / models.dev) or providers, and all of them are
 * returned so callers can render a comparison view.
 *
 * Lookup is case-insensitive on the comparison key.
 */
export function findPricingEntriesForModel(
  entries: readonly DynamicPricingEntryDto[],
  model: string,
): DynamicPricingEntryDto[] {
  const needle = model.trim().toLowerCase();
  if (!needle) return [];

  const matches: DynamicPricingEntryDto[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const candidates = [entry.model, ...(entry.aliases ?? [])];
    const hit = candidates.some((c) => c.trim().toLowerCase() === needle);
    if (!hit) continue;

    // Dedup by (model, provider, origin) — the same triple appearing twice
    // would just be a sync glitch; show one.
    const key = `${entry.model}|${entry.provider}|${entry.origin}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push(entry);
  }

  // Stable order: baseline first, then openrouter, then models.dev. Falls
  // back to provider then model for ties.
  const ORIGIN_RANK: Record<DynamicPricingEntryDto["origin"], number> = {
    baseline: 0,
    openrouter: 1,
    "models.dev": 2,
  };
  return matches.sort((a, b) => {
    const r = ORIGIN_RANK[a.origin] - ORIGIN_RANK[b.origin];
    if (r !== 0) return r;
    const p = (a.provider ?? "").localeCompare(b.provider ?? "");
    if (p !== 0) return p;
    return a.model.localeCompare(b.model);
  });
}

/** Format a per-million USD value as `$3.00 / 1M`. Returns `—` for null. */
export function formatPerMillion(value: number | null | undefined): string {
  if (value == null) return "—";
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(4)} / 1M`;
  return `$${value.toFixed(2)} / 1M`;
}

/** Format a context window value (e.g. 200000 → "200K"). */
export function formatContextWindow(
  value: number | null | undefined,
): string | null {
  if (value == null || value <= 0) return null;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}
