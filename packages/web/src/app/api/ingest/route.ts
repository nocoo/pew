/**
 * POST /api/ingest — receive usage records from CLI and upsert into D1.
 *
 * Authentication: resolveUser (session, Bearer api_key, or E2E bypass).
 * Body: QueueRecord[] array.
 * Upserts by (user_id, source, model, hour_start) — on conflict, overwrites
 * token counts (idempotent: re-sending the same batch produces same result).
 *
 * Performance: builds a single multi-row INSERT ... VALUES (...), (...)
 * so one API batch = one HTTP call to D1 (not N calls).
 */

import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth-helpers";
import { getD1Client } from "@/lib/d1";

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
// SQL builder — multi-row INSERT with overwrite upsert
// ---------------------------------------------------------------------------

/**
 * Build a single multi-row INSERT ... ON CONFLICT DO UPDATE SET statement.
 *
 * Each row has 9 columns; placeholders are (?, ?, ..., ?).
 * On conflict, token counts are **overwritten** (not accumulated) so that
 * re-sending the same batch is idempotent.
 */
export function buildMultiRowUpsert(
  userId: string,
  records: IngestRecord[]
): { sql: string; params: unknown[] } {
  const COLS_PER_ROW = 9;
  const placeholderRow = `(${Array(COLS_PER_ROW).fill("?").join(", ")})`;
  const allPlaceholders = records.map(() => placeholderRow).join(",\n             ");

  const sql = `INSERT INTO usage_records
            (user_id, source, model, hour_start,
             input_tokens, cached_input_tokens, output_tokens,
             reasoning_output_tokens, total_tokens)
            VALUES ${allPlaceholders}
            ON CONFLICT (user_id, source, model, hour_start) DO UPDATE SET
               input_tokens = usage_records.input_tokens + excluded.input_tokens,
               cached_input_tokens = usage_records.cached_input_tokens + excluded.cached_input_tokens,
               output_tokens = usage_records.output_tokens + excluded.output_tokens,
               reasoning_output_tokens = usage_records.reasoning_output_tokens + excluded.reasoning_output_tokens,
               total_tokens = usage_records.total_tokens + excluded.total_tokens`;

  const params: unknown[] = [];
  for (const r of records) {
    params.push(
      userId,
      r.source,
      r.model,
      r.hour_start,
      r.input_tokens,
      r.cached_input_tokens,
      r.output_tokens,
      r.reasoning_output_tokens,
      r.total_tokens
    );
  }

  return { sql, params };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  // 1. Authenticate
  const client = getD1Client();
  const authResult = await resolveUser(request);

  if (!authResult) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = authResult.userId;

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

  if (records.length > 300) {
    return NextResponse.json(
      { error: "Batch too large: max 300 records per request" },
      { status: 400 }
    );
  }

  for (let i = 0; i < records.length; i++) {
    const err = validateRecord(records[i], i);
    if (err) {
      return NextResponse.json({ error: err }, { status: 400 });
    }
  }

  // 4. Upsert into D1 — single multi-row INSERT (one HTTP call)
  const { sql, params } = buildMultiRowUpsert(
    userId,
    records as IngestRecord[]
  );

  try {
    await client.execute(sql, params);
  } catch (err) {
    console.error("Failed to ingest records:", err);
    return NextResponse.json(
      { error: "Failed to ingest records" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ingested: records.length });
}
