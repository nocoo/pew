import type { DynamicPricingEntryDto } from "@/lib/rpc-types";

/**
 * Extract the bare model name by stripping tilde and provider prefix.
 *   "~openai/gpt-5.5"  → "gpt-5.5"
 *   "anthropic/claude-sonnet-4" → "claude-sonnet-4"
 *   "gpt-4.1" → "gpt-4.1"
 */
export function bareModelName(id: string): string {
  let name = id.trim().toLowerCase();
  if (name.startsWith("~")) name = name.slice(1);
  const slash = name.indexOf("/");
  if (slash >= 0) name = name.slice(slash + 1);
  return name;
}

/**
 * Normalize for fuzzy version matching: bare name + dots → hyphens.
 *   "claude-opus-4.7" → "claude-opus-4-7"
 *   "openai/gpt-5.5"  → "gpt-5-5"
 */
export function normalizeForMatch(id: string): string {
  return bareModelName(id).replace(/\./g, "-");
}

/**
 * Strip known variant suffixes for relaxed matching.
 * Handles context-window tags (-1m, -200k), date stamps (-20250514),
 * and OpenRouter qualifiers (:free, :beta, :extended, :nitro).
 *   "claude-opus-4-6-1m"      → "claude-opus-4-6"
 *   "gpt-4o-2024-08-06"       → "gpt-4o"        (NOT stripped — 8-digit inside)
 *   "claude-sonnet-4-20250514" → "claude-sonnet-4"
 *   "model:free"               → "model"
 */
export function stripVariantSuffix(name: string): string {
  return name
    .replace(/[:](free|beta|extended|nitro)$/i, "")
    .replace(/-\d{6,8}$/, "")
    .replace(/-\d+[km]$/i, "");
}

/**
 * Find all pricing entries that match a given model identifier.
 *
 * Multi-level matching (first level with hits wins):
 *   1. Exact match on `model` or `aliases` (case-insensitive)
 *   2. Bare-name match — strip `~` and `provider/` prefix, then compare
 *   3. Fuzzy match — additionally normalize `.` ↔ `-` for version variants
 *   4. Suffix-stripped — strip context-window (-1m), date (-20250514),
 *      and qualifier (:free) suffixes from both sides
 *
 * Lookup is case-insensitive at all levels.
 */
export function findPricingEntriesForModel(
  entries: readonly DynamicPricingEntryDto[],
  model: string,
): DynamicPricingEntryDto[] {
  const needle = model.trim().toLowerCase();
  if (!needle) return [];

  const needleBare = bareModelName(model);
  const needleNorm = normalizeForMatch(model);
  const needleStripped = stripVariantSuffix(needleNorm);

  const exactMatches: DynamicPricingEntryDto[] = [];
  const bareMatches: DynamicPricingEntryDto[] = [];
  const fuzzyMatches: DynamicPricingEntryDto[] = [];
  const suffixMatches: DynamicPricingEntryDto[] = [];

  for (const entry of entries) {
    const candidates = [entry.model, ...(entry.aliases ?? [])];
    const candidatesLower = candidates.map((c) => c.trim().toLowerCase());

    if (candidatesLower.some((c) => c === needle)) {
      exactMatches.push(entry);
    } else if (candidates.some((c) => bareModelName(c) === needleBare)) {
      bareMatches.push(entry);
    } else if (candidates.some((c) => normalizeForMatch(c) === needleNorm)) {
      fuzzyMatches.push(entry);
    } else if (candidates.some((c) => stripVariantSuffix(normalizeForMatch(c)) === needleStripped)) {
      suffixMatches.push(entry);
    }
  }

  const matches = exactMatches.length > 0
    ? exactMatches
    : bareMatches.length > 0
      ? bareMatches
      : fuzzyMatches.length > 0
        ? fuzzyMatches
        : suffixMatches;

  // Dedup by (model, provider, origin)
  const seen = new Set<string>();
  const deduped: DynamicPricingEntryDto[] = [];
  for (const entry of matches) {
    const key = `${entry.model}|${entry.provider}|${entry.origin}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
  }

  // Stable order: baseline → openrouter → models.dev
  const ORIGIN_RANK: Record<DynamicPricingEntryDto["origin"], number> = {
    baseline: 0,
    openrouter: 1,
    "models.dev": 2,
  };
  return deduped.sort((a, b) => {
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
