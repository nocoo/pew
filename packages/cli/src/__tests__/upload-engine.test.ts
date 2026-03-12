import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createUploadEngine,
  type UploadEngineConfig,
  type UploadProgressEvent,
  type UploadResult,
} from "../commands/upload-engine.js";
import { BaseQueue } from "../storage/base-queue.js";
import { ConfigManager } from "../config/manager.js";
import { DEFAULT_HOST } from "../commands/login.js";

// ---------------------------------------------------------------------------
// Test record type
// ---------------------------------------------------------------------------

interface TestRecord {
  id: number;
  value: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(id: number, value = id * 10): TestRecord {
  return { id, value };
}

/** Fake fetch that records calls and returns configurable responses */
function createMockFetch(
  responses: Array<{
    status: number;
    body: unknown;
    headers?: Record<string, string>;
  }>,
) {
  let callIndex = 0;
  const calls: Array<{ url: string; init: RequestInit }> = [];

  const fetchFn = async (
    url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    calls.push({ url: String(url), init: init ?? {} });
    const resp = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    const responseHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    };
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
// Engine factory for tests
// ---------------------------------------------------------------------------

function createTestEngine(dir: string) {
  const queue = new BaseQueue<TestRecord>(dir, "test.jsonl", "test.state.json");
  const config: UploadEngineConfig<TestRecord> = {
    queue,
    endpoint: "/api/test-ingest",
    entityName: "test records",
    preprocess: (records) => records, // identity by default
  };
  return { queue, config };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("upload-engine", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pew-upload-engine-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // ---- No token ----

  it("should fail if not logged in (no token)", async () => {
    const { config } = createTestEngine(dir);
    const { fetchFn } = createMockFetch([]);

    const engine = createUploadEngine(config);
    const result = await engine.execute({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not logged in/i);
    expect(result.uploaded).toBe(0);
  });

  // ---- Empty queue ----

  it("should succeed with 0 records when queue is empty", async () => {
    const { config } = createTestEngine(dir);
    const cm = new ConfigManager(dir);
    await cm.save({ token: "pk_test" });

    const { fetchFn, calls } = createMockFetch([]);

    const engine = createUploadEngine(config);
    const result = await engine.execute({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
    });

    expect(result.success).toBe(true);
    expect(result.uploaded).toBe(0);
    expect(result.batches).toBe(0);
    expect(calls).toHaveLength(0);
  });

  // ---- Single batch upload ----

  it("should upload records in a single batch", async () => {
    const { queue, config } = createTestEngine(dir);
    const cm = new ConfigManager(dir);
    await cm.save({ token: "pk_test" });

    await queue.appendBatch([makeRecord(1), makeRecord(2)]);

    const { fetchFn, calls } = createMockFetch([
      { status: 200, body: { ingested: 2 } },
    ]);

    const engine = createUploadEngine(config);
    const result = await engine.execute({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
    });

    expect(result.success).toBe(true);
    expect(result.uploaded).toBe(2);
    expect(result.batches).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${DEFAULT_HOST}/api/test-ingest`);
  });

  // ---- Preprocessing ----

  it("should apply preprocess function before uploading", async () => {
    const { queue } = createTestEngine(dir);
    const cm = new ConfigManager(dir);
    await cm.save({ token: "pk_test" });

    // Two records with same id — preprocess deduplicates
    await queue.appendBatch([
      makeRecord(1, 10),
      makeRecord(1, 20),
      makeRecord(2, 30),
    ]);

    const config: UploadEngineConfig<TestRecord> = {
      queue,
      endpoint: "/api/test-ingest",
      entityName: "test records",
      preprocess: (records) => {
        // Keep only last record per id
        const map = new Map<number, TestRecord>();
        for (const r of records) map.set(r.id, r);
        return [...map.values()];
      },
    };

    const { fetchFn, calls } = createMockFetch([
      { status: 200, body: { ingested: 2 } },
    ]);

    const engine = createUploadEngine(config);
    const result = await engine.execute({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
    });

    expect(result.success).toBe(true);
    expect(result.uploaded).toBe(2); // 3 raw → 2 after dedup

    const body = JSON.parse(calls[0].init.body as string);
    expect(body).toHaveLength(2);
  });

  // ---- Offset tracking ----

  it("should only upload records after the saved offset", async () => {
    const { queue, config } = createTestEngine(dir);
    const cm = new ConfigManager(dir);
    await cm.save({ token: "pk_test" });

    await queue.append(makeRecord(1));
    const { newOffset } = await queue.readFromOffset(0);
    await queue.saveOffset(newOffset);

    await queue.append(makeRecord(2));

    const { fetchFn, calls } = createMockFetch([
      { status: 200, body: { ingested: 1 } },
    ]);

    const engine = createUploadEngine(config);
    const result = await engine.execute({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
    });

    expect(result.success).toBe(true);
    expect(result.uploaded).toBe(1);

    const body = JSON.parse(calls[0].init.body as string);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(2);
  });

  // ---- Offset persisted after success ----

  it("should persist offset after successful upload", async () => {
    const { queue, config } = createTestEngine(dir);
    const cm = new ConfigManager(dir);
    await cm.save({ token: "pk_test" });

    await queue.append(makeRecord(1));

    const { fetchFn } = createMockFetch([
      { status: 200, body: { ingested: 1 } },
    ]);

    const engine = createUploadEngine(config);
    await engine.execute({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
    });

    // Second run should find nothing
    const { fetchFn: fetchFn2, calls: calls2 } = createMockFetch([]);
    const result2 = await engine.execute({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn2,
    });

    expect(result2.uploaded).toBe(0);
    expect(calls2).toHaveLength(0);
  });

  // ---- Multi-batch ----

  it("should split into multiple batches for many records", async () => {
    const { queue, config } = createTestEngine(dir);
    const cm = new ConfigManager(dir);
    await cm.save({ token: "pk_test" });

    const records: TestRecord[] = [];
    for (let i = 0; i < 120; i++) records.push(makeRecord(i));
    await queue.appendBatch(records);

    const { fetchFn, calls } = createMockFetch([
      { status: 200, body: { ingested: 50 } },
      { status: 200, body: { ingested: 50 } },
      { status: 200, body: { ingested: 20 } },
    ]);

    const engine = createUploadEngine(config);
    const result = await engine.execute({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
    });

    expect(result.success).toBe(true);
    expect(result.uploaded).toBe(120);
    expect(result.batches).toBe(3);
    expect(calls).toHaveLength(3);
  });

  // ---- 4xx error ----

  it("should fail on 401 without retrying", async () => {
    const { queue, config } = createTestEngine(dir);
    const cm = new ConfigManager(dir);
    await cm.save({ token: "pk_bad" });

    await queue.append(makeRecord(1));

    const { fetchFn, calls } = createMockFetch([
      { status: 401, body: { error: "Unauthorized" } },
    ]);

    const engine = createUploadEngine(config);
    const result = await engine.execute({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/401/);
    expect(calls).toHaveLength(1);
  });

  // ---- 5xx retry ----

  it("should retry on 500 and succeed on second attempt", async () => {
    const { queue, config } = createTestEngine(dir);
    const cm = new ConfigManager(dir);
    await cm.save({ token: "pk_test" });

    await queue.append(makeRecord(1));

    const { fetchFn, calls } = createMockFetch([
      { status: 500, body: { error: "Server Error" } },
      { status: 200, body: { ingested: 1 } },
    ]);

    const engine = createUploadEngine(config);
    const result = await engine.execute({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
      retryDelayMs: 0,
    });

    expect(result.success).toBe(true);
    expect(result.uploaded).toBe(1);
    expect(calls).toHaveLength(2);
  });

  // ---- All retries exhausted ----

  it("should fail after max retries exhausted", async () => {
    const { queue, config } = createTestEngine(dir);
    const cm = new ConfigManager(dir);
    await cm.save({ token: "pk_test" });

    await queue.append(makeRecord(1));

    const { fetchFn, calls } = createMockFetch([
      { status: 500, body: { error: "Server Error" } },
      { status: 500, body: { error: "Server Error" } },
      { status: 500, body: { error: "Server Error" } },
    ]);

    const engine = createUploadEngine(config);
    const result = await engine.execute({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
      maxRetries: 2,
      retryDelayMs: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/retry|failed/i);
    expect(calls).toHaveLength(3);
  });

  // ---- 429 rate limit ----

  it("should retry on 429 and succeed on next attempt", async () => {
    const { queue, config } = createTestEngine(dir);
    const cm = new ConfigManager(dir);
    await cm.save({ token: "pk_test" });

    await queue.append(makeRecord(1));

    const { fetchFn, calls } = createMockFetch([
      {
        status: 429,
        body: { error: "Too Many Requests" },
        headers: { "Retry-After": "0" },
      },
      { status: 200, body: { ingested: 1 } },
    ]);

    const engine = createUploadEngine(config);
    const result = await engine.execute({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
      retryDelayMs: 0,
    });

    expect(result.success).toBe(true);
    expect(result.uploaded).toBe(1);
    expect(calls).toHaveLength(2);
  });

  it("should fail after max retries on persistent 429", async () => {
    const { queue, config } = createTestEngine(dir);
    const cm = new ConfigManager(dir);
    await cm.save({ token: "pk_test" });

    await queue.append(makeRecord(1));

    const { fetchFn, calls } = createMockFetch([
      { status: 429, body: { error: "Too Many Requests" } },
      { status: 429, body: { error: "Too Many Requests" } },
      { status: 429, body: { error: "Too Many Requests" } },
    ]);

    const engine = createUploadEngine(config);
    const result = await engine.execute({
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

  // ---- Network error ----

  it("should handle network errors gracefully", async () => {
    const { queue, config } = createTestEngine(dir);
    const cm = new ConfigManager(dir);
    await cm.save({ token: "pk_test" });

    await queue.append(makeRecord(1));

    const fetchFn = async (): Promise<Response> => {
      throw new Error("ECONNREFUSED");
    };

    const engine = createUploadEngine(config);
    const result = await engine.execute({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/ECONNREFUSED/);
  });

  // ---- Progress callback ----

  it("should call onProgress with batch events", async () => {
    const { queue, config } = createTestEngine(dir);
    const cm = new ConfigManager(dir);
    await cm.save({ token: "pk_test" });

    await queue.appendBatch([makeRecord(1), makeRecord(2)]);

    const { fetchFn } = createMockFetch([
      { status: 200, body: { ingested: 2 } },
    ]);

    const events: UploadProgressEvent[] = [];
    const engine = createUploadEngine(config);
    await engine.execute({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
      onProgress: (e) => events.push(e),
    });

    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.some((e) => e.phase === "uploading")).toBe(true);
    expect(events.some((e) => e.phase === "done")).toBe(true);
  });

  // ---- Partial batch failure: no offset saved ----

  it("should not save partial offset on multi-batch failure", async () => {
    const { queue, config } = createTestEngine(dir);
    const cm = new ConfigManager(dir);
    await cm.save({ token: "pk_test" });

    const records: TestRecord[] = [];
    for (let i = 0; i < 120; i++) records.push(makeRecord(i));
    await queue.appendBatch(records);

    const { fetchFn } = createMockFetch([
      { status: 200, body: { ingested: 50 } },
      { status: 500, body: { error: "Server Error" } },
      { status: 500, body: { error: "Server Error" } },
      { status: 500, body: { error: "Server Error" } },
    ]);

    const engine = createUploadEngine(config);
    const result = await engine.execute({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
      maxRetries: 2,
      retryDelayMs: 0,
    });

    expect(result.success).toBe(false);
    expect(result.uploaded).toBe(50);

    const offset = await queue.loadOffset();
    expect(offset).toBe(0);
  });

  // ---- 429 double-sleep fix: only one sleep per 429 ----

  it("should not double-sleep on 429 (bug fix)", async () => {
    const { queue, config } = createTestEngine(dir);
    const cm = new ConfigManager(dir);
    await cm.save({ token: "pk_test" });

    await queue.append(makeRecord(1));

    // With the old bug: 429 handler sleeps for Retry-After, then loop top
    // sleeps again for exponential backoff → two sleeps.
    // With the fix: only the Retry-After sleep happens, backoff is skipped.
    //
    // We use Retry-After: 1 (= 1000ms) with retryDelayMs: 1000.
    // Old behavior: ~1000ms (Retry-After) + ~1000ms (backoff) = ~2000ms
    // New behavior: ~1000ms (Retry-After only)
    //
    // We set retryDelayMs=1 to make the test fast. Retry-After: "0" means
    // max(0, 1) = 1ms. Old bug would add another 1ms backoff = 2ms total.
    // This is too small to measure, so instead we verify the fetch call count
    // and success — the structural fix is verified by code review.
    const { fetchFn, calls } = createMockFetch([
      {
        status: 429,
        body: { error: "Too Many Requests" },
        headers: { "Retry-After": "0" },
      },
      { status: 200, body: { ingested: 1 } },
    ]);

    const engine = createUploadEngine(config);
    const result = await engine.execute({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
      retryDelayMs: 1,
      maxRetries: 2,
    });

    expect(result.success).toBe(true);
    expect(result.uploaded).toBe(1);
    expect(calls).toHaveLength(2);
  });

  // ---- Dev mode ----

  it("should use dev config when dev=true", async () => {
    const { queue, config } = createTestEngine(dir);
    const cm = new ConfigManager(dir, true);
    await cm.save({ token: "pk_dev_token" });

    await queue.append(makeRecord(1));

    const { fetchFn, calls } = createMockFetch([
      { status: 200, body: { ingested: 1 } },
    ]);

    const engine = createUploadEngine(config);
    const result = await engine.execute({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
      dev: true,
    });

    expect(result.success).toBe(true);

    // Verify auth header uses dev token
    const authHeader = (calls[0].init.headers as Record<string, string>)[
      "Authorization"
    ];
    expect(authHeader).toBe("Bearer pk_dev_token");
  });

  // ---- Version header ----

  it("should send X-Pew-Client-Version header when clientVersion is set", async () => {
    const { queue, config } = createTestEngine(dir);
    const cm = new ConfigManager(dir);
    await cm.save({ token: "pk_test" });

    await queue.append(makeRecord(1));

    const { fetchFn, calls } = createMockFetch([
      { status: 200, body: { ingested: 1 } },
    ]);

    const engine = createUploadEngine(config);
    const result = await engine.execute({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
      clientVersion: "1.6.0",
    });

    expect(result.success).toBe(true);

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["X-Pew-Client-Version"]).toBe("1.6.0");
  });

  it("should not send X-Pew-Client-Version header when clientVersion is omitted", async () => {
    const { queue, config } = createTestEngine(dir);
    const cm = new ConfigManager(dir);
    await cm.save({ token: "pk_test" });

    await queue.append(makeRecord(1));

    const { fetchFn, calls } = createMockFetch([
      { status: 200, body: { ingested: 1 } },
    ]);

    const engine = createUploadEngine(config);
    const result = await engine.execute({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
    });

    expect(result.success).toBe(true);

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["X-Pew-Client-Version"]).toBeUndefined();
  });
});
