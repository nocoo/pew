/**
 * Session upload command — sends local session queue records to the Pew SaaS.
 *
 * Flow:
 * 1. Load API key from config
 * 2. Read un-uploaded session records from queue (using saved offset)
 * 3. Deduplicate: keep only latest snapshot per session_key
 * 4. Split into batches of ≤50 (D1 Free plan limit)
 * 5. POST each batch to /api/ingest/sessions with Bearer token
 * 6. Persist offset after all batches succeed
 * 7. Retry on 5xx/429 with exponential backoff
 */

import type { SessionQueueRecord } from "@pew/core";
import { ConfigManager } from "../config/manager.js";
import { SessionQueue } from "../storage/session-queue.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionUploadOptions {
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
  onProgress?: (event: SessionUploadProgressEvent) => void;
}

export interface SessionUploadProgressEvent {
  phase: "uploading" | "done";
  batch?: number;
  totalBatches?: number;
  total?: number;
  message?: string;
}

export interface SessionUploadResult {
  success: boolean;
  uploaded: number;
  batches: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 1000;

// ---------------------------------------------------------------------------
// Upload dedup
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
  const {
    stateDir,
    apiUrl,
    dev = false,
    fetch: fetchFn,
    batchSize = DEFAULT_BATCH_SIZE,
    maxRetries = DEFAULT_MAX_RETRIES,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    onProgress,
  } = opts;

  // 1. Load API key
  const configManager = new ConfigManager(stateDir, dev);
  const config = await configManager.load();

  if (!config.token) {
    return {
      success: false,
      uploaded: 0,
      batches: 0,
      error: "Not logged in. Run `pew login` first.",
    };
  }

  // 2. Read un-uploaded records
  const queue = new SessionQueue(stateDir);
  const currentOffset = await queue.loadOffset();
  const { records: rawRecords, newOffset } =
    await queue.readFromOffset(currentOffset);

  if (rawRecords.length === 0) {
    return { success: true, uploaded: 0, batches: 0 };
  }

  // 2b. Pre-deduplicate: keep only latest snapshot per session_key
  const records = deduplicateSessionRecords(rawRecords);

  // 3. Split into batches
  const batches: SessionQueueRecord[][] = [];
  for (let i = 0; i < records.length; i += batchSize) {
    batches.push(records.slice(i, i + batchSize));
  }

  // 4. Upload each batch
  const endpoint = `${apiUrl}/api/ingest/sessions`;
  let totalUploaded = 0;
  let batchesCompleted = 0;

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];

    onProgress?.({
      phase: "uploading",
      batch: batchIdx + 1,
      totalBatches: batches.length,
      total: records.length,
      message: `Uploading session batch ${batchIdx + 1}/${batches.length} (${batch.length} records)...`,
    });

    const result = await sendBatchWithRetry({
      endpoint,
      token: config.token,
      batch,
      fetchFn,
      maxRetries,
      retryDelayMs,
    });

    if (!result.ok) {
      return {
        success: false,
        uploaded: totalUploaded,
        batches: batchesCompleted,
        error: result.error,
      };
    }

    totalUploaded += batch.length;
    batchesCompleted++;
  }

  // 5. All batches succeeded — save final offset
  await queue.saveOffset(newOffset);

  onProgress?.({
    phase: "done",
    total: totalUploaded,
    message: `Uploaded ${totalUploaded} session records in ${batchesCompleted} batch(es).`,
  });

  return {
    success: true,
    uploaded: totalUploaded,
    batches: batchesCompleted,
  };
}

// ---------------------------------------------------------------------------
// Internal: send a single batch with retry
// ---------------------------------------------------------------------------

interface SendResult {
  ok: boolean;
  error?: string;
}

async function sendBatchWithRetry(opts: {
  endpoint: string;
  token: string;
  batch: SessionQueueRecord[];
  fetchFn: typeof globalThis.fetch;
  maxRetries: number;
  retryDelayMs: number;
}): Promise<SendResult> {
  const { endpoint, token, batch, fetchFn, maxRetries, retryDelayMs } = opts;

  let lastError = "";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0 && retryDelayMs > 0) {
      await sleep(retryDelayMs * 2 ** (attempt - 1));
    }

    try {
      const resp = await fetchFn(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(batch),
      });

      if (resp.ok) {
        return { ok: true };
      }

      // 429 — rate limited, retry with Retry-After if available
      if (resp.status === 429) {
        const retryAfter = resp.headers.get("Retry-After");
        const retryMs = retryAfter
          ? Math.max(Number(retryAfter) * 1000, retryDelayMs)
          : retryDelayMs * 2 ** attempt;
        if (attempt < maxRetries && retryMs > 0) {
          await sleep(retryMs);
        }
        const body = await resp.json().catch(() => ({}));
        lastError = `429: ${(body as Record<string, string>).error ?? "Too Many Requests"}`;
        continue;
      }

      // 4xx — client error, don't retry
      if (resp.status >= 400 && resp.status < 500) {
        const body = await resp.json().catch(() => ({}));
        const msg =
          (body as Record<string, string>).error ?? `HTTP ${resp.status}`;
        return { ok: false, error: `${resp.status}: ${msg}` };
      }

      // 5xx — server error, retry
      const body = await resp.json().catch(() => ({}));
      lastError = `${resp.status}: ${(body as Record<string, string>).error ?? "Server Error"}`;
    } catch (err) {
      lastError = String((err as Error).message ?? err);

      // Network errors — don't retry if maxRetries is 0
      if (attempt >= maxRetries) {
        return { ok: false, error: lastError };
      }
    }
  }

  return {
    ok: false,
    error: `Upload failed after ${maxRetries + 1} attempts: ${lastError}`,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
