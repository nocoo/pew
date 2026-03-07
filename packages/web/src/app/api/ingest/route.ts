/**
 * POST /api/ingest — receive usage records from CLI and upsert into D1.
 *
 * Authentication: Auth.js session (from CLI login flow).
 * Body: QueueRecord[] array.
 * Upserts by (user_id, source, model, hour_start) — on conflict, adds tokens.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getD1Client } from "@/lib/d1";
import type { D1BatchStatement } from "@/lib/d1";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_SOURCES = new Set([
  "claude-code",
  "gemini-cli",
  "opencode",
  "openclaw",
]);

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

interface IngestRecord {
  source: string;
  model: string;
  hour_start: string;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
}

function validateRecord(r: unknown, index: number): string | null {
  if (typeof r !== "object" || r === null) {
    return `record[${index}]: must be an object`;
  }

  const rec = r as Record<string, unknown>;

  if (!VALID_SOURCES.has(rec.source as string)) {
    return `record[${index}]: invalid source "${String(rec.source)}"`;
  }
  if (typeof rec.model !== "string" || rec.model.length === 0) {
    return `record[${index}]: model is required`;
  }
  if (
    typeof rec.hour_start !== "string" ||
    !ISO_DATE_RE.test(rec.hour_start)
  ) {
    return `record[${index}]: invalid hour_start format`;
  }

  const tokenFields = [
    "input_tokens",
    "cached_input_tokens",
    "output_tokens",
    "reasoning_output_tokens",
    "total_tokens",
  ] as const;

  for (const field of tokenFields) {
    const val = rec[field];
    if (typeof val !== "number" || val < 0 || !Number.isFinite(val)) {
      return `record[${index}]: ${field} must be a non-negative number`;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  // 1. Authenticate — try session first, fall back to Bearer api_key
  const client = getD1Client();
  let userId: string | undefined;

  const session = await auth();
  if (session?.user?.id) {
    userId = session.user.id;
  } else {
    // Try Bearer api_key
    const authHeader = request.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const apiKey = authHeader.slice(7);
      const row = await client.firstOrNull<{ id: string }>(
        "SELECT id FROM users WHERE api_key = ?",
        [apiKey]
      );
      if (row) {
        userId = row.id;
      }
    }
  }

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse body
  let records: unknown[];
  try {
    const body = await request.json();
    if (!Array.isArray(body)) {
      return NextResponse.json(
        { error: "Request body must be an array" },
        { status: 400 }
      );
    }
    records = body;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  // 3. Validate
  if (records.length === 0) {
    return NextResponse.json(
      { error: "Request body must not be empty" },
      { status: 400 }
    );
  }

  if (records.length > 1000) {
    return NextResponse.json(
      { error: "Batch too large: max 1000 records per request" },
      { status: 400 }
    );
  }

  for (let i = 0; i < records.length; i++) {
    const err = validateRecord(records[i], i);
    if (err) {
      return NextResponse.json({ error: err }, { status: 400 });
    }
  }

  // 4. Upsert into D1
  const statements: D1BatchStatement[] = (records as IngestRecord[]).map(
    (r) => ({
      sql: `INSERT INTO usage_records
            (user_id, source, model, hour_start,
             input_tokens, cached_input_tokens, output_tokens,
             reasoning_output_tokens, total_tokens)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (user_id, source, model, hour_start) DO UPDATE SET
              input_tokens = input_tokens + excluded.input_tokens,
              cached_input_tokens = cached_input_tokens + excluded.cached_input_tokens,
              output_tokens = output_tokens + excluded.output_tokens,
              reasoning_output_tokens = reasoning_output_tokens + excluded.reasoning_output_tokens,
              total_tokens = total_tokens + excluded.total_tokens`,
      params: [
        userId,
        r.source,
        r.model,
        r.hour_start,
        r.input_tokens,
        r.cached_input_tokens,
        r.output_tokens,
        r.reasoning_output_tokens,
        r.total_tokens,
      ],
    })
  );

  try {
    await client.batch(statements);
  } catch (err) {
    console.error("Failed to ingest records:", err);
    return NextResponse.json(
      { error: "Failed to ingest records" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ingested: records.length });
}
