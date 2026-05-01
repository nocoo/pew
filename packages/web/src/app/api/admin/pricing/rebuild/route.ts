/**
 * POST /api/admin/pricing/rebuild — admin-only force-sync of dynamic pricing.
 *
 * Triggers `pricing.rebuildDynamicPricing` on worker-read with
 * `forceRefetch: true` (operator wants fresh upstream).
 *
 * Status discipline:
 *   - outcome.ok=true   → 200 + outcome JSON
 *   - outcome.ok=false  → 207 Multi-Status + outcome JSON (partial failure;
 *                         UI surfaces per-source errors via outcome.errors)
 *   - RPC throws        → 502 + { error, fallback: null }
 */

import { NextResponse } from "next/server";
import { resolveAdmin } from "@/lib/admin";
import { forbiddenResponse } from "@/lib/api-responses";
import { getDbRead } from "@/lib/db";

export async function POST(request: Request): Promise<Response> {
  const admin = await resolveAdmin(request);
  if (!admin) {
    return forbiddenResponse();
  }

  const dbRead = await getDbRead();

  try {
    const outcome = await dbRead.rebuildDynamicPricing({ forceRefetch: true });
    return NextResponse.json(outcome, {
      status: outcome.ok ? 200 : 207,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("admin pricing rebuild failed:", err);
    return NextResponse.json(
      { error: message, fallback: null },
      {
        status: 502,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
}
