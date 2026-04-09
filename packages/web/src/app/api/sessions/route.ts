/**
 * GET /api/sessions — query session statistics for the authenticated user.
 *
 * Query params:
 *   from   — ISO date string (default: 30 days ago)
 *   to     — ISO date string (default: now)
 *   source — filter by source (optional)
 *   kind   — filter by kind: "human" | "automated" (optional)
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
  "vscode-copilot",
]);

const VALID_KINDS = new Set(["human", "automated"]);

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
  const kindFilter = url.searchParams.get("kind");
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  // Validate source filter
  if (sourceFilter && !VALID_SOURCES.has(sourceFilter)) {
    return NextResponse.json(
      { error: `Invalid source: "${sourceFilter}"` },
      { status: 400 },
    );
  }

  // Validate kind filter
  if (kindFilter && !VALID_KINDS.has(kindFilter)) {
    return NextResponse.json(
      { error: `Invalid kind: "${kindFilter}"` },
      { status: 400 },
    );
  }

  // Validate and compute date range
  let fromDate: string;
  let toDate: string;

  if (fromParam) {
    if (!DATE_RE.test(fromParam)) {
      return NextResponse.json(
        { error: "Invalid from date format" },
        { status: 400 },
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
        { status: 400 },
      );
    }
    // Bare date "YYYY-MM-DD" → inclusive: bump +1 UTC day for `< toDate`
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
    const records = await db.getSessionRecords(userId, fromDate, toDate, {
      ...(sourceFilter && { source: sourceFilter }),
      ...(kindFilter && { kind: kindFilter }),
    });

    // Compute summary
    const summary = records.reduce(
      (acc, r) => ({
        total_sessions: acc.total_sessions + 1,
        total_duration_seconds: acc.total_duration_seconds + r.duration_seconds,
        total_user_messages: acc.total_user_messages + r.user_messages,
        total_assistant_messages:
          acc.total_assistant_messages + r.assistant_messages,
        total_messages: acc.total_messages + r.total_messages,
      }),
      {
        total_sessions: 0,
        total_duration_seconds: 0,
        total_user_messages: 0,
        total_assistant_messages: 0,
        total_messages: 0,
      },
    );

    return NextResponse.json({ records, summary });
  } catch (err) {
    console.error("Failed to query sessions:", err);
    return NextResponse.json(
      { error: "Failed to query session data" },
      { status: 500 },
    );
  }
}
