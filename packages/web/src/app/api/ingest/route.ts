/**
 * POST /api/ingest — receive token usage records from CLI and forward to Worker.
 *
 * Authentication: resolveUser (session, Bearer api_key, or E2E bypass).
 * Body: IngestRecord[] array.
 *
 * Validation and handler logic delegated to createIngestHandler factory.
 */

import { validateIngestRecord } from "@pew/core";
import { createIngestHandler } from "@/lib/ingest-handler";

export const POST = createIngestHandler({
  validateRecord: validateIngestRecord,
  getWorkerUrl: () => process.env.WORKER_INGEST_URL ?? "",
  entityName: "records",
});
