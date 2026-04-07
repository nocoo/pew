/**
 * pew Read Worker — Cloudflare Worker with native D1 bindings for reads.
 *
 * Provides a read-only SQL query proxy for the Next.js dashboard,
 * replacing the Cloudflare D1 REST API with a native D1 binding
 * for lower latency and higher reliability.
 *
 * Routes:
 * - GET  /api/live   — health check (no auth, no cache)
 * - POST /api/query  — execute read-only SQL query
 *
 * Auth: shared secret (WORKER_READ_SECRET) between Next.js and this Worker.
 *       /api/live is excluded from auth (public health endpoint).
 *
 * Safety: regex guard rejects write statements (INSERT, UPDATE, DELETE, etc.)
 */

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

export const WORKER_VERSION = "2.2.0";

// ---------------------------------------------------------------------------
// Boot timestamp (for uptime calculation)
// ---------------------------------------------------------------------------

const bootTime = Date.now();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Env {
  DB: D1Database;
  WORKER_READ_SECRET: string;
}

// ---------------------------------------------------------------------------
// Write-statement guard
// ---------------------------------------------------------------------------

const WRITE_RE = /^(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|PRAGMA)\b/i;

// ---------------------------------------------------------------------------
// Route: GET /api/live
// ---------------------------------------------------------------------------

async function handleLive(env: Env): Promise<Response> {
  let dbStatus: { connected: boolean; latencyMs?: number; error?: string };

  try {
    const start = performance.now();
    await env.DB.prepare("SELECT 1").first();
    dbStatus = {
      connected: true,
      latencyMs: Math.round(performance.now() - start),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Strip any accidental "ok" from error messages to prevent
    // keyword-based monitors from false-positive matching
    dbStatus = {
      connected: false,
      error: message.replace(/\bok\b/gi, "***"),
    };
  }

  const isHealthy = dbStatus.connected;

  const body = {
    status: isHealthy ? "ok" : "error",
    version: WORKER_VERSION,
    uptime: Math.round((Date.now() - bootTime) / 1000),
    db: dbStatus,
    timestamp: new Date().toISOString(),
  };

  return Response.json(body, {
    status: isHealthy ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}

// ---------------------------------------------------------------------------
// Route: POST /api/query
// ---------------------------------------------------------------------------

async function handleQuery(body: unknown, env: Env): Promise<Response> {
  if (typeof body !== "object" || body === null) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { sql, params } = body as { sql?: string; params?: unknown[] };

  if (typeof sql !== "string" || sql.trim().length === 0) {
    return Response.json({ error: "Missing or empty sql" }, { status: 400 });
  }

  // Safety: reject write statements
  const normalized = sql.trim();
  if (WRITE_RE.test(normalized)) {
    return Response.json(
      { error: "Write queries not allowed" },
      { status: 403 },
    );
  }

  try {
    const stmt = env.DB.prepare(sql);
    const bound =
      Array.isArray(params) && params.length > 0
        ? stmt.bind(...params)
        : stmt;
    const result = await bound.all();

    return Response.json({
      results: result.results ?? [],
      meta: result.meta ?? { changes: 0, duration: 0 },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: `D1 query failed: ${message}` },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

const worker: ExportedHandler<Env> = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // GET /api/live — no auth
    if (path === "/api/live") {
      if (request.method !== "GET") {
        return Response.json(
          { error: "Method not allowed" },
          { status: 405 },
        );
      }
      return handleLive(env);
    }

    // Auth: all other routes require Bearer token
    const authHeader = request.headers.get("Authorization");
    const expected = `Bearer ${env.WORKER_READ_SECRET}`;
    if (!authHeader || authHeader !== expected) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // POST /api/query
    if (path === "/api/query") {
      if (request.method !== "POST") {
        return Response.json(
          { error: "Method not allowed" },
          { status: 405 },
        );
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return Response.json(
          { error: "Invalid JSON body" },
          { status: 400 },
        );
      }

      return handleQuery(body, env);
    }

    // Unknown route
    return Response.json({ error: "Not found" }, { status: 404 });
  },
};

export default worker;
