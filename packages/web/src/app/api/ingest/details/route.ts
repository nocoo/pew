import { accountingAcknowledgment, validateAccountingRecord, MAX_ACCOUNTING_BODY_BYTES, MAX_ACCOUNTING_BATCH_SIZE } from "@pew/core";
import { createIngestHandler } from "@/lib/ingest-handler";

export const POST = createIngestHandler({
  validateRecord: validateAccountingRecord,
  getWorkerUrl: () => `${(process.env.WORKER_INGEST_URL ?? "").replace(/\/ingest(?:\/tokens)?\/?$/, "")}/ingest/details`,
  entityName: "accounting details",
  maxBodyBytes: MAX_ACCOUNTING_BODY_BYTES,
  maxBatchSize: MAX_ACCOUNTING_BATCH_SIZE,
  acknowledgment: accountingAcknowledgment,
});
