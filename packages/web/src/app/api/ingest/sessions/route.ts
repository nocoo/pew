/**
 * POST /api/ingest/sessions — receive session records from CLI and forward to Worker.
 *
 * Authentication: resolveUser (session, Bearer api_key, or E2E bypass).
 * Body: SessionIngestRecord[] array.
 *
 * Validation and handler logic delegated to createIngestHandler factory.
 */

import { validateSessionIngestRecord } from "@pew/core";
import { createIngestHandler } from "@/lib/ingest-handler";

/**
 * Derive session ingest URL from token ingest URL.
 * WORKER_INGEST_URL = "https://...workers.dev/ingest"
 * → Session URL = "https://...workers.dev/ingest/sessions"
 */
function getSessionWorkerUrl(): string {
  const base = process.env.WORKER_INGEST_URL ?? "";
  if (base.endsWith("/ingest")) {
    return `${base}/sessions`;
  }
  // Fallback: append /ingest/sessions to base
  return `${base}/ingest/sessions`;
}

export const POST = createIngestHandler({
  validateRecord: validateSessionIngestRecord,
  getWorkerUrl: getSessionWorkerUrl,
  entityName: "session records",
});
