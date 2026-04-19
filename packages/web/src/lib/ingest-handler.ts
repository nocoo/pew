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
import { MAX_INGEST_BATCH_SIZE, MIN_CLIENT_VERSION } from "@pew/core";
import type { ValidationResult } from "@pew/core";
import {
  INGEST_RATE_LIMIT,
  getClientIp,
  inMemoryRateLimiter,
} from "@/lib/rate-limit";

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

    // 2. Rate limit: 300 per minute per user
    // (falls back to client IP if userId is somehow empty)
    const rateKey = userId || `ip:${getClientIp(request)}`;
    const rl = inMemoryRateLimiter.check(
      `ingest:${rateKey}`,
      INGEST_RATE_LIMIT,
    );
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
      );
    }

    // 3. Version gate — reject old clients with token inflation bugs
    const clientVersion = request.headers.get("X-Pew-Client-Version");
    if (!clientVersion || compareSemver(clientVersion, MIN_CLIENT_VERSION) < 0) {
      return NextResponse.json(
        {
          error:
            "Client version too old. Run: npx @nocoo/pew@latest && pew reset",
        },
        { status: 400 },
      );
    }

    // 4. Parse body
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

    // 5. Validate batch constraints
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

    // 6. Validate individual records
    const validated: T[] = [];
    for (let i = 0; i < records.length; i++) {
      const result = validateRecord(records[i], i);
      if (!result.valid) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      validated.push(result.record);
    }

    // 7. Forward to Worker for atomic batch upsert
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

// ---------------------------------------------------------------------------
// Semver comparison (minimal — handles "major.minor.patch" only)
// ---------------------------------------------------------------------------

/**
 * Compare two semver strings. Returns:
 *   -1 if a < b
 *    0 if a === b
 *    1 if a > b
 *
 * Non-numeric or missing segments are treated as 0.
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}
