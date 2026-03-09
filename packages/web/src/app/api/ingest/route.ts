/**
 * POST /api/ingest — receive usage records from CLI and forward to Worker.
 *
 * Authentication: resolveUser (session, Bearer api_key, or E2E bypass).
 * Body: IngestRecord[] array.
 *
 * After validation, delegates the D1 write to the Cloudflare Worker
 * (pew-ingest) which uses native D1 bindings for atomic batch upserts.
 */

import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth-helpers";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_SOURCES = new Set([
  "claude-code",
  "codex",
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
// Worker proxy
// ---------------------------------------------------------------------------

const WORKER_INGEST_URL = process.env.WORKER_INGEST_URL ?? "";
const WORKER_SECRET = process.env.WORKER_SECRET ?? "";

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  // 1. Authenticate
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

  if (records.length > 50) {
    return NextResponse.json(
      { error: "Batch too large: max 50 records per request" },
      { status: 400 }
    );
  }

  for (let i = 0; i < records.length; i++) {
    const err = validateRecord(records[i], i);
    if (err) {
      return NextResponse.json({ error: err }, { status: 400 });
    }
  }

  // 4. Forward to Worker for atomic batch upsert
  const validRecords = records as IngestRecord[];

  try {
    const res = await fetch(WORKER_INGEST_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${WORKER_SECRET}`,
      },
      body: JSON.stringify({ userId, records: validRecords }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      const msg = body?.error ?? `Worker returned ${res.status}`;
      console.error("Worker ingest failed:", msg);
      return NextResponse.json(
        { error: "Failed to ingest records" },
        { status: 500 }
      );
    }
  } catch (err) {
    console.error("Failed to ingest records:", err);
    return NextResponse.json(
      { error: "Failed to ingest records" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ingested: records.length });
}
