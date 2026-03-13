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
import { getD1Client } from "@/lib/d1";
import {
  getDefaultPricingMap,
  buildPricingMap,
  lookupPricing,
  estimateCost,
  type DbPricingRow,
} from "@/lib/pricing";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DeviceSummaryRow {
  device_id: string;
  alias: string | null;
  first_seen: string;
  last_seen: string;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  reasoning_output_tokens: number;
  sources: string; // GROUP_CONCAT result
  models: string; // GROUP_CONCAT result
}

interface CostDetailRow {
  device_id: string;
  source: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
}

interface TimelineRow {
  date: string;
  device_id: string;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
}

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
  const params = [userId, fromDate, toDate];

  // 3. Execute queries
  const client = getD1Client();

  try {
    // Summary query — one row per device with aggregated stats + alias
    const summaryResult = await client.query<DeviceSummaryRow>(
      `SELECT
        ur.device_id,
        da.alias,
        MIN(ur.hour_start) AS first_seen,
        MAX(ur.hour_start) AS last_seen,
        SUM(ur.total_tokens) AS total_tokens,
        SUM(ur.input_tokens) AS input_tokens,
        SUM(ur.output_tokens) AS output_tokens,
        SUM(ur.cached_input_tokens) AS cached_input_tokens,
        SUM(ur.reasoning_output_tokens) AS reasoning_output_tokens,
        GROUP_CONCAT(DISTINCT ur.source) AS sources,
        GROUP_CONCAT(DISTINCT ur.model) AS models
      FROM usage_records ur
      LEFT JOIN device_aliases da
        ON da.user_id = ur.user_id AND da.device_id = ur.device_id
      WHERE ur.user_id = ?
        AND ur.hour_start >= ?
        AND ur.hour_start < ?
      GROUP BY ur.device_id
      ORDER BY total_tokens DESC`,
      params
    );

    // Cost detail query — per (device, source, model) for accurate pricing
    const costResult = await client.query<CostDetailRow>(
      `SELECT
        ur.device_id,
        ur.source,
        ur.model,
        SUM(ur.input_tokens) AS input_tokens,
        SUM(ur.output_tokens) AS output_tokens,
        SUM(ur.cached_input_tokens) AS cached_input_tokens
      FROM usage_records ur
      WHERE ur.user_id = ?
        AND ur.hour_start >= ?
        AND ur.hour_start < ?
      GROUP BY ur.device_id, ur.source, ur.model`,
      params
    );

    // Timeline query — daily totals per device
    const timelineResult = await client.query<TimelineRow>(
      `SELECT
        date(ur.hour_start) AS date,
        ur.device_id,
        SUM(ur.total_tokens) AS total_tokens,
        SUM(ur.input_tokens) AS input_tokens,
        SUM(ur.output_tokens) AS output_tokens,
        SUM(ur.cached_input_tokens) AS cached_input_tokens
      FROM usage_records ur
      WHERE ur.user_id = ?
        AND ur.hour_start >= ?
        AND ur.hour_start < ?
      GROUP BY date(ur.hour_start), ur.device_id
      ORDER BY date ASC`,
      params
    );

    // 4. Build pricing map (merge static defaults + DB overrides)
    let pricingMap;
    try {
      const { results: pricingRows } = await client.query<DbPricingRow>(
        "SELECT * FROM model_pricing ORDER BY model ASC"
      );
      pricingMap = buildPricingMap(pricingRows);
    } catch {
      // Table might not exist yet — fall back to static defaults
      pricingMap = getDefaultPricingMap();
    }

    // 5. Compute estimated_cost per device from cost detail rows
    const costByDevice = new Map<string, number>();

    for (const row of costResult.results) {
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
    const devices = summaryResult.results.map((row) => ({
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

    const timeline = timelineResult.results.map((row) => ({
      date: row.date,
      device_id: row.device_id,
      total_tokens: row.total_tokens,
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
      cached_input_tokens: row.cached_input_tokens,
    }));

    return NextResponse.json({ devices, timeline });
  } catch (err) {
    console.error("Failed to query by-device usage:", err);
    return NextResponse.json(
      { error: "Failed to query by-device usage data" },
      { status: 500 }
    );
  }
}
