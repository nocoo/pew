/**
 * GET /api/usage/by-device — per-device usage analytics.
 *
 * Query params:
 *   from — ISO date string (default: 30 days ago)
 *   to   — ISO date string (default: now)
 *
 * Returns { devices, timeline } where:
 *   - devices: aggregated stats per device with estimated_cost
 *   - timeline: daily token counts per device for charting
 */

import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth-helpers";
import { getDbRead } from "@/lib/db";
import {
  getDefaultPricingMap,
  buildPricingMap,
  lookupPricing,
  estimateCost,
} from "@/lib/pricing";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

function parseDateRange(fromParam: string | null, toParam: string | null) {
  let fromDate: string;
  let toDate: string;

  if (fromParam) {
    if (!DATE_RE.test(fromParam)) return null;
    fromDate = new Date(fromParam).toISOString();
  } else {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    fromDate = d.toISOString();
  }

  if (toParam) {
    if (!DATE_RE.test(toParam)) return null;
    // Bare date "YYYY-MM-DD" → inclusive: bump +1 UTC day for `< toDate`
    const toD = new Date(toParam);
    if (toParam.length === 10) {
      toD.setUTCDate(toD.getUTCDate() + 1);
    }
    toDate = toD.toISOString();
  } else {
    toDate = new Date().toISOString();
  }

  return { fromDate, toDate };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  // 1. Authenticate
  const authResult = await resolveUser(request);
  if (!authResult) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = authResult.userId;

  // 2. Parse query params
  const url = new URL(request.url);
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  const dateRange = parseDateRange(fromParam, toParam);
  if (!dateRange) {
    return NextResponse.json(
      { error: "Invalid date format" },
      { status: 400 }
    );
  }
  const { fromDate, toDate } = dateRange;

  // 3. Execute queries via RPC
  const db = await getDbRead();

  try {
    // Summary query — one row per device with aggregated stats + alias
    const summaryRows = await db.getDeviceSummary(userId, fromDate, toDate);

    // Cost detail query — per (device, source, model) for accurate pricing
    const costRows = await db.getDeviceCostDetails(userId, fromDate, toDate);

    // Timeline query — daily totals per device
    const timelineRows = await db.getDeviceTimeline(userId, fromDate, toDate);

    // 4. Build pricing map (merge static defaults + DB overrides)
    let pricingMap;
    try {
      const pricingRows = await db.listModelPricing();
      pricingMap = buildPricingMap(pricingRows);
    } catch {
      // Table might not exist yet — fall back to static defaults
      pricingMap = getDefaultPricingMap();
    }

    // 5. Compute estimated_cost per device from cost detail rows
    const costByDevice = new Map<string, number>();

    for (const row of costRows) {
      const pricing = lookupPricing(pricingMap, row.model, row.source);
      const { totalCost } = estimateCost(
        row.input_tokens,
        row.output_tokens,
        row.cached_input_tokens,
        pricing
      );
      costByDevice.set(
        row.device_id,
        (costByDevice.get(row.device_id) ?? 0) + totalCost
      );
    }

    // 6. Assemble response
    const devices = summaryRows.map((row) => ({
      device_id: row.device_id,
      alias: row.alias,
      first_seen: row.first_seen,
      last_seen: row.last_seen,
      total_tokens: row.total_tokens,
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
      cached_input_tokens: row.cached_input_tokens,
      reasoning_output_tokens: row.reasoning_output_tokens,
      estimated_cost: costByDevice.get(row.device_id) ?? 0,
      sources: row.sources ? row.sources.split(",") : [],
      models: row.models ? row.models.split(",") : [],
    }));

    const timeline = timelineRows.map((row) => ({
      date: row.date,
      device_id: row.device_id,
      total_tokens: row.total_tokens,
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
      cached_input_tokens: row.cached_input_tokens,
    }));

    // 7. Map cost detail rows for client-side drill-down charts
    const deviceDetails = costRows.map((row) => ({
      device_id: row.device_id,
      source: row.source,
      model: row.model,
      total_tokens:
        row.input_tokens + row.output_tokens + row.cached_input_tokens,
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
      cached_input_tokens: row.cached_input_tokens,
    }));

    return NextResponse.json({ devices, timeline, deviceDetails });
  } catch (err) {
    console.error("Failed to query by-device usage:", err);
    return NextResponse.json(
      { error: "Failed to query by-device usage data" },
      { status: 500 }
    );
  }
}
