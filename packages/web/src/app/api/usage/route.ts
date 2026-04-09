/**
 * GET /api/usage — query usage data for the authenticated user.
 *
 * Query params:
 *   from  — ISO date string (default: 30 days ago)
 *   to    — ISO date string (default: now)
 *   source — filter by source (optional)
 *   granularity — "half-hour" | "day" (default: "half-hour")
 *
 * Returns { records, summary }.
 */

import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth-helpers";
import { getDbRead } from "@/lib/db";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_SOURCES = new Set([
  "claude-code",
  "codex",
  "copilot-cli",
  "gemini-cli",
  "hermes",
  "kosmos",
  "opencode",
  "openclaw",
  "pi",
  "pmstudio",
  "vscode-copilot",
]);

const VALID_GRANULARITIES = new Set(["half-hour", "day"]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

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
  const sourceFilter = url.searchParams.get("source");
  const granularity = url.searchParams.get("granularity") ?? "half-hour";
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  // Validate source filter
  if (sourceFilter && !VALID_SOURCES.has(sourceFilter)) {
    return NextResponse.json(
      { error: `Invalid source: "${sourceFilter}"` },
      { status: 400 }
    );
  }

  // Validate granularity
  if (!VALID_GRANULARITIES.has(granularity)) {
    return NextResponse.json(
      { error: `Invalid granularity: "${granularity}"` },
      { status: 400 }
    );
  }

  // Validate and compute date range
  let fromDate: string;
  let toDate: string;

  if (fromParam) {
    if (!DATE_RE.test(fromParam)) {
      return NextResponse.json(
        { error: "Invalid from date format" },
        { status: 400 }
      );
    }
    fromDate = new Date(fromParam).toISOString();
  } else {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    fromDate = d.toISOString();
  }

  if (toParam) {
    if (!DATE_RE.test(toParam)) {
      return NextResponse.json(
        { error: "Invalid to date format" },
        { status: 400 }
      );
    }
    // When `to` is a bare date like "2026-03-13", treat it as inclusive:
    // bump to next day so that `hour_start < toDate` covers the entire day.
    const toD = new Date(toParam);
    if (toParam.length === 10) {
      toD.setUTCDate(toD.getUTCDate() + 1);
    }
    toDate = toD.toISOString();
  } else {
    toDate = new Date().toISOString();
  }

  // 3. Execute query via RPC
  const db = await getDbRead();

  try {
    const records = await db.getUsageRecords(userId, fromDate, toDate, {
      ...(sourceFilter && { source: sourceFilter }),
      granularity: granularity as "half-hour" | "day",
    });

    // Compute summary
    const summary = records.reduce(
      (acc, r) => ({
        input_tokens: acc.input_tokens + r.input_tokens,
        cached_input_tokens:
          acc.cached_input_tokens + r.cached_input_tokens,
        output_tokens: acc.output_tokens + r.output_tokens,
        reasoning_output_tokens:
          acc.reasoning_output_tokens + r.reasoning_output_tokens,
        total_tokens: acc.total_tokens + r.total_tokens,
      }),
      {
        input_tokens: 0,
        cached_input_tokens: 0,
        output_tokens: 0,
        reasoning_output_tokens: 0,
        total_tokens: 0,
      }
    );

    return NextResponse.json({ records, summary });
  } catch (err) {
    console.error("Failed to query usage:", err);
    return NextResponse.json(
      { error: "Failed to query usage data" },
      { status: 500 }
    );
  }
}
