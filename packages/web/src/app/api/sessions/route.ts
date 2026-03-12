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
import { getD1Client } from "@/lib/d1";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_SOURCES = new Set([
  "claude-code",
  "codex",
  "gemini-cli",
  "opencode",
  "openclaw",
  "vscode-copilot",
]);

const VALID_KINDS = new Set(["human", "automated"]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SessionRow {
  session_key: string;
  source: string;
  kind: string;
  started_at: string;
  last_message_at: string;
  duration_seconds: number;
  user_messages: number;
  assistant_messages: number;
  total_messages: number;
  project_ref: string | null;
  project_name: string | null;
  model: string | null;
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
  const sourceFilter = url.searchParams.get("source");
  const kindFilter = url.searchParams.get("kind");
  const projectFilter = url.searchParams.get("project");
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
    toDate = new Date(toParam).toISOString();
  } else {
    toDate = new Date().toISOString();
  }

  // 3. Build query
  const conditions = ["sr.user_id = ?", "sr.started_at >= ?", "sr.started_at < ?"];
  const params: unknown[] = [userId, fromDate, toDate];

  if (sourceFilter) {
    conditions.push("sr.source = ?");
    params.push(sourceFilter);
  }

  if (kindFilter) {
    conditions.push("sr.kind = ?");
    params.push(kindFilter);
  }

  // Project filter: name match or "_unassigned" for null project
  if (projectFilter) {
    if (projectFilter === "_unassigned") {
      conditions.push("p.name IS NULL");
    } else {
      conditions.push("p.name = ?");
      params.push(projectFilter);
    }
  }

  const sql = `
    SELECT
      sr.session_key,
      sr.source,
      sr.kind,
      sr.started_at,
      sr.last_message_at,
      sr.duration_seconds,
      sr.user_messages,
      sr.assistant_messages,
      sr.total_messages,
      sr.project_ref,
      p.name AS project_name,
      sr.model
    FROM session_records sr
    LEFT JOIN project_aliases pa
      ON pa.user_id = sr.user_id
      AND pa.source = sr.source
      AND pa.project_ref = sr.project_ref
    LEFT JOIN projects p ON p.id = pa.project_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY sr.started_at DESC
  `;

  // 4. Execute
  const client = getD1Client();

  try {
    const result = await client.query<SessionRow>(sql, params);
    const records = result.results;

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
