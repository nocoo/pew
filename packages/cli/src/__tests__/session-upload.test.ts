import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  deduplicateSessionRecords,
  executeSessionUpload,
  type SessionUploadOptions,
} from "../commands/session-upload.js";
import { SessionQueue } from "../storage/session-queue.js";
import { ConfigManager } from "../config/manager.js";
import { DEFAULT_HOST } from "../commands/login.js";
import type { SessionQueueRecord } from "@pew/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSessionRecord(
  overrides: Partial<SessionQueueRecord> = {},
): SessionQueueRecord {
  return {
    session_key: "claude-code|abc123",
    source: "claude-code",
    kind: "human",
    started_at: "2026-03-07T10:00:00.000Z",
    last_message_at: "2026-03-07T10:30:00.000Z",
    duration_seconds: 1800,
    user_messages: 5,
    assistant_messages: 5,
    total_messages: 10,
    project_ref: "proj-hash",
    model: "claude-sonnet-4-20250514",
    snapshot_at: "2026-03-09T12:00:00.000Z",
    ...overrides,
  };
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
// deduplicateSessionRecords
// ---------------------------------------------------------------------------

describe("deduplicateSessionRecords", () => {
  it("should return empty array for empty input", () => {
    expect(deduplicateSessionRecords([])).toEqual([]);
  });

  it("should return records unchanged when all session_keys are unique", () => {
    const records: SessionQueueRecord[] = [
      makeSessionRecord({ session_key: "claude-code|aaa" }),
      makeSessionRecord({ session_key: "claude-code|bbb" }),
      makeSessionRecord({ session_key: "gemini-cli|ccc" }),
    ];

    const result = deduplicateSessionRecords(records);
    expect(result).toHaveLength(3);
  });

  it("should keep only the latest snapshot_at for duplicate session_keys", () => {
    const records: SessionQueueRecord[] = [
      makeSessionRecord({
        session_key: "claude-code|aaa",
        snapshot_at: "2026-03-09T10:00:00.000Z",
        user_messages: 3,
      }),
      makeSessionRecord({
        session_key: "claude-code|aaa",
        snapshot_at: "2026-03-09T12:00:00.000Z",
        user_messages: 7,
      }),
    ];

    const result = deduplicateSessionRecords(records);
    expect(result).toHaveLength(1);
    expect(result[0].user_messages).toBe(7);
    expect(result[0].snapshot_at).toBe("2026-03-09T12:00:00.000Z");
  });

  it("should keep earlier record if it has a later snapshot_at", () => {
    const records: SessionQueueRecord[] = [
      makeSessionRecord({
        session_key: "claude-code|aaa",
        snapshot_at: "2026-03-09T14:00:00.000Z",
        total_messages: 20,
      }),
      makeSessionRecord({
        session_key: "claude-code|aaa",
        snapshot_at: "2026-03-09T12:00:00.000Z",
        total_messages: 10,
      }),
    ];

    const result = deduplicateSessionRecords(records);
    expect(result).toHaveLength(1);
    expect(result[0].total_messages).toBe(20);
    expect(result[0].snapshot_at).toBe("2026-03-09T14:00:00.000Z");
  });

  it("should handle three snapshots of the same session", () => {
    const records: SessionQueueRecord[] = [
      makeSessionRecord({
        session_key: "opencode|xyz",
        snapshot_at: "2026-03-09T08:00:00.000Z",
        duration_seconds: 600,
      }),
      makeSessionRecord({
        session_key: "opencode|xyz",
        snapshot_at: "2026-03-09T12:00:00.000Z",
        duration_seconds: 3600,
      }),
      makeSessionRecord({
        session_key: "opencode|xyz",
        snapshot_at: "2026-03-09T10:00:00.000Z",
        duration_seconds: 1800,
      }),
    ];

    const result = deduplicateSessionRecords(records);
    expect(result).toHaveLength(1);
    expect(result[0].duration_seconds).toBe(3600);
    expect(result[0].snapshot_at).toBe("2026-03-09T12:00:00.000Z");
  });

  it("should deduplicate across different sources independently", () => {
    const records: SessionQueueRecord[] = [
      makeSessionRecord({
        session_key: "claude-code|aaa",
        snapshot_at: "2026-03-09T10:00:00.000Z",
      }),
      makeSessionRecord({
        session_key: "claude-code|aaa",
        snapshot_at: "2026-03-09T12:00:00.000Z",
      }),
      makeSessionRecord({
        session_key: "gemini-cli|bbb",
        snapshot_at: "2026-03-09T09:00:00.000Z",
      }),
      makeSessionRecord({
        session_key: "gemini-cli|bbb",
        snapshot_at: "2026-03-09T11:00:00.000Z",
      }),
    ];

    const result = deduplicateSessionRecords(records);
    expect(result).toHaveLength(2);
    const keys = result.map((r) => r.session_key).sort();
    expect(keys).toEqual(["claude-code|aaa", "gemini-cli|bbb"]);

    const claude = result.find((r) => r.session_key === "claude-code|aaa")!;
    expect(claude.snapshot_at).toBe("2026-03-09T12:00:00.000Z");

    const gemini = result.find((r) => r.session_key === "gemini-cli|bbb")!;
    expect(gemini.snapshot_at).toBe("2026-03-09T11:00:00.000Z");
  });

  it("should not mutate the input array", () => {
    const records: SessionQueueRecord[] = [
      makeSessionRecord({
        session_key: "claude-code|aaa",
        snapshot_at: "2026-03-09T10:00:00.000Z",
      }),
      makeSessionRecord({
        session_key: "claude-code|aaa",
        snapshot_at: "2026-03-09T12:00:00.000Z",
      }),
    ];

    const original = [...records];
    deduplicateSessionRecords(records);

    expect(records).toHaveLength(2);
    expect(records[0]).toEqual(original[0]);
    expect(records[1]).toEqual(original[1]);
  });

  it("should preserve all fields from the winning record", () => {
    const winner = makeSessionRecord({
      session_key: "openclaw|hash123",
      source: "openclaw",
      kind: "automated",
      started_at: "2026-03-09T08:00:00.000Z",
      last_message_at: "2026-03-09T09:30:00.000Z",
      duration_seconds: 5400,
      user_messages: 0,
      assistant_messages: 15,
      total_messages: 30,
      project_ref: "agent-abc",
      model: null,
      snapshot_at: "2026-03-09T14:00:00.000Z",
    });

    const loser = makeSessionRecord({
      session_key: "openclaw|hash123",
      snapshot_at: "2026-03-09T10:00:00.000Z",
      total_messages: 5,
    });

    const result = deduplicateSessionRecords([loser, winner]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(winner);
  });
});

// ---------------------------------------------------------------------------
// executeSessionUpload
// ---------------------------------------------------------------------------

describe("executeSessionUpload", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pew-session-upload-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // ----- No token -----

  it("should fail if not logged in (no token)", async () => {
    const { fetchFn } = createMockFetch([]);

    const result = await executeSessionUpload({
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
    await config.save({ token: "pk_abc123" });

    const { fetchFn, calls } = createMockFetch([]);

    const result = await executeSessionUpload({
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

  it("should upload pending session records in a single batch", async () => {
    const config = new ConfigManager(dir);
    await config.save({ token: "pk_test_token" });

    const queue = new SessionQueue(dir);
    const records = [
      makeSessionRecord({ session_key: "claude-code|aaa" }),
      makeSessionRecord({ session_key: "gemini-cli|bbb", source: "gemini-cli" }),
    ];
    await queue.appendBatch(records);

    const { fetchFn, calls } = createMockFetch([
      { status: 200, body: { ingested: 2 } },
    ]);

    const result = await executeSessionUpload({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
    });

    expect(result.success).toBe(true);
    expect(result.uploaded).toBe(2);
    expect(result.batches).toBe(1);

    // Verify fetch was called with correct endpoint
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${DEFAULT_HOST}/api/ingest/sessions`);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer pk_test_token",
    });

    // Verify body contains the session records
    const body = JSON.parse(calls[0].init.body as string);
    expect(body).toHaveLength(2);
    expect(body[0].session_key).toBe("claude-code|aaa");
    expect(body[1].source).toBe("gemini-cli");
  });

  // ----- Offset tracking -----

  it("should only upload records after the saved offset", async () => {
    const config = new ConfigManager(dir);
    await config.save({ token: "pk_incremental" });

    const queue = new SessionQueue(dir);

    // First batch — already uploaded
    const batch1 = [makeSessionRecord({ session_key: "old-session" })];
    await queue.appendBatch(batch1);

    // Simulate batch1 already uploaded
    const { newOffset } = await queue.readFromOffset(0);
    await queue.saveOffset(newOffset);

    // Second batch — new, not yet uploaded
    const batch2 = [makeSessionRecord({ session_key: "new-session" })];
    await queue.appendBatch(batch2);

    const { fetchFn, calls } = createMockFetch([
      { status: 200, body: { ingested: 1 } },
    ]);

    const result = await executeSessionUpload({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
    });

    expect(result.success).toBe(true);
    expect(result.uploaded).toBe(1);

    const body = JSON.parse(calls[0].init.body as string);
    expect(body).toHaveLength(1);
    expect(body[0].session_key).toBe("new-session");
  });

  // ----- Offset persisted after success -----

  it("should persist offset after successful upload", async () => {
    const config = new ConfigManager(dir);
    await config.save({ token: "pk_persist" });

    const queue = new SessionQueue(dir);
    await queue.appendBatch([makeSessionRecord()]);

    const { fetchFn } = createMockFetch([
      { status: 200, body: { ingested: 1 } },
    ]);

    await executeSessionUpload({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
    });

    // Second upload should find nothing new
    const { fetchFn: fetchFn2, calls: calls2 } = createMockFetch([]);
    const result2 = await executeSessionUpload({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn2,
    });

    expect(result2.uploaded).toBe(0);
    expect(calls2).toHaveLength(0);
  });

  // ----- Pre-dedup before upload -----

  it("should deduplicate records before uploading", async () => {
    const config = new ConfigManager(dir);
    await config.save({ token: "pk_dedup" });

    const queue = new SessionQueue(dir);
    // Two snapshots of the same session — only the latest should be uploaded
    await queue.appendBatch([
      makeSessionRecord({
        session_key: "claude-code|same",
        snapshot_at: "2026-03-09T10:00:00.000Z",
        total_messages: 5,
      }),
      makeSessionRecord({
        session_key: "claude-code|same",
        snapshot_at: "2026-03-09T12:00:00.000Z",
        total_messages: 15,
      }),
    ]);

    const { fetchFn, calls } = createMockFetch([
      { status: 200, body: { ingested: 1 } },
    ]);

    const result = await executeSessionUpload({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
    });

    expect(result.success).toBe(true);
    expect(result.uploaded).toBe(1);

    const body = JSON.parse(calls[0].init.body as string);
    expect(body).toHaveLength(1);
    expect(body[0].total_messages).toBe(15);
    expect(body[0].snapshot_at).toBe("2026-03-09T12:00:00.000Z");
  });

  // ----- Multi-batch -----

  it("should split into multiple batches for many records", async () => {
    const config = new ConfigManager(dir);
    await config.save({ token: "pk_big_batch" });

    const queue = new SessionQueue(dir);
    const records: SessionQueueRecord[] = [];
    for (let i = 0; i < 120; i++) {
      records.push(
        makeSessionRecord({
          session_key: `claude-code|session-${i}`,
          snapshot_at: `2026-03-09T${String(i % 24).padStart(2, "0")}:00:00.000Z`,
        }),
      );
    }
    await queue.appendBatch(records);

    const { fetchFn, calls } = createMockFetch([
      { status: 200, body: { ingested: 50 } },
      { status: 200, body: { ingested: 50 } },
      { status: 200, body: { ingested: 20 } },
    ]);

    const result = await executeSessionUpload({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
    });

    expect(result.success).toBe(true);
    expect(result.uploaded).toBe(120);
    expect(result.batches).toBe(3);
    expect(calls).toHaveLength(3);
  });

  // ----- Error handling: 4xx -----

  it("should fail on 401 without retrying", async () => {
    const config = new ConfigManager(dir);
    await config.save({ token: "pk_bad" });

    const queue = new SessionQueue(dir);
    await queue.appendBatch([makeSessionRecord()]);

    const { fetchFn, calls } = createMockFetch([
      { status: 401, body: { error: "Invalid API key" } },
    ]);

    const result = await executeSessionUpload({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/401/);
    expect(calls).toHaveLength(1); // No retries
  });

  // ----- Error handling: 5xx with retry -----

  it("should retry on 500 and succeed on next attempt", async () => {
    const config = new ConfigManager(dir);
    await config.save({ token: "pk_retry" });

    const queue = new SessionQueue(dir);
    await queue.appendBatch([makeSessionRecord()]);

    const { fetchFn } = createMockFetch([
      { status: 500, body: { error: "Internal Server Error" } },
      { status: 200, body: { ingested: 1 } },
    ]);

    const result = await executeSessionUpload({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
      retryDelayMs: 1, // Fast retry for tests
    });

    expect(result.success).toBe(true);
    expect(result.uploaded).toBe(1);
  });

  // ----- Error handling: 429 rate limit -----

  it("should retry on 429 and succeed on next attempt", async () => {
    const config = new ConfigManager(dir);
    await config.save({ token: "pk_rate" });

    const queue = new SessionQueue(dir);
    await queue.appendBatch([makeSessionRecord()]);

    const { fetchFn } = createMockFetch([
      {
        status: 429,
        body: { error: "Too Many Requests" },
        headers: { "Retry-After": "0" },
      },
      { status: 200, body: { ingested: 1 } },
    ]);

    const result = await executeSessionUpload({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
      retryDelayMs: 1,
    });

    expect(result.success).toBe(true);
    expect(result.uploaded).toBe(1);
  });

  // ----- Network error -----

  it("should handle network errors gracefully", async () => {
    const config = new ConfigManager(dir);
    await config.save({ token: "pk_net" });

    const queue = new SessionQueue(dir);
    await queue.appendBatch([makeSessionRecord()]);

    const fetchFn = async (): Promise<Response> => {
      throw new Error("Network error");
    };

    const result = await executeSessionUpload({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Network error/);
  });

  // ----- Progress callback -----

  it("should call progress callback during upload", async () => {
    const config = new ConfigManager(dir);
    await config.save({ token: "pk_progress" });

    const queue = new SessionQueue(dir);
    await queue.appendBatch([makeSessionRecord()]);

    const { fetchFn } = createMockFetch([
      { status: 200, body: { ingested: 1 } },
    ]);

    const events: Array<{ phase: string }> = [];
    await executeSessionUpload({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
      onProgress: (e) => events.push({ phase: e.phase }),
    });

    expect(events.some((e) => e.phase === "uploading")).toBe(true);
    expect(events.some((e) => e.phase === "done")).toBe(true);
  });
});
