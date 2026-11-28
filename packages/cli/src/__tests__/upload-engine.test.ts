import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_HOST } from "../commands/login.js";
import {
  createUploadEngine,
  type UploadEngineConfig,
  type UploadProgressEvent,
} from "../commands/upload-engine.js";
import { ConfigManager } from "../config/manager.js";
import { BaseQueue } from "../storage/base-queue.js";

interface TestRecord {
  id: number;
  value: number;
}

const makeRecord = (id: number, value = id * 10): TestRecord => ({ id, value });

function createMockFetch(
  responses: Array<{ status: number; body: unknown; headers?: Record<string, string> }>,
) {
  let idx = 0;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(url), init: init ?? {} });
    const resp = responses[idx++] ?? responses[responses.length - 1];
    return new Response(JSON.stringify(resp.body), {
      status: resp.status,
      headers: { "Content-Type": "application/json", ...resp.headers },
    });
  };
  return { fetchFn, calls };
}

function createTestEngine(dir: string, overrides: Partial<UploadEngineConfig<TestRecord>> = {}) {
  const queue = new BaseQueue<TestRecord>(dir, "test.jsonl", "test.state.json");
  const config: UploadEngineConfig<TestRecord> = {
    queue,
    endpoint: "/api/test-ingest",
    entityName: "test records",
    preprocess: (records) => records,
    ...overrides,
  };
  return { queue, config };
}

async function seedToken(dir: string, token = "pk_test", dev = false) {
  await new ConfigManager(dir, dev).save({ token });
}

describe("upload-engine", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pew-upload-engine-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("fails when not logged in and succeeds with 0 records when queue is empty", async () => {
    const { config } = createTestEngine(dir);
    const engine = createUploadEngine(config);
    const noTok = await engine.execute({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: createMockFetch([]).fetchFn,
    });
    expect(noTok).toMatchObject({ success: false, uploaded: 0 });
    expect(noTok.error).toMatch(/not logged in/i);

    await seedToken(dir);
    const { fetchFn, calls } = createMockFetch([]);
    const empty = await engine.execute({ stateDir: dir, apiUrl: DEFAULT_HOST, fetch: fetchFn });
    expect(empty).toMatchObject({ success: true, uploaded: 0, batches: 0 });
    expect(calls).toHaveLength(0);
  });

  it("uploads single/multi batches, persists offset, runs preprocess & onProgress, and reads after saved offset", async () => {
    const { queue, config } = createTestEngine(dir, {
      preprocess: (records) => [...new Map(records.map((r) => [r.id, r])).values()],
    });
    await seedToken(dir);
    await queue.appendBatch([makeRecord(1, 10), makeRecord(1, 20), makeRecord(2, 30)]);

    const events: UploadProgressEvent[] = [];
    const { fetchFn, calls } = createMockFetch([{ status: 200, body: { ingested: 2 } }]);
    const engine = createUploadEngine(config);
    const r1 = await engine.execute({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
      onProgress: (e) => events.push(e),
    });
    expect(r1).toMatchObject({ success: true, uploaded: 2, batches: 1 });
    expect(calls[0]!.url).toBe(`${DEFAULT_HOST}/api/test-ingest`);
    expect(JSON.parse(calls[0]!.init.body as string)).toHaveLength(2);
    expect(events.some((e) => e.phase === "uploading")).toBe(true);
    expect(events.some((e) => e.phase === "done")).toBe(true);

    // Second run: offset persisted -> nothing left
    const { fetchFn: fetch2, calls: calls2 } = createMockFetch([]);
    expect(
      (await engine.execute({ stateDir: dir, apiUrl: DEFAULT_HOST, fetch: fetch2 })).uploaded,
    ).toBe(0);
    expect(calls2).toHaveLength(0);

    // Append 120 more -> 3 batches after saved offset
    await queue.appendBatch(Array.from({ length: 120 }, (_, i) => makeRecord(i + 10)));
    const { fetchFn: fetch3, calls: calls3 } = createMockFetch([
      { status: 200, body: { ingested: 50 } },
      { status: 200, body: { ingested: 50 } },
      { status: 200, body: { ingested: 20 } },
    ]);
    const r3 = await engine.execute({ stateDir: dir, apiUrl: DEFAULT_HOST, fetch: fetch3 });
    expect(r3).toMatchObject({ success: true, uploaded: 120, batches: 3 });
    expect(calls3).toHaveLength(3);
  });

  it.each([
    {
      label: "401 without retry",
      responses: [{ status: 401, body: { error: "Unauthorized" } }],
      maxRetries: 2,
      expectedCalls: 1,
      match: /401/,
    },
    {
      label: "4xx fallback error message",
      responses: [{ status: 400, body: {} }],
      maxRetries: 0,
      expectedCalls: 1,
      match: /HTTP 400/,
    },
    {
      label: "500 max retries exhausted",
      responses: [{ status: 500, body: { error: "Server Error" } }],
      maxRetries: 2,
      expectedCalls: 3,
      match: /retry|failed/i,
    },
    {
      label: "429 max retries exhausted",
      responses: [{ status: 429, body: { error: "Too Many Requests" } }],
      maxRetries: 2,
      expectedCalls: 3,
      match: /429|rate.?limit|too many|retry|failed/i,
    },
    {
      label: "429 fallback error message",
      responses: [{ status: 429, body: {} }],
      maxRetries: 2,
      expectedCalls: 3,
      match: /Too Many Requests/,
    },
  ])("handles failure: $label", async ({ responses, maxRetries, expectedCalls, match }) => {
    const { queue, config } = createTestEngine(dir);
    await seedToken(dir);
    await queue.append(makeRecord(1));
    const { fetchFn, calls } = createMockFetch(responses);
    const result = await createUploadEngine(config).execute({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
      maxRetries,
      retryDelayMs: 0,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(match);
    expect(calls).toHaveLength(expectedCalls);
  });

  it("retries on 500 and 429 (single Retry-After sleep) and succeeds, and handles network errors", async () => {
    const { queue, config } = createTestEngine(dir);
    await seedToken(dir);
    await queue.append(makeRecord(1));

    const engine = createUploadEngine(config);
    const mock500 = createMockFetch([
      { status: 500, body: { error: "Err" } },
      { status: 200, body: { ingested: 1 } },
    ]);
    expect(
      await engine.execute({
        stateDir: dir,
        apiUrl: DEFAULT_HOST,
        fetch: mock500.fetchFn,
        retryDelayMs: 0,
      }),
    ).toMatchObject({ success: true, uploaded: 1 });
    expect(mock500.calls).toHaveLength(2);

    await queue.append(makeRecord(2));
    const mock429 = createMockFetch([
      { status: 429, body: { error: "Too Many Requests" }, headers: { "Retry-After": "0" } },
      { status: 200, body: { ingested: 1 } },
    ]);
    expect(
      await engine.execute({
        stateDir: dir,
        apiUrl: DEFAULT_HOST,
        fetch: mock429.fetchFn,
        retryDelayMs: 1,
        maxRetries: 2,
      }),
    ).toMatchObject({ success: true, uploaded: 1 });
    expect(mock429.calls).toHaveLength(2);

    await queue.append(makeRecord(3));
    const netErr = await engine.execute({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: async () => {
        throw new Error("ECONNREFUSED");
      },
      maxRetries: 0,
    });
    expect(netErr.success).toBe(false);
    expect(netErr.error).toMatch(/ECONNREFUSED/);
  });

  it("does not save partial offset on multi-batch failure", async () => {
    const { queue, config } = createTestEngine(dir);
    await seedToken(dir);
    await queue.appendBatch(Array.from({ length: 120 }, (_, i) => makeRecord(i)));

    const { fetchFn } = createMockFetch([
      { status: 200, body: { ingested: 50 } },
      { status: 500, body: { error: "Server Error" } },
    ]);
    const res = await createUploadEngine(config).execute({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: fetchFn,
      maxRetries: 2,
      retryDelayMs: 0,
    });
    expect(res).toMatchObject({ success: false, uploaded: 50 });
    expect(await queue.loadOffset()).toBe(0);
  });

  it("uses dev config when dev=true and sends X-Pew-Client-Version only when provided", async () => {
    const { queue, config } = createTestEngine(dir);
    await seedToken(dir, "pk_dev_token", true);
    await seedToken(dir, "pk_prod_token", false);
    await queue.append(makeRecord(1));

    const m1 = createMockFetch([{ status: 200, body: { ingested: 1 } }]);
    await createUploadEngine(config).execute({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: m1.fetchFn,
      dev: true,
      clientVersion: "1.6.0",
    });
    expect(m1.calls[0]!.init.headers).toMatchObject({
      Authorization: "Bearer pk_dev_token",
      "X-Pew-Client-Version": "1.6.0",
    });

    await queue.append(makeRecord(2));
    const m2 = createMockFetch([{ status: 200, body: { ingested: 1 } }]);
    await createUploadEngine(config).execute({
      stateDir: dir,
      apiUrl: DEFAULT_HOST,
      fetch: m2.fetchFn,
    });
    expect(
      (m2.calls[0]!.init.headers as Record<string, string>)["X-Pew-Client-Version"],
    ).toBeUndefined();
  });

  it.each([
    {
      label: "all-corrupt lines",
      content: "NOT_JSON_LINE_1\n{broken json\ngarbage!!!\n",
      expectedUploaded: 0,
      expectedCalls: 0,
    },
    {
      label: "mixed corrupt and valid lines",
      content: `NOT_VALID\n${JSON.stringify(makeRecord(1))}\n{broken\n${JSON.stringify(makeRecord(2))}\n`,
      expectedUploaded: 2,
      expectedCalls: 1,
    },
  ])(
    "advances offset past $label without re-reading",
    async ({ content, expectedUploaded, expectedCalls }) => {
      const { queue, config } = createTestEngine(dir);
      await seedToken(dir);
      await writeFile(queue.queuePath, content);

      const m1 = createMockFetch(
        expectedCalls ? [{ status: 200, body: { ingested: expectedUploaded } }] : [],
      );
      const engine = createUploadEngine(config);
      expect(
        await engine.execute({ stateDir: dir, apiUrl: DEFAULT_HOST, fetch: m1.fetchFn }),
      ).toMatchObject({ success: true, uploaded: expectedUploaded });
      expect(m1.calls).toHaveLength(expectedCalls);
      expect(await queue.loadOffset()).toBe(Buffer.byteLength(content));

      const m2 = createMockFetch([]);
      expect(
        await engine.execute({ stateDir: dir, apiUrl: DEFAULT_HOST, fetch: m2.fetchFn }),
      ).toMatchObject({ success: true, uploaded: 0 });
      expect(m2.calls).toHaveLength(0);
    },
  );

  describe("dirty-keys filtering", () => {
    const dirtyEngine = () => createTestEngine(dir, { recordKey: (r) => `key-${r.id}` });

    it("uploads only dirtyKeys from offset 0, clears dirtyKeys on success, and skips empty/unmatched", async () => {
      const { queue, config } = dirtyEngine();
      await seedToken(dir);
      await queue.appendBatch([makeRecord(1), makeRecord(2), makeRecord(3), makeRecord(4)]);
      const { newOffset } = await queue.readFromOffset(0);
      await queue.saveOffset(newOffset); // offset at EOF — dirtyKeys must override it

      // 1) Empty dirtyKeys -> skip
      await queue.saveDirtyKeys([]);
      const mEmpty = createMockFetch([]);
      const engine = createUploadEngine(config);
      expect(
        await engine.execute({ stateDir: dir, apiUrl: DEFAULT_HOST, fetch: mEmpty.fetchFn }),
      ).toMatchObject({ success: true, uploaded: 0, batches: 0 });
      expect(mEmpty.calls).toHaveLength(0);

      // 2) Matching dirtyKeys -> uploads only matching and clears to []
      await queue.saveDirtyKeys(["key-2", "key-4"]);
      const mMatch = createMockFetch([{ status: 200, body: { ingested: 2 } }]);
      expect(
        await engine.execute({ stateDir: dir, apiUrl: DEFAULT_HOST, fetch: mMatch.fetchFn }),
      ).toMatchObject({ success: true, uploaded: 2 });
      expect(
        (JSON.parse(mMatch.calls[0]!.init.body as string) as TestRecord[]).map((r) => r.id).sort(),
      ).toEqual([2, 4]);
      expect(await queue.loadDirtyKeys()).toEqual([]);

      // 3) Unmatched dirtyKeys -> 0 uploaded, cleared to []
      await queue.saveDirtyKeys(["key-999"]);
      const mMiss = createMockFetch([]);
      expect(
        await engine.execute({ stateDir: dir, apiUrl: DEFAULT_HOST, fetch: mMiss.fetchFn }),
      ).toMatchObject({ success: true, uploaded: 0 });
      expect(mMiss.calls).toHaveLength(0);
      expect(await queue.loadDirtyKeys()).toEqual([]);
    });

    it("preserves dirtyKeys on failure and falls back to offset when dirtyKeys is undefined", async () => {
      const { queue, config } = dirtyEngine();
      await seedToken(dir);
      await queue.append(makeRecord(1));
      const { newOffset } = await queue.readFromOffset(0);
      await queue.saveOffset(newOffset);
      await queue.append(makeRecord(2));

      // dirtyKeys undefined -> legacy offset mode uploads only record 2
      const mLegacy = createMockFetch([{ status: 200, body: { ingested: 1 } }]);
      const engine = createUploadEngine(config);
      expect(
        await engine.execute({ stateDir: dir, apiUrl: DEFAULT_HOST, fetch: mLegacy.fetchFn }),
      ).toMatchObject({ success: true, uploaded: 1 });
      expect(
        (JSON.parse(mLegacy.calls[0]!.init.body as string) as TestRecord[]).map((r) => r.id),
      ).toEqual([2]);

      // Failure keeps dirtyKeys intact
      await queue.saveDirtyKeys(["key-1", "key-2"]);
      const mFail = createMockFetch([{ status: 500, body: { error: "Err" } }]);
      expect(
        (
          await engine.execute({
            stateDir: dir,
            apiUrl: DEFAULT_HOST,
            fetch: mFail.fetchFn,
            maxRetries: 2,
            retryDelayMs: 0,
          })
        ).success,
      ).toBe(false);
      expect(await queue.loadDirtyKeys()).toEqual(["key-1", "key-2"]);
    });
  });
});
