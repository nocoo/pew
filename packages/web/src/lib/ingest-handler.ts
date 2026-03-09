/**
 * Generic factory for ingest route handlers.
 *
 * Eliminates boilerplate duplication between the token and session
 * ingest routes. Each route becomes a thin wrapper that supplies:
 *   - a per-record validator (from @pew/core)
 *   - the Worker URL resolver
 *   - a human-readable entity name for error messages
 *
 * Env vars (WORKER_INGEST_URL, WORKER_SECRET) are read lazily inside
 * the handler for testability — no module-scope process.env reads.
 */

import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth-helpers";
import { MAX_INGEST_BATCH_SIZE } from "@pew/core";
import type { ValidationResult } from "@pew/core";

// ---------------------------------------------------------------------------
// Factory config
// ---------------------------------------------------------------------------

export interface IngestHandlerConfig<T> {
  /**
   * Per-record validator returning a discriminated union.
   * Imported from @pew/core (validateIngestRecord / validateSessionIngestRecord).
   */
  validateRecord: (r: unknown, index: number) => ValidationResult<T>;

  /**
   * Resolve the Worker URL at call time (reads env lazily).
   * Token route: () => process.env.WORKER_INGEST_URL
   * Session route: () => `${process.env.WORKER_INGEST_URL}/sessions`
   */
  getWorkerUrl: () => string;

  /** Human-readable entity name used in error messages, e.g. "records" or "session records" */
  entityName: string;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a POST handler for an ingest route.
 *
 * The returned function has the signature Next.js expects for route handlers:
 *   `(request: Request) => Promise<Response>`
 */
export function createIngestHandler<T>(
  config: IngestHandlerConfig<T>,
): (request: Request) => Promise<Response> {
  const { validateRecord, getWorkerUrl, entityName } = config;

  return async function POST(request: Request): Promise<Response> {
    // 1. Authenticate
    const authResult = await resolveUser(request);
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { userId } = authResult;

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

    // 3. Validate batch constraints
    if (records.length === 0) {
      return NextResponse.json(
        { error: "Request body must not be empty" },
        { status: 400 },
      );
    }

    if (records.length > MAX_INGEST_BATCH_SIZE) {
      return NextResponse.json(
        {
          error: `Batch too large: max ${MAX_INGEST_BATCH_SIZE} records per request`,
        },
        { status: 400 },
      );
    }

    // 4. Validate individual records
    const validated: T[] = [];
    for (let i = 0; i < records.length; i++) {
      const result = validateRecord(records[i], i);
      if (!result.valid) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      validated.push(result.record);
    }

    // 5. Forward to Worker for atomic batch upsert
    const workerUrl = getWorkerUrl();
    const workerSecret = process.env.WORKER_SECRET ?? "";

    try {
      const res = await fetch(workerUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${workerSecret}`,
        },
        body: JSON.stringify({ userId, records: validated }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as Record<
          string,
          unknown
        > | null;
        const msg = body?.error ?? `Worker returned ${res.status}`;
        console.error(`Worker ${entityName} ingest failed:`, msg);
        return NextResponse.json(
          { error: `Failed to ingest ${entityName}` },
          { status: 500 },
        );
      }
    } catch (err) {
      console.error(`Failed to ingest ${entityName}:`, err);
      return NextResponse.json(
        { error: `Failed to ingest ${entityName}` },
        { status: 500 },
      );
    }

    return NextResponse.json({ ingested: records.length });
  };
}
