/**
 * Generic upload engine — sends queued records to a Pew SaaS endpoint.
 *
 * This is the shared pipeline used by both token and session upload commands.
 * It handles:
 * - Config/API-key loading
 * - Queue offset management
 * - Preprocessing (aggregation for tokens, dedup for sessions)
 * - Batching (≤50 records per request, D1 free plan limit)
 * - Retry with exponential backoff on 5xx
 * - 429 rate-limit handling with Retry-After (no double-sleep)
 * - Progress callbacks
 *
 * Bug fixes over the original upload/session-upload:
 * - 429 handler no longer double-sleeps (Retry-After + exponential backoff).
 *   Now the Retry-After sleep replaces the exponential backoff for that attempt.
 */

import { ConfigManager } from "../config/manager.js";
import type { BaseQueue } from "../storage/base-queue.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UploadEngineConfig<T> {
  /** The queue to read records from */
  queue: BaseQueue<T>;
  /** API endpoint path (e.g. "/api/ingest" or "/api/ingest/sessions") */
  endpoint: string;
  /** Human-readable name for progress messages (e.g. "records", "session records") */
  entityName: string;
  /** Pre-processing step: aggregation for tokens, dedup for sessions */
  preprocess: (records: T[]) => T[];
}

export interface UploadExecuteOptions {
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
// Engine factory
// ---------------------------------------------------------------------------

export function createUploadEngine<T>(config: UploadEngineConfig<T>) {
  const { queue, endpoint, entityName, preprocess } = config;

  async function execute(opts: UploadExecuteOptions): Promise<UploadResult> {
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
    const cfg = await configManager.load();

    if (!cfg.token) {
      return {
        success: false,
        uploaded: 0,
        batches: 0,
        error: "Not logged in. Run `pew login` first.",
      };
    }

    // 2. Read un-uploaded records
    const currentOffset = await queue.loadOffset();
    const { records: rawRecords, newOffset } =
      await queue.readFromOffset(currentOffset);

    if (rawRecords.length === 0) {
      return { success: true, uploaded: 0, batches: 0 };
    }

    // 2b. Pre-process (aggregate for tokens, dedup for sessions)
    const records = preprocess(rawRecords);

    // 3. Split into batches
    const batches: T[][] = [];
    for (let i = 0; i < records.length; i += batchSize) {
      batches.push(records.slice(i, i + batchSize));
    }

    // 4. Upload each batch
    const fullEndpoint = `${apiUrl}${endpoint}`;
    let totalUploaded = 0;
    let batchesCompleted = 0;

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx];

      onProgress?.({
        phase: "uploading",
        batch: batchIdx + 1,
        totalBatches: batches.length,
        total: records.length,
        message: `Uploading ${entityName} batch ${batchIdx + 1}/${batches.length} (${batch.length} records)...`,
      });

      const result = await sendBatchWithRetry({
        endpoint: fullEndpoint,
        token: cfg.token,
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
      message: `Uploaded ${totalUploaded} ${entityName} in ${batchesCompleted} batch(es).`,
    });

    return {
      success: true,
      uploaded: totalUploaded,
      batches: batchesCompleted,
    };
  }

  return { execute };
}

// ---------------------------------------------------------------------------
// Internal: send a single batch with retry
// ---------------------------------------------------------------------------

interface SendResult {
  ok: boolean;
  error?: string;
}

async function sendBatchWithRetry<T>(opts: {
  endpoint: string;
  token: string;
  batch: T[];
  fetchFn: typeof globalThis.fetch;
  maxRetries: number;
  retryDelayMs: number;
}): Promise<SendResult> {
  const { endpoint, token, batch, fetchFn, maxRetries, retryDelayMs } = opts;

  let lastError = "";
  let sleptFor429 = false;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Exponential backoff — but skip if we already slept for a 429 Retry-After
    if (attempt > 0 && !sleptFor429 && retryDelayMs > 0) {
      await sleep(retryDelayMs * 2 ** (attempt - 1));
    }
    sleptFor429 = false; // Reset for next iteration

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
          sleptFor429 = true; // Skip the top-of-loop backoff on next iteration
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
