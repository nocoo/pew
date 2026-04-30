/**
 * GET /api/admin/pricing/models — admin-only view of dynamic pricing entries.
 *
 * Reads from worker-read's KV-backed `pricing.getDynamicPricing` /
 * `pricing.getDynamicPricingMeta`. Strictly read-only.
 */

import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth-helpers";
import { isAdminUser } from "@/lib/admin";
import { getDbRead } from "@/lib/db";

export async function GET(request: Request) {
  const authResult = await resolveUser(request);
  if (!authResult) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = await isAdminUser(authResult);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const dbRead = await getDbRead();
    const [dyn, meta] = await Promise.all([
      dbRead.getDynamicPricing(),
      dbRead.getDynamicPricingMeta(),
    ]);

    return NextResponse.json(
      {
        entries: dyn.entries,
        servedFrom: dyn.servedFrom,
        meta,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    console.error("Failed to load dynamic pricing:", err);
    return NextResponse.json(
      {
        error: "Failed to load dynamic pricing",
        fallback: { entries: [], meta: null },
      },
      { status: 503 },
    );
  }
}
