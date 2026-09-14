import { accountingAcknowledgment, validateAccountingRecord } from "@pew/core";
import { createIngestHandler } from "@/lib/ingest-handler";

export const POST = createIngestHandler({
  validateRecord: validateAccountingRecord,
  getWorkerUrl: () => `${(process.env.WORKER_INGEST_URL ?? "").replace(/\/ingest(?:\/tokens)?\/?$/, "")}/ingest/details`,
  entityName: "accounting details",
  acknowledgment: accountingAcknowledgment,
});
