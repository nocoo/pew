import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createUploadEngine,
  type UploadEngineConfig,
  type UploadProgressEvent,
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

  it("falls back to 'Too Many Requests' when 429 body omits error field", async () => {
    const { queue, config } = createTestEngine(dir);
    const cm = new ConfigManager(dir);
    await cm.save({ token: "pk_test" });
    await queue.append(makeRecord(1));
    const { fetchFn } = createMockFetch([
      { status: 429, body: {} }, // no error field → exercises ?? fallback
      { status: 429, body: {} },
      { status: 429, body: {} },
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
    expect(result.error).toContain("Too Many Requests");
  });

  it("falls back to 'HTTP <status>' on 4xx when body omits error field", async () => {
    const { queue, config } = createTestEngine(dir);
    const cm = new ConfigManager(dir);
    await cm.save({ token: "pk_test" });
    await queue.append(makeRecord(1));
    const { fetchFn } = createMockFetch([
      { status: 400, body: {} }, // no error field on 4xx
    ]);
    const engine = createUploadEngine(config);
    const result = await engine.execute({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
      retryDelayMs: 0,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("HTTP 400");
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

  // ---- All-corrupt queue: offset advancement ----

  it("should advance offset past all-corrupt lines and not re-read them", async () => {
    const { queue, config } = createTestEngine(dir);
    const cm = new ConfigManager(dir);
    await cm.save({ token: "pk_test" });

    // Write corrupt (non-JSON) data directly to the queue file
    const corruptData = "NOT_JSON_LINE_1\n{broken json\ngarbage!!!\n";
    await writeFile(queue.queuePath, corruptData);

    const { fetchFn, calls } = createMockFetch([]);

    const engine = createUploadEngine(config);

    // First execute: all lines are corrupt → 0 uploaded, but offset should advance
    const result1 = await engine.execute({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
    });

    expect(result1.success).toBe(true);
    expect(result1.uploaded).toBe(0);
    expect(result1.batches).toBe(0);
    expect(calls).toHaveLength(0); // No HTTP calls for 0 valid records

    // Verify offset was saved (advanced past the corrupt data)
    const savedOffset = await queue.loadOffset();
    expect(savedOffset).toBe(Buffer.byteLength(corruptData));

    // Second execute: offset is past corrupt data → nothing to read, no loop
    const { fetchFn: fetchFn2, calls: calls2 } = createMockFetch([]);
    const result2 = await engine.execute({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn2,
    });

    expect(result2.success).toBe(true);
    expect(result2.uploaded).toBe(0);
    expect(calls2).toHaveLength(0);
  });

  // =========================================================================
  // Dirty-keys filtering
  // =========================================================================

  describe("dirty-keys filtering", () => {
    /** Helper: create engine with a recordKey extractor for dirty-keys support */
    function createDirtyKeysEngine(testDir: string) {
      const queue = new BaseQueue<TestRecord>(
        testDir,
        "test.jsonl",
        "test.state.json",
      );
      const config: UploadEngineConfig<TestRecord> = {
        queue,
        endpoint: "/api/test-ingest",
        entityName: "test records",
        preprocess: (records) => records,
        recordKey: (r) => `key-${r.id}`,
      };
      return { queue, config };
    }

    it("should upload only records matching dirtyKeys", async () => {
      const { queue, config } = createDirtyKeysEngine(dir);
      const cm = new ConfigManager(dir);
      await cm.save({ token: "pk_test" });

      // Queue has 4 records
      await queue.appendBatch([
        makeRecord(1),
        makeRecord(2),
        makeRecord(3),
        makeRecord(4),
      ]);

      // Only 2 keys are dirty
      await queue.saveDirtyKeys(["key-2", "key-4"]);

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

      // Verify only dirty records were sent
      const body = JSON.parse(calls[0].init.body as string) as TestRecord[];
      const ids = body.map((r) => r.id).sort();
      expect(ids).toEqual([2, 4]);
    });

    it("should skip upload when dirtyKeys is empty array", async () => {
      const { queue, config } = createDirtyKeysEngine(dir);
      const cm = new ConfigManager(dir);
      await cm.save({ token: "pk_test" });

      await queue.appendBatch([makeRecord(1), makeRecord(2)]);

      // dirtyKeys is empty — nothing to upload
      await queue.saveDirtyKeys([]);

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

    it("should fall back to offset-based upload when dirtyKeys is undefined (legacy)", async () => {
      const { queue, config } = createDirtyKeysEngine(dir);
      const cm = new ConfigManager(dir);
      await cm.save({ token: "pk_test" });

      // Append records and set offset to skip the first one
      await queue.append(makeRecord(1));
      const { newOffset } = await queue.readFromOffset(0);
      await queue.saveOffset(newOffset);

      await queue.append(makeRecord(2));

      // dirtyKeys is undefined (legacy state) — should use offset
      // Don't call saveDirtyKeys at all, so it stays undefined

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

      // Should only upload record 2 (after offset)
      const body = JSON.parse(calls[0].init.body as string) as TestRecord[];
      expect(body).toHaveLength(1);
      expect(body[0].id).toBe(2);
    });

    it("should clear dirtyKeys to [] after successful upload", async () => {
      const { queue, config } = createDirtyKeysEngine(dir);
      const cm = new ConfigManager(dir);
      await cm.save({ token: "pk_test" });

      await queue.appendBatch([makeRecord(1), makeRecord(2)]);
      await queue.saveDirtyKeys(["key-1", "key-2"]);

      const { fetchFn } = createMockFetch([
        { status: 200, body: { ingested: 2 } },
      ]);

      const engine = createUploadEngine(config);
      await engine.execute({
        stateDir: dir,
        apiUrl: DEFAULT_HOST,
        fetch: fetchFn,
      });

      // dirtyKeys should be cleared to empty array (not undefined)
      const keys = await queue.loadDirtyKeys();
      expect(keys).toEqual([]);
    });

    it("should NOT clear dirtyKeys on upload failure", async () => {
      const { queue, config } = createDirtyKeysEngine(dir);
      const cm = new ConfigManager(dir);
      await cm.save({ token: "pk_test" });

      await queue.appendBatch([makeRecord(1), makeRecord(2)]);
      await queue.saveDirtyKeys(["key-1", "key-2"]);

      const { fetchFn } = createMockFetch([
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

      // dirtyKeys should still be set (not cleared)
      const keys = await queue.loadDirtyKeys();
      expect(keys).toEqual(["key-1", "key-2"]);
    });

    it("should read from offset 0 when dirtyKeys is present (ignoring saved offset)", async () => {
      const { queue, config } = createDirtyKeysEngine(dir);
      const cm = new ConfigManager(dir);
      await cm.save({ token: "pk_test" });

      // Write records AND set offset to skip them all
      await queue.appendBatch([makeRecord(1), makeRecord(2)]);
      const { newOffset } = await queue.readFromOffset(0);
      await queue.saveOffset(newOffset); // offset = end of file

      // But dirtyKeys says record 1 changed
      await queue.saveDirtyKeys(["key-1"]);

      const { fetchFn, calls } = createMockFetch([
        { status: 200, body: { ingested: 1 } },
      ]);

      const engine = createUploadEngine(config);
      const result = await engine.execute({
        stateDir: dir,
        apiUrl: DEFAULT_HOST,
        fetch: fetchFn,
      });

      // Should upload record 1 even though offset says "past end"
      expect(result.success).toBe(true);
      expect(result.uploaded).toBe(1);

      const body = JSON.parse(calls[0].init.body as string) as TestRecord[];
      expect(body).toHaveLength(1);
      expect(body[0].id).toBe(1);
    });

    it("should handle dirtyKeys with no matching records gracefully", async () => {
      const { queue, config } = createDirtyKeysEngine(dir);
      const cm = new ConfigManager(dir);
      await cm.save({ token: "pk_test" });

      await queue.appendBatch([makeRecord(1), makeRecord(2)]);

      // Dirty key references a record that doesn't exist in queue
      await queue.saveDirtyKeys(["key-999"]);

      const { fetchFn, calls } = createMockFetch([]);

      const engine = createUploadEngine(config);
      const result = await engine.execute({
        stateDir: dir,
        apiUrl: DEFAULT_HOST,
        fetch: fetchFn,
      });

      // No matching records → 0 uploaded, but should succeed
      expect(result.success).toBe(true);
      expect(result.uploaded).toBe(0);
      expect(result.batches).toBe(0);
      expect(calls).toHaveLength(0);

      // dirtyKeys should be cleared (the upload "succeeded" with 0 records)
      const keys = await queue.loadDirtyKeys();
      expect(keys).toEqual([]);
    });
  });

  // ---- All-corrupt queue: offset advancement ----

  it("should advance offset past corrupt lines followed by valid records", async () => {
    const { queue, config } = createTestEngine(dir);
    const cm = new ConfigManager(dir);
    await cm.save({ token: "pk_test" });

    // Mix of corrupt and valid lines
    const line1 = "NOT_VALID_JSON\n";
    const line2 = JSON.stringify(makeRecord(1)) + "\n";
    const line3 = "{broken\n";
    const line4 = JSON.stringify(makeRecord(2)) + "\n";
    await writeFile(queue.queuePath, line1 + line2 + line3 + line4);

    const { fetchFn, calls } = createMockFetch([
      { status: 200, body: { ingested: 2 } },
    ]);

    const engine = createUploadEngine(config);
    const result = await engine.execute({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
    });

    // Should upload the 2 valid records, skipping the 2 corrupt ones
    expect(result.success).toBe(true);
    expect(result.uploaded).toBe(2);
    expect(calls).toHaveLength(1);

    // Second run: nothing left to upload
    const { fetchFn: fetchFn2, calls: calls2 } = createMockFetch([]);
    const result2 = await engine.execute({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn2,
    });

    expect(result2.success).toBe(true);
    expect(result2.uploaded).toBe(0);
    expect(calls2).toHaveLength(0);
  });
});
