import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { executeUpload, aggregateRecords, type UploadOptions } from "../commands/upload.js";
import { LocalQueue } from "../storage/local-queue.js";
import { ConfigManager } from "../config/manager.js";
import { DEFAULT_HOST } from "../commands/login.js";
import type { QueueRecord } from "@zebra/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<QueueRecord> = {}): QueueRecord {
  return {
    source: "claude-code",
    model: "claude-sonnet-4-20250514",
    hour_start: "2026-03-07T10:00:00.000Z",
    input_tokens: 100,
    cached_input_tokens: 20,
    output_tokens: 50,
    reasoning_output_tokens: 0,
    total_tokens: 150,
    ...overrides,
  };
}

/** Fake fetch that records calls and returns configurable responses */
function createMockFetch(responses: Array<{ status: number; body: unknown; headers?: Record<string, string> }>) {
  let callIndex = 0;
  const calls: Array<{ url: string; init: RequestInit }> = [];

  const fetchFn = async (
    url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    calls.push({ url: String(url), init: init ?? {} });
    const resp = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    const responseHeaders: Record<string, string> = { "Content-Type": "application/json" };
    if (resp.headers) {
      Object.assign(responseHeaders, resp.headers);
    }
    return new Response(JSON.stringify(resp.body), {
      status: resp.status,
      headers: responseHeaders,
    });
  };

  return { fetchFn, calls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("executeUpload", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zebra-upload-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // ----- No token -----

  it("should fail if not logged in (no token)", async () => {
    const { fetchFn } = createMockFetch([]);

    const result = await executeUpload({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not logged in/i);
    expect(result.uploaded).toBe(0);
  });

  // ----- No pending records -----

  it("should succeed with 0 records when queue is empty", async () => {
    const config = new ConfigManager(dir);
    await config.save({ token: "zk_abc123" });

    const { fetchFn, calls } = createMockFetch([]);

    const result = await executeUpload({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
    });

    expect(result.success).toBe(true);
    expect(result.uploaded).toBe(0);
    expect(result.batches).toBe(0);
    expect(calls).toHaveLength(0);
  });

  // ----- Single batch upload -----

  it("should upload pending records in a single batch", async () => {
    const config = new ConfigManager(dir);
    await config.save({ token: "zk_test_token" });

    const queue = new LocalQueue(dir);
    const records = [
      makeRecord({ model: "claude-sonnet-4-20250514" }),
      makeRecord({ model: "o3", source: "openclaw" }),
    ];
    await queue.appendBatch(records);

    const { fetchFn, calls } = createMockFetch([
      { status: 200, body: { ingested: 2 } },
    ]);

    const result = await executeUpload({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
    });

    expect(result.success).toBe(true);
    expect(result.uploaded).toBe(2);
    expect(result.batches).toBe(1);

    // Verify fetch was called correctly
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${DEFAULT_HOST}/api/ingest`);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer zk_test_token",
    });

    // Verify body contains both records
    const body = JSON.parse(calls[0].init.body as string);
    expect(body).toHaveLength(2);
    expect(body[0].model).toBe("claude-sonnet-4-20250514");
    expect(body[1].source).toBe("openclaw");
  });

  // ----- Offset tracking (incremental upload) -----

  it("should only upload records after the saved offset", async () => {
    const config = new ConfigManager(dir);
    await config.save({ token: "zk_incremental" });

    const queue = new LocalQueue(dir);

    // First batch — already uploaded
    const batch1 = [makeRecord({ model: "old-model" })];
    await queue.appendBatch(batch1);

    // Simulate that batch1 was already uploaded (save the offset)
    const { newOffset } = await queue.readFromOffset(0);
    await queue.saveOffset(newOffset);

    // Second batch — new, not yet uploaded
    const batch2 = [makeRecord({ model: "new-model" })];
    await queue.appendBatch(batch2);

    const { fetchFn, calls } = createMockFetch([
      { status: 200, body: { ingested: 1 } },
    ]);

    const result = await executeUpload({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
    });

    expect(result.success).toBe(true);
    expect(result.uploaded).toBe(1);

    // Only the new record should be sent
    const body = JSON.parse(calls[0].init.body as string);
    expect(body).toHaveLength(1);
    expect(body[0].model).toBe("new-model");
  });

  // ----- Offset persisted after success -----

  it("should persist offset after successful upload", async () => {
    const config = new ConfigManager(dir);
    await config.save({ token: "zk_persist" });

    const queue = new LocalQueue(dir);
    await queue.appendBatch([makeRecord()]);

    const { fetchFn } = createMockFetch([
      { status: 200, body: { ingested: 1 } },
    ]);

    await executeUpload({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
    });

    // Second upload should find nothing new
    const { fetchFn: fetchFn2, calls: calls2 } = createMockFetch([]);
    const result2 = await executeUpload({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn2,
    });

    expect(result2.uploaded).toBe(0);
    expect(calls2).toHaveLength(0);
  });

  // ----- Multi-batch (>50 records) -----

  it("should split into multiple batches for >50 records", async () => {
    const config = new ConfigManager(dir);
    await config.save({ token: "zk_big_batch" });

    const queue = new LocalQueue(dir);
    const records: QueueRecord[] = [];
    for (let i = 0; i < 120; i++) {
      records.push(
        makeRecord({
          model: `model-${i}`,
          hour_start: `2026-03-07T${String(i % 24).padStart(2, "0")}:00:00.000Z`,
        }),
      );
    }
    await queue.appendBatch(records);

    const { fetchFn, calls } = createMockFetch([
      { status: 200, body: { ingested: 50 } },
      { status: 200, body: { ingested: 50 } },
      { status: 200, body: { ingested: 20 } },
    ]);

    const result = await executeUpload({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
    });

    expect(result.success).toBe(true);
    expect(result.uploaded).toBe(120);
    expect(result.batches).toBe(3);
    expect(calls).toHaveLength(3);

    const body1 = JSON.parse(calls[0].init.body as string);
    const body2 = JSON.parse(calls[1].init.body as string);
    const body3 = JSON.parse(calls[2].init.body as string);
    expect(body1).toHaveLength(50);
    expect(body2).toHaveLength(50);
    expect(body3).toHaveLength(20);
  });

  // ----- API error (4xx) — should stop and report -----

  it("should fail on 401 unauthorized", async () => {
    const config = new ConfigManager(dir);
    await config.save({ token: "zk_bad_token" });

    const queue = new LocalQueue(dir);
    await queue.appendBatch([makeRecord()]);

    const { fetchFn } = createMockFetch([
      { status: 401, body: { error: "Unauthorized" } },
    ]);

    const result = await executeUpload({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/401|unauthorized/i);
    expect(result.uploaded).toBe(0);

    // Offset should NOT be persisted on failure
    const offset = await queue.loadOffset();
    expect(offset).toBe(0);
  });

  // ----- Server error (5xx) with retry -----

  it("should retry on 500 and succeed on second attempt", async () => {
    const config = new ConfigManager(dir);
    await config.save({ token: "zk_retry" });

    const queue = new LocalQueue(dir);
    await queue.appendBatch([makeRecord()]);

    const { fetchFn, calls } = createMockFetch([
      { status: 500, body: { error: "Internal Server Error" } },
      { status: 200, body: { ingested: 1 } },
    ]);

    const result = await executeUpload({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
      retryDelayMs: 0, // no delay for tests
    });

    expect(result.success).toBe(true);
    expect(result.uploaded).toBe(1);
    expect(calls).toHaveLength(2);
  });

  // ----- All retries exhausted -----

  it("should fail after max retries exhausted", async () => {
    const config = new ConfigManager(dir);
    await config.save({ token: "zk_exhaust" });

    const queue = new LocalQueue(dir);
    await queue.appendBatch([makeRecord()]);

    const { fetchFn, calls } = createMockFetch([
      { status: 500, body: { error: "Server Error" } },
      { status: 500, body: { error: "Server Error" } },
      { status: 500, body: { error: "Server Error" } },
    ]);

    const result = await executeUpload({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
      maxRetries: 2,
      retryDelayMs: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/retry|failed/i);
    // 1 initial + 2 retries = 3 calls
    expect(calls).toHaveLength(3);

    // Offset should NOT be persisted on failure
    const offset = await queue.loadOffset();
    expect(offset).toBe(0);
  });

  // ----- Network failure -----

  it("should handle network/fetch errors gracefully", async () => {
    const config = new ConfigManager(dir);
    await config.save({ token: "zk_network" });

    const queue = new LocalQueue(dir);
    await queue.appendBatch([makeRecord()]);

    const fetchFn = async (): Promise<Response> => {
      throw new Error("ECONNREFUSED");
    };

    const result = await executeUpload({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
      maxRetries: 0,
      retryDelayMs: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/ECONNREFUSED/);
  });

  // ----- Progress callback -----

  it("should call onProgress with batch events", async () => {
    const config = new ConfigManager(dir);
    await config.save({ token: "zk_progress" });

    const queue = new LocalQueue(dir);
    await queue.appendBatch([makeRecord(), makeRecord({ model: "o3" })]);

    const { fetchFn } = createMockFetch([
      { status: 200, body: { ingested: 2 } },
    ]);

    const events: Array<{ phase: string; batch?: number; total?: number }> = [];

    await executeUpload({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
      onProgress: (e) => events.push(e),
    });

    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.some((e) => e.phase === "uploading")).toBe(true);
    expect(events.some((e) => e.phase === "done")).toBe(true);
  });

  // ----- Partial batch failure: no partial offset saved (all-or-nothing) -----

  it("should not save partial offset on multi-batch failure (idempotent retry)", async () => {
    const config = new ConfigManager(dir);
    await config.save({ token: "zk_partial" });

    const queue = new LocalQueue(dir);
    // 120 records → 3 batches (50 + 50 + 20)
    const records: QueueRecord[] = [];
    for (let i = 0; i < 120; i++) {
      records.push(
        makeRecord({
          model: `model-${i}`,
          hour_start: `2026-03-07T${String(i % 24).padStart(2, "0")}:00:00.000Z`,
        }),
      );
    }
    await queue.appendBatch(records);

    // First batch succeeds, second fails
    const { fetchFn } = createMockFetch([
      { status: 200, body: { ingested: 50 } },
      { status: 500, body: { error: "Server Error" } },
      { status: 500, body: { error: "Server Error" } },
      { status: 500, body: { error: "Server Error" } },
    ]);

    const result = await executeUpload({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
      maxRetries: 2,
      retryDelayMs: 0,
    });

    // Should report partial success
    expect(result.success).toBe(false);
    expect(result.uploaded).toBe(50);

    // Offset should NOT be saved (all-or-nothing for idempotent retry)
    const offset = await queue.loadOffset();
    expect(offset).toBe(0);

    // On re-upload, all 120 records are re-aggregated and re-sent.
    // With overwrite upsert, this is safe — already-uploaded records
    // are simply overwritten with the same values.
    const { fetchFn: fetchFn2, calls: calls2 } = createMockFetch([
      { status: 200, body: { ingested: 50 } },
      { status: 200, body: { ingested: 50 } },
      { status: 200, body: { ingested: 20 } },
    ]);

    const result2 = await executeUpload({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn2,
    });

    expect(result2.success).toBe(true);
    expect(result2.uploaded).toBe(120);
  });

  // ----- 429 rate limit — should retry (not treat as fatal 4xx) -----

  it("should retry on 429 and succeed on next attempt", async () => {
    const config = new ConfigManager(dir);
    await config.save({ token: "zk_ratelimit" });

    const queue = new LocalQueue(dir);
    await queue.appendBatch([makeRecord()]);

    const { fetchFn, calls } = createMockFetch([
      { status: 429, body: { error: "Too Many Requests" }, headers: { "Retry-After": "1" } },
      { status: 200, body: { ingested: 1 } },
    ]);

    const result = await executeUpload({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
      retryDelayMs: 0, // no delay for tests
    });

    expect(result.success).toBe(true);
    expect(result.uploaded).toBe(1);
    expect(calls).toHaveLength(2);
  });

  it("should fail after max retries on persistent 429", async () => {
    const config = new ConfigManager(dir);
    await config.save({ token: "zk_ratelimit_exhaust" });

    const queue = new LocalQueue(dir);
    await queue.appendBatch([makeRecord()]);

    const { fetchFn, calls } = createMockFetch([
      { status: 429, body: { error: "Too Many Requests" } },
      { status: 429, body: { error: "Too Many Requests" } },
      { status: 429, body: { error: "Too Many Requests" } },
    ]);

    const result = await executeUpload({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
      maxRetries: 2,
      retryDelayMs: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/429|rate.?limit|too many|retry|failed/i);
    expect(calls).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// aggregateRecords
// ---------------------------------------------------------------------------

describe("aggregateRecords", () => {
  it("should return records unchanged when all keys are unique", () => {
    const records: QueueRecord[] = [
      makeRecord({ source: "claude-code", model: "sonnet", hour_start: "2026-03-07T10:00:00.000Z" }),
      makeRecord({ source: "gemini-cli", model: "gemini-2.5-pro", hour_start: "2026-03-07T10:00:00.000Z" }),
    ];

    const result = aggregateRecords(records);
    expect(result).toHaveLength(2);
  });

  it("should merge records with the same (source, model, hour_start)", () => {
    const records: QueueRecord[] = [
      makeRecord({
        source: "claude-code",
        model: "sonnet",
        hour_start: "2026-03-07T10:00:00.000Z",
        input_tokens: 100,
        cached_input_tokens: 20,
        output_tokens: 50,
        reasoning_output_tokens: 0,
        total_tokens: 150,
      }),
      makeRecord({
        source: "claude-code",
        model: "sonnet",
        hour_start: "2026-03-07T10:00:00.000Z",
        input_tokens: 200,
        cached_input_tokens: 30,
        output_tokens: 100,
        reasoning_output_tokens: 10,
        total_tokens: 330,
      }),
    ];

    const result = aggregateRecords(records);
    expect(result).toHaveLength(1);
    expect(result[0].input_tokens).toBe(300);
    expect(result[0].cached_input_tokens).toBe(50);
    expect(result[0].output_tokens).toBe(150);
    expect(result[0].reasoning_output_tokens).toBe(10);
    expect(result[0].total_tokens).toBe(480);
    expect(result[0].source).toBe("claude-code");
    expect(result[0].model).toBe("sonnet");
    expect(result[0].hour_start).toBe("2026-03-07T10:00:00.000Z");
  });

  it("should handle empty array", () => {
    expect(aggregateRecords([])).toEqual([]);
  });

  it("should keep separate buckets for different models", () => {
    const records: QueueRecord[] = [
      makeRecord({ model: "sonnet", input_tokens: 100, total_tokens: 100 }),
      makeRecord({ model: "opus", input_tokens: 200, total_tokens: 200 }),
    ];

    const result = aggregateRecords(records);
    expect(result).toHaveLength(2);
  });

  it("should keep separate buckets for different hour_starts", () => {
    const records: QueueRecord[] = [
      makeRecord({ hour_start: "2026-03-07T10:00:00.000Z", input_tokens: 100, total_tokens: 100 }),
      makeRecord({ hour_start: "2026-03-07T10:30:00.000Z", input_tokens: 200, total_tokens: 200 }),
    ];

    const result = aggregateRecords(records);
    expect(result).toHaveLength(2);
  });

  it("should aggregate three duplicate records into one", () => {
    const records: QueueRecord[] = [
      makeRecord({ input_tokens: 100, total_tokens: 100 }),
      makeRecord({ input_tokens: 200, total_tokens: 200 }),
      makeRecord({ input_tokens: 300, total_tokens: 300 }),
    ];

    const result = aggregateRecords(records);
    expect(result).toHaveLength(1);
    expect(result[0].input_tokens).toBe(600);
    expect(result[0].total_tokens).toBe(600);
  });
});
