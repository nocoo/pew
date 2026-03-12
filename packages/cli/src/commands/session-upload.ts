/**
 * CLI session upload command — sends local session queue records to the pew SaaS.
 *
 * Thin wrapper around the generic upload engine with session-specific
 * preprocessing (deduplication: keep only latest snapshot per session_key).
 */

import { SessionQueue } from "../storage/session-queue.js";
import { createUploadEngine } from "./upload-engine.js";
import type {
  UploadResult,
  UploadProgressEvent,
  UploadExecuteOptions,
} from "./upload-engine.js";
import type { SessionQueueRecord } from "@pew/core";

// ---------------------------------------------------------------------------
// Types (re-exported for backward compatibility)
// ---------------------------------------------------------------------------

export interface SessionUploadOptions {
  /** Directory for config file and queue state */
  stateDir: string;
  /** Base URL of the pew SaaS */
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
  onProgress?: (event: SessionUploadProgressEvent) => void;
}

export type SessionUploadProgressEvent = UploadProgressEvent;
export type SessionUploadResult = UploadResult;

// ---------------------------------------------------------------------------
// Pre-dedup — keep only the latest snapshot per session_key
// ---------------------------------------------------------------------------

/**
 * Unlike token's aggregateRecords() which SUMS, session dedup
 * keeps only the LATEST snapshot per session_key.
 *
 * This ensures idempotent uploads: re-scanning the same session
 * files produces the same final result after server-side monotonic
 * upsert (WHERE excluded.snapshot_at >= session_records.snapshot_at).
 */
export function deduplicateSessionRecords(
  records: SessionQueueRecord[],
): SessionQueueRecord[] {
  if (records.length === 0) return [];

  const map = new Map<string, SessionQueueRecord>();
  for (const r of records) {
    const existing = map.get(r.session_key);
    if (!existing || r.snapshot_at > existing.snapshot_at) {
      map.set(r.session_key, r);
    }
  }
  return [...map.values()];
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export async function executeSessionUpload(
  opts: SessionUploadOptions,
): Promise<SessionUploadResult> {
  const queue = new SessionQueue(opts.stateDir);

  const engine = createUploadEngine<SessionQueueRecord>({
    queue,
    endpoint: "/api/ingest/sessions",
    entityName: "session records",
    preprocess: deduplicateSessionRecords,
  });

  return engine.execute(opts);
}
