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

export async function GET() {
  const start = performance.now();
  let dbStatus: DbStatus;

  try {
    const db = await getDbRead();
    await db.ping();
    dbStatus = {
      connected: true,
      latencyMs: Math.round(performance.now() - start),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Strip any accidental "ok" from error messages
    const sanitized = message.replace(/\bok\b/gi, "***");
    dbStatus = {
      connected: false,
      error: sanitized,
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
