/**
 * Loads admin pricing rows from D1 (`model_pricing` table).
 *
 * Returns `{ rows, error? }` so the orchestrator can surface a `d1` error in
 * SyncOutcome while still degrading gracefully (admin overlay is best-effort).
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

export interface LoadAdminRowsResult {
  rows: AdminPricingRow[];
  error: string | null;
}

export async function loadAdminRows(db: D1Database): Promise<LoadAdminRowsResult> {
  try {
    const result = await db
      .prepare("SELECT model, source, input, output, cached FROM model_pricing")
      .all<ModelPricingDbRow>();
    const rows = (result.results ?? []).map((r) => ({
      model: r.model,
      source: r.source,
      input: r.input,
      output: r.output,
      cached: r.cached,
    }));
    return { rows, error: null };
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    console.error("dynamic pricing admin-loader d1 error:", err);
    return { rows: [], error: message };
  }
}
