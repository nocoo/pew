import { validateEvidenceRecord } from "@pew/core";
import { createIngestHandler } from "@/lib/ingest-handler";

export const POST = createIngestHandler({
  validateRecord: validateEvidenceRecord,
  getWorkerUrl: () => `${(process.env.WORKER_INGEST_URL ?? "").replace(/\/ingest(?:\/tokens)?\/?$/, "")}/ingest/evidence`,
  entityName: "usage evidence",
});
