/**
 * GET /api/live -- health check endpoint for uptime monitors.
 *
 * No authentication required. No caching.
 * Verifies core dependency connectivity (D1 database).
 *
 * Returns:
 *   - status: "ok" | "error"
 *   - version: app version string
 *   - uptime: process uptime in seconds
 *   - db: { connected: boolean, latencyMs?: number, error?: string }
 *   - timestamp: ISO 8601 UTC
 *
 * Error responses MUST NOT contain the word "ok" anywhere
 * to prevent keyword-based monitors from false-positive matching.
 */

import { getDbRead } from "@/lib/db";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

interface DbStatus {
  connected: boolean;
  latencyMs?: number;
  error?: string;
}

/** Timeout in ms for the DB health-check ping. */
const DB_PING_TIMEOUT_MS = 3_000;

export async function GET() {
  const start = performance.now();
  let dbStatus: DbStatus;

  try {
    const db = await getDbRead();
    // Race the ping against a timeout to prevent hanging health checks.
    await Promise.race([
      db.ping(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB ping timed out")), DB_PING_TIMEOUT_MS),
      ),
    ]);
    dbStatus = {
      connected: true,
      latencyMs: Math.round(performance.now() - start),
    };
  } catch {
    // Redact internal error details — callers only need to know the DB is down.
    dbStatus = {
      connected: false,
      error: "Service unavailable",
    };
  }

  const isHealthy = dbStatus.connected;

  const body = {
    status: isHealthy ? "ok" : "error",
    version: APP_VERSION,
    uptime: Math.round(process.uptime()),
    db: dbStatus,
    timestamp: new Date().toISOString(),
  };

  return new Response(JSON.stringify(body), {
    status: isHealthy ? 200 : 503,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
