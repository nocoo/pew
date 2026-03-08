/**
 * CLI upload command — sends local queue records to the Zebra SaaS.
 *
 * Flow:
 * 1. Load API key from config
 * 2. Read un-uploaded records from queue (using saved offset)
 * 3. Split into batches of ≤50 (D1 Free plan: 50 queries/Worker invocation)
 * 4. POST each batch to /api/ingest with Bearer token
 * 5. Persist offset after each successful batch (for resume on failure)
 * 6. Retry on 5xx with exponential backoff
 */

import { ConfigManager } from "../config/manager.js";
import { LocalQueue } from "../storage/local-queue.js";
import type { QueueRecord } from "@zebra/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UploadOptions {
  /** Directory for config file and queue state */
  stateDir: string;
  /** Base URL of the Zebra SaaS */
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

export interface UploadProgressEvent {
  phase: "uploading" | "done";
  batch?: number;
  totalBatches?: number;
  total?: number;
  message?: string;
}

export interface UploadResult {
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
      error: "Not logged in. Run `zebra login` first.",
    };
  }

  // 2. Read un-uploaded records
  const queue = new LocalQueue(stateDir);
  const currentOffset = await queue.loadOffset();
  const { records: rawRecords, newOffset } = await queue.readFromOffset(currentOffset);

  if (rawRecords.length === 0) {
    return { success: true, uploaded: 0, batches: 0 };
  }

  // 2b. Pre-aggregate by (source, model, hour_start) for idempotent upsert
  const records = aggregateRecords(rawRecords);

  // 3. Split into batches
  const batches: QueueRecord[][] = [];
  for (let i = 0; i < records.length; i += batchSize) {
    batches.push(records.slice(i, i + batchSize));
  }

  // 4. Upload each batch
  const endpoint = `${apiUrl}/api/ingest`;
  let totalUploaded = 0;
  let batchesCompleted = 0;

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];

    onProgress?.({
      phase: "uploading",
      batch: batchIdx + 1,
      totalBatches: batches.length,
      total: records.length,
      message: `Uploading batch ${batchIdx + 1}/${batches.length} (${batch.length} records)...`,
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
      // With idempotent overwrite upsert, don't save partial offset.
      // Next retry will re-aggregate and re-send everything safely.
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
    message: `Uploaded ${totalUploaded} records in ${batchesCompleted} batch(es).`,
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
  batch: QueueRecord[];
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
