/**
 * CLI upload command — sends local token queue records to the Pew SaaS.
 *
 * Thin wrapper around the generic upload engine with token-specific
 * preprocessing (aggregation by source/model/hour_start).
 */

import { LocalQueue } from "../storage/local-queue.js";
import { createUploadEngine } from "./upload-engine.js";
import type {
  UploadResult,
  UploadProgressEvent,
  UploadExecuteOptions,
} from "./upload-engine.js";
import type { QueueRecord } from "@pew/core";

// ---------------------------------------------------------------------------
// Types (re-exported for backward compatibility)
// ---------------------------------------------------------------------------

export interface UploadOptions {
  /** Directory for config file and queue state */
  stateDir: string;
  /** Base URL of the Pew SaaS */
  apiUrl: string;
  /** Whether dev mode is active (uses config.dev.json) */
  dev?: boolean;
  /** Injected fetch (for testing) */
  fetch: typeof globalThis.fetch;
  /** Max records per API request (default: 50) */
  batchSize?: number;
  /** Max retries per batch on 5xx (default: 2) */
  maxRetries?: number;
  /** Base retry delay in ms (default: 1000, doubled each retry) */
  retryDelayMs?: number;
  /** Progress callback */
  onProgress?: (event: UploadProgressEvent) => void;
}

export type { UploadResult, UploadProgressEvent };

// ---------------------------------------------------------------------------
// Pre-aggregation — merge QueueRecords with the same (source, model, hour_start)
// ---------------------------------------------------------------------------

/**
 * Aggregate QueueRecords by (source, model, hour_start), summing token fields.
 *
 * This ensures that when combined with server-side overwrite upsert, the
 * pipeline is fully idempotent: re-scanning and re-uploading produces the
 * same final result in D1.
 */
export function aggregateRecords(records: QueueRecord[]): QueueRecord[] {
  if (records.length === 0) return [];

  const map = new Map<string, QueueRecord>();

  for (const r of records) {
    const key = `${r.source}|${r.model}|${r.hour_start}`;
    const existing = map.get(key);
    if (existing) {
      existing.input_tokens += r.input_tokens;
      existing.cached_input_tokens += r.cached_input_tokens;
      existing.output_tokens += r.output_tokens;
      existing.reasoning_output_tokens += r.reasoning_output_tokens;
      existing.total_tokens += r.total_tokens;
    } else {
      map.set(key, { ...r });
    }
  }

  return [...map.values()];
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export async function executeUpload(opts: UploadOptions): Promise<UploadResult> {
  const queue = new LocalQueue(opts.stateDir);

  const engine = createUploadEngine<QueueRecord>({
    queue,
    endpoint: "/api/ingest",
    entityName: "records",
    preprocess: aggregateRecords,
  });

  return engine.execute(opts);
}
