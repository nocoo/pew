/**
 * Model name formatting and evolution helpers.
 */

import type { UsageRow } from "@/hooks/use-usage-data";
import { toLocalDateStr } from "@/lib/usage-helpers";

/**
 * Truncate long model names for chart Y-axis labels.
 *
 * Strips common prefixes ("models/") and date suffixes ("-YYYYMMDD"),
 * then truncates to 24 characters with ellipsis.
 */
export function shortModel(model: string): string {
  const cleaned = model
    .replace(/^models\//, "")
    .replace(/-\d{8}$/, "");
  return cleaned.length > 24 ? cleaned.slice(0, 22) + "..." : cleaned;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelEra {
  date: string;
  /** Token counts per model, e.g. { "claude-sonnet-4": 40000, "gemini-2.5-pro": 10000 } */
  models: Record<string, number>;
}

// ---------------------------------------------------------------------------
// toModelEvolutionPoints
// ---------------------------------------------------------------------------

/**
 * Produce daily model evolution data points.
 *
 * Identifies the top N models by total tokens across the entire period,
 * optionally groups the rest as "Other", and returns one entry per date
 * with per-model token counts (zero-filled for missing models on a given day).
 */
export function toModelEvolutionPoints(
  rows: UsageRow[],
  topN = 5,
  tzOffset: number = 0,
  includeOther = true,
): ModelEra[] {
  if (rows.length === 0) return [];

  // 1. Compute global totals per model to determine top N
  const globalTotals = new Map<string, number>();
  for (const r of rows) {
    globalTotals.set(r.model, (globalTotals.get(r.model) ?? 0) + r.total_tokens);
  }

  // Sort by total descending, pick top N
  const ranked = Array.from(globalTotals.entries())
    .sort((a, b) => b[1] - a[1]);
  const topModels = new Set(ranked.slice(0, topN).map(([m]) => m));
  const hasOther = includeOther && ranked.length > topN;

  // 2. Accumulate by (date, model), grouping non-top as "Other"
  const byDate = new Map<string, Map<string, number>>();

  for (const r of rows) {
    const date = toLocalDateStr(r.hour_start, tzOffset);
    const model = topModels.has(r.model) ? r.model : (includeOther ? "Other" : null);
    if (model === null) continue; // Skip if not including Other and not top N

    let dateMap = byDate.get(date);
    if (!dateMap) {
      dateMap = new Map<string, number>();
      byDate.set(date, dateMap);
    }
    dateMap.set(model, (dateMap.get(model) ?? 0) + r.total_tokens);
  }

  // 3. Build result with zero-fill
  const allModelKeys = Array.from(topModels);
  if (hasOther) allModelKeys.push("Other");

  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dateMap]) => {
      const models: Record<string, number> = {};
      for (const m of allModelKeys) {
        models[m] = dateMap.get(m) ?? 0;
      }
      return { date, models };
    });
}
