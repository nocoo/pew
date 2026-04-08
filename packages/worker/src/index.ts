/**
 * pew Ingest Worker — Cloudflare Worker with native D1 bindings.
 *
 * Receives pre-validated records from Next.js and performs
 * atomic batch upserts via env.DB.batch().
 *
 * Routes:
 * - GET  /api/live          — health check (no auth, no cache)
 * - POST /ingest/tokens    — token usage records (also legacy /ingest)
 * - POST /ingest/sessions  — session snapshot records
 *
 * Auth: shared secret (WORKER_SECRET) between Next.js and this Worker.
 *       /api/live is excluded from auth (public health endpoint).
 * Limit: max 50 records per request (D1 Free plan: 50 queries/invocation).
 *
 * Validation: defense-in-depth using shared validators from @pew/core.
 * The Next.js API routes validate first; the Worker re-validates as a
 * second line of defense.
 */

import {
  MAX_INGEST_BATCH_SIZE,
  validateIngestRecord,
  validateSessionIngestRecord,
} from "@pew/core";
import type {
  IngestRecord,
  IngestRequest,
  SessionIngestRecord,
  SessionIngestRequest,
  ValidationResult,
} from "@pew/core";

// Re-export types for test imports
export type { IngestRecord, IngestRequest, SessionIngestRecord, SessionIngestRequest };

// ---------------------------------------------------------------------------
// Version (kept in sync with package.json during version bumps)
// ---------------------------------------------------------------------------

export const WORKER_VERSION = "2.9.0";

// ---------------------------------------------------------------------------
// Boot timestamp (for uptime calculation)
// ---------------------------------------------------------------------------

const bootTime = Date.now();

// ---------------------------------------------------------------------------
// Worker-specific types
// ---------------------------------------------------------------------------

export interface Env {
  DB: D1Database;
  WORKER_SECRET: string;
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

const TOKEN_UPSERT_SQL = `INSERT INTO usage_records
  (user_id, device_id, source, model, hour_start,
   input_tokens, cached_input_tokens, output_tokens,
   reasoning_output_tokens, total_tokens)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (user_id, device_id, source, model, hour_start) DO UPDATE SET
   input_tokens = excluded.input_tokens,
   cached_input_tokens = excluded.cached_input_tokens,
   output_tokens = excluded.output_tokens,
   reasoning_output_tokens = excluded.reasoning_output_tokens,
   total_tokens = excluded.total_tokens`;

const SESSION_UPSERT_SQL = `INSERT INTO session_records
  (user_id, session_key, source, kind, started_at, last_message_at,
   duration_seconds, user_messages, assistant_messages, total_messages,
   project_ref, model, snapshot_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
ON CONFLICT (user_id, session_key) DO UPDATE SET
  source = excluded.source,
  kind = excluded.kind,
  started_at = excluded.started_at,
  last_message_at = excluded.last_message_at,
  duration_seconds = excluded.duration_seconds,
  user_messages = excluded.user_messages,
  assistant_messages = excluded.assistant_messages,
  total_messages = excluded.total_messages,
  project_ref = excluded.project_ref,
  model = excluded.model,
  snapshot_at = excluded.snapshot_at,
  updated_at = datetime('now')
WHERE excluded.snapshot_at >= session_records.snapshot_at`;

// ---------------------------------------------------------------------------
// Request envelope validation (userId + records array)
// ---------------------------------------------------------------------------

type EnvelopeResult<T> =
  | { ok: true; userId: string; records: T[] }
  | { ok: false; error: string };

/**
 * Validate the request envelope and each record using a shared validator.
 * Returns typed userId + validated records, or an error string.
 */
function validateRequest<T>(
  body: unknown,
  validateRecord: (r: unknown, index: number) => ValidationResult<T>,
): EnvelopeResult<T> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }

  const obj = body as Record<string, unknown>;

  if (typeof obj.userId !== "string" || obj.userId.length === 0) {
    return { ok: false, error: "Missing or empty userId" };
  }

  if (!Array.isArray(obj.records) || obj.records.length === 0) {
    return { ok: false, error: "Missing or empty records array" };
  }

  if (obj.records.length > MAX_INGEST_BATCH_SIZE) {
    return { ok: false, error: `Batch too large: max ${MAX_INGEST_BATCH_SIZE} records` };
  }

  const validated: T[] = [];
  for (let i = 0; i < obj.records.length; i++) {
    const result = validateRecord(obj.records[i], i);
    if (!result.valid) {
      return { ok: false, error: result.error };
    }
    validated.push(result.record);
  }

  return { ok: true, userId: obj.userId as string, records: validated };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * GET /api/live — lightweight health check.
 * No auth required. Returns DB connectivity status + version + uptime.
 * Error responses MUST NOT contain the word "ok" to prevent monitor false-positives.
 */
async function handleLive(env: Env): Promise<Response> {
  const start = performance.now();
  let dbConnected = true;
  let dbLatencyMs: number | undefined;
  let dbError: string | undefined;

  try {
    await env.DB.prepare("SELECT 1").first();
    dbLatencyMs = Math.round(performance.now() - start);
  } catch (err) {
    dbConnected = false;
    const message = err instanceof Error ? err.message : String(err);
    // Strip any accidental "ok" from error messages
    dbError = message.replace(/\bok\b/gi, "***");
  }

  const body = {
    status: dbConnected ? "ok" : "error",
    version: WORKER_VERSION,
    uptime: Math.round((Date.now() - bootTime) / 1000),
    db: dbConnected
      ? { connected: true, latencyMs: dbLatencyMs }
      : { connected: false, error: dbError },
    timestamp: new Date().toISOString(),
  };

  return new Response(JSON.stringify(body), {
    status: dbConnected ? 200 : 503,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

async function handleTokenIngest(body: unknown, env: Env): Promise<Response> {
  const validation = validateRequest<IngestRecord>(body, validateIngestRecord);
  if (!validation.ok) {
    return Response.json({ error: validation.error }, { status: 400 });
  }

  const { userId, records } = validation;

  try {
    const stmts = records.map((r) =>
      env.DB.prepare(TOKEN_UPSERT_SQL).bind(
        userId,
        r.device_id ?? "default",
        r.source,
        r.model,
        r.hour_start,
        r.input_tokens,
        r.cached_input_tokens,
        r.output_tokens,
        r.reasoning_output_tokens,
        r.total_tokens,
      ),
    );

    await env.DB.batch(stmts);

    return Response.json({ ingested: records.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `D1 batch failed: ${message}` }, { status: 500 });
  }
}

async function handleSessionIngest(body: unknown, env: Env): Promise<Response> {
  const validation = validateRequest<SessionIngestRecord>(body, validateSessionIngestRecord);
  if (!validation.ok) {
    return Response.json({ error: validation.error }, { status: 400 });
  }

  const { userId, records } = validation;

  try {
    const stmts = records.map((r) =>
      env.DB.prepare(SESSION_UPSERT_SQL).bind(
        userId,
        r.session_key,
        r.source,
        r.kind,
        r.started_at,
        r.last_message_at,
        r.duration_seconds,
        r.user_messages,
        r.assistant_messages,
        r.total_messages,
        r.project_ref,
        r.model,
        r.snapshot_at,
      ),
    );

    await env.DB.batch(stmts);

    return Response.json({ ingested: records.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `D1 batch failed: ${message}` }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // 1. Health check — no auth, GET only
    if (path === "/api/live") {
      if (request.method !== "GET") {
        return Response.json({ error: "Method not allowed" }, { status: 405 });
      }
      return handleLive(env);
    }

    // 2. Method check (all other routes are POST-only)
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    // 3. Shared secret auth
    const auth = request.headers.get("Authorization");
    if (auth !== `Bearer ${env.WORKER_SECRET}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 4. Parse JSON body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    // 5. Route by URL path
    if (path === "/ingest/sessions") {
      return handleSessionIngest(body, env);
    }

    if (path === "/ingest/tokens" || path === "/ingest") {
      return handleTokenIngest(body, env);
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
