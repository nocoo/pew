/**
 * POST /api/ingest/sessions — receive session records from CLI and forward to Worker.
 *
 * Authentication: resolveUser (session, Bearer api_key, or E2E bypass).
 * Body: SessionIngestRecord[] array.
 *
 * After validation, delegates the D1 write to the Cloudflare Worker
 * (pew-ingest) which uses native D1 bindings for atomic batch upserts
 * with monotonic snapshot_at guard.
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

const VALID_KINDS = new Set(["human", "automated"]);

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

interface SessionIngestRecord {
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
  model: string | null;
  snapshot_at: string;
}

function validateSessionRecord(r: unknown, index: number): string | null {
  if (typeof r !== "object" || r === null) {
    return `record[${index}]: must be an object`;
  }

  const rec = r as Record<string, unknown>;

  // Required string fields
  if (typeof rec.session_key !== "string" || rec.session_key.length === 0) {
    return `record[${index}]: session_key is required`;
  }
  if (!VALID_SOURCES.has(rec.source as string)) {
    return `record[${index}]: invalid source "${String(rec.source)}"`;
  }
  if (!VALID_KINDS.has(rec.kind as string)) {
    return `record[${index}]: invalid kind "${String(rec.kind)}"`;
  }
  if (typeof rec.started_at !== "string" || !ISO_DATE_RE.test(rec.started_at)) {
    return `record[${index}]: invalid started_at format`;
  }
  if (
    typeof rec.last_message_at !== "string" ||
    !ISO_DATE_RE.test(rec.last_message_at)
  ) {
    return `record[${index}]: invalid last_message_at format`;
  }
  if (typeof rec.snapshot_at !== "string" || !ISO_DATE_RE.test(rec.snapshot_at)) {
    return `record[${index}]: invalid snapshot_at format`;
  }

  // Required non-negative number fields
  const numFields = [
    "duration_seconds",
    "user_messages",
    "assistant_messages",
    "total_messages",
  ] as const;

  for (const field of numFields) {
    const val = rec[field];
    if (typeof val !== "number" || val < 0 || !Number.isFinite(val)) {
      return `record[${index}]: ${field} must be a non-negative number`;
    }
  }

  // Nullable string fields
  if (rec.project_ref !== null && typeof rec.project_ref !== "string") {
    return `record[${index}]: project_ref must be a string or null`;
  }
  if (rec.model !== null && typeof rec.model !== "string") {
    return `record[${index}]: model must be a string or null`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Worker proxy
// ---------------------------------------------------------------------------

const WORKER_INGEST_URL = process.env.WORKER_INGEST_URL ?? "";

/** Derive session ingest URL from token ingest URL.
 *  WORKER_INGEST_URL = "https://...workers.dev/ingest"
 *  → Session URL = "https://...workers.dev/ingest/sessions"
 */
function getSessionWorkerUrl(): string {
  if (WORKER_INGEST_URL.endsWith("/ingest")) {
    return `${WORKER_INGEST_URL}/sessions`;
  }
  // Fallback: append /ingest/sessions to base
  return `${WORKER_INGEST_URL}/ingest/sessions`;
}

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
        { status: 400 },
      );
    }
    records = body;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  // 3. Validate
  if (records.length === 0) {
    return NextResponse.json(
      { error: "Request body must not be empty" },
      { status: 400 },
    );
  }

  if (records.length > 50) {
    return NextResponse.json(
      { error: "Batch too large: max 50 records per request" },
      { status: 400 },
    );
  }

  for (let i = 0; i < records.length; i++) {
    const err = validateSessionRecord(records[i], i);
    if (err) {
      return NextResponse.json({ error: err }, { status: 400 });
    }
  }

  // 4. Forward to Worker for atomic batch upsert
  const validRecords = records as SessionIngestRecord[];

  try {
    const res = await fetch(getSessionWorkerUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${WORKER_SECRET}`,
      },
      body: JSON.stringify({ userId, records: validRecords }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      const msg = body?.error ?? `Worker returned ${res.status}`;
      console.error("Worker session ingest failed:", msg);
      return NextResponse.json(
        { error: "Failed to ingest session records" },
        { status: 500 },
      );
    }
  } catch (err) {
    console.error("Failed to ingest session records:", err);
    return NextResponse.json(
      { error: "Failed to ingest session records" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ingested: records.length });
}
