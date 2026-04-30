/**
 * Loads admin pricing rows from D1 (`model_pricing` table).
 *
 * Returns [] on query error — the admin overlay is best-effort and must never
 * block a sync run. Upstream + baseline still produce a valid output.
 */

import type { D1Database } from "@cloudflare/workers-types";

import type { AdminPricingRow } from "./types";

interface ModelPricingDbRow {
  model: string;
  source: string | null;
  input: number;
  output: number;
  cached: number | null;
}

export async function loadAdminRows(db: D1Database): Promise<AdminPricingRow[]> {
  try {
    const result = await db
      .prepare("SELECT model, source, input, output, cached FROM model_pricing")
      .all<ModelPricingDbRow>();
    const rows = result.results ?? [];
    return rows.map((r) => ({
      model: r.model,
      source: r.source,
      input: r.input,
      output: r.output,
      cached: r.cached,
    }));
  } catch (err) {
    console.error("dynamic pricing admin-loader d1 error:", err);
    return [];
  }
}
