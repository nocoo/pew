/**
 * GET /api/usage/by-device — per-device usage analytics.
 *
 * Query params:
 *   from — ISO date string (default: 30 days ago)
 *   to   — ISO date string (default: now)
 *   granularity — "half-hour" | "day" (default: "day") for timeline
 *
 * Returns { devices, timeline } where:
 *   - devices: aggregated stats per device with estimated_cost
 *   - timeline: token counts per device for charting (day or half-hour granularity)
 */

import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth-helpers";
import { unauthorizedResponse } from "@/lib/api-responses";
import { parseBoundedInt } from "@/lib/query-params";
import { getDbRead } from "@/lib/db";
import { lookupPricing, estimateCost } from "@/lib/pricing";
import { loadPricingMap } from "@/lib/load-pricing-map";

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
    d.setUTCDate(d.getUTCDate() - 30);
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
    return unauthorizedResponse();
  }
  const userId = authResult.userId;

  // 2. Parse query params
  const url = new URL(request.url);
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const granularityParam = url.searchParams.get("granularity");
  const tzOffsetParam = url.searchParams.get("tzOffset");
  const tzOffset = parseBoundedInt(tzOffsetParam, {
    min: -840,
    max: 840,
    defaultValue: 0,
  });

  // Validate granularity
  const granularity: "half-hour" | "day" =
    granularityParam === "half-hour" ? "half-hour" : "day";

  const dateRange = parseDateRange(fromParam, toParam);
  if (!dateRange) {
    return NextResponse.json(
      { error: "Invalid date format" },
      { status: 400 }
    );
  }

  if (tzOffset === "invalid") {
    return NextResponse.json(
      { error: "Invalid tzOffset value" },
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

    // Timeline query — totals per device (day or half-hour granularity)
    const timelineRows = await db.getDeviceTimeline(userId, fromDate, toDate, {
      granularity,
      tzOffset,
    });

    // 4. Build pricing map (dynamic + admin DB rows + safety net)
    const pricingMap = await loadPricingMap(db);

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
