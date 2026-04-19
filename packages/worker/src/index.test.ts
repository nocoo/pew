import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Env, IngestRecord, IngestRequest } from "./index";

// Import the default export (Worker handler) and version constant
import worker, { WORKER_VERSION } from "./index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_RECORD: IngestRecord = {
  source: "claude-code",
  model: "claude-sonnet-4-20250514",
  hour_start: "2026-03-08T10:00:00Z",
  input_tokens: 1000,
  cached_input_tokens: 200,
  output_tokens: 500,
  reasoning_output_tokens: 100,
  total_tokens: 1800,
};

const SECRET = "test-secret-abc123";

function createMockEnv(): Env {
  return {
    DB: {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({}),
      }),
      batch: vi.fn().mockResolvedValue([]),
    } as unknown as D1Database,
    WORKER_SECRET: SECRET,
  };
}

function makeRequest(
  body: unknown,
  options?: { method?: string; secret?: string | null },
): Request {
  const method = options?.method ?? "POST";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const secret = options?.secret === undefined ? SECRET : options.secret;
  if (secret !== null) {
    headers["Authorization"] = `Bearer ${secret}`;
  }
  return new Request("https://pew-ingest.workers.dev/ingest", {
    method,
    headers,
    ...(method !== "GET" ? { body: JSON.stringify(body) } : {}),
  });
}

/** Type-safe JSON parse helper */
async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Worker ingest endpoint", () => {
  let env: Env;

  beforeEach(() => {
    vi.clearAllMocks();
    env = createMockEnv();
  });

  // -----------------------------------------------------------------------
  // Method check
  // -----------------------------------------------------------------------

  describe("method check", () => {
    it("should reject non-POST methods with 405", async () => {
      const req = new Request("https://pew-ingest.workers.dev/ingest", {
        method: "GET",
        headers: { Authorization: `Bearer ${SECRET}` },
      });

      const res = await worker.fetch(req, env);

      expect(res.status).toBe(405);
      const body = await json(res);
      expect(body.error).toContain("Method not allowed");
    });
  });

  // -----------------------------------------------------------------------
  // Auth
  // -----------------------------------------------------------------------

  describe("authentication", () => {
    it("should reject missing Authorization header with 401", async () => {
      const req = makeRequest({ userId: "u1", records: [VALID_RECORD] }, { secret: null });

      const res = await worker.fetch(req, env);

      expect(res.status).toBe(401);
      const body = await json(res);
      expect(body.error).toBe("Unauthorized");
    });

    it("should reject wrong secret with 401", async () => {
      const req = makeRequest(
        { userId: "u1", records: [VALID_RECORD] },
        { secret: "wrong-secret" },
      );

      const res = await worker.fetch(req, env);

      expect(res.status).toBe(401);
      const body = await json(res);
      expect(body.error).toBe("Unauthorized");
    });

    it("should accept correct Bearer secret", async () => {
      const req = makeRequest({ userId: "u1", records: [VALID_RECORD] });

      const res = await worker.fetch(req, env);

      expect(res.status).toBe(200);
    });
  });

  // -----------------------------------------------------------------------
  // Validation
  // -----------------------------------------------------------------------

  describe("validation", () => {
    it("should reject invalid JSON body with 400", async () => {
      const req = new Request("https://pew-ingest.workers.dev/ingest", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SECRET}`,
          "Content-Type": "application/json",
        },
        body: "not json{{{",
      });

      const res = await worker.fetch(req, env);

      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error).toContain("Invalid JSON");
    });

    it("should reject missing userId with 400", async () => {
      const req = makeRequest({ records: [VALID_RECORD] });

      const res = await worker.fetch(req, env);

      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error).toContain("userId");
    });

    it("should reject empty userId with 400", async () => {
      const req = makeRequest({ userId: "", records: [VALID_RECORD] });

      const res = await worker.fetch(req, env);

      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error).toContain("userId");
    });

    it("should reject missing records with 400", async () => {
      const req = makeRequest({ userId: "u1" });

      const res = await worker.fetch(req, env);

      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error).toContain("records");
    });

    it("should reject empty records array with 400", async () => {
      const req = makeRequest({ userId: "u1", records: [] });

      const res = await worker.fetch(req, env);

      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error).toContain("records");
    });

    it("should reject batch exceeding 50 records with 400", async () => {
      const records = Array.from({ length: 51 }, () => ({ ...VALID_RECORD }));
      const req = makeRequest({ userId: "u1", records });

      const res = await worker.fetch(req, env);

      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error).toContain("50");
    });

    it("should reject record with missing string fields", async () => {
      const { source: _, ...noSource } = VALID_RECORD;
      const req = makeRequest({ userId: "u1", records: [noSource] });

      const res = await worker.fetch(req, env);

      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error).toContain("record[0]");
    });

    it("should reject record with non-number token fields", async () => {
      const badRecord = { ...VALID_RECORD, input_tokens: "not-a-number" };
      const req = makeRequest({ userId: "u1", records: [badRecord] });

      const res = await worker.fetch(req, env);

      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error).toContain("input_tokens");
    });
  });

  // -----------------------------------------------------------------------
  // Batch execution
  // -----------------------------------------------------------------------

  describe("batch execution", () => {
    it("should construct prepared statements and call env.DB.batch()", async () => {
      const req = makeRequest({ userId: "u1", records: [VALID_RECORD] });

      const res = await worker.fetch(req, env);

      expect(res.status).toBe(200);

      // prepare() called once per record
      expect(env.DB.prepare).toHaveBeenCalledOnce();
      expect(env.DB.prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO usage_records"));

      // bind() called with correct params
      const bindMock = (env.DB.prepare as ReturnType<typeof vi.fn>).mock.results[0]!.value.bind;
      expect(bindMock).toHaveBeenCalledWith(
        "u1",
        "default",
        VALID_RECORD.source,
        VALID_RECORD.model,
        VALID_RECORD.hour_start,
        VALID_RECORD.input_tokens,
        VALID_RECORD.cached_input_tokens,
        VALID_RECORD.output_tokens,
        VALID_RECORD.reasoning_output_tokens,
        VALID_RECORD.total_tokens,
      );

      // batch() called once with array of prepared statements
      expect(env.DB.batch).toHaveBeenCalledOnce();
      const batchArgs = (env.DB.batch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(batchArgs[0]).toHaveLength(1);
    });

    it("should create one statement per record for multiple records", async () => {
      const records = [
        VALID_RECORD,
        { ...VALID_RECORD, source: "gemini-cli", model: "gemini-2.5-pro" },
        { ...VALID_RECORD, source: "opencode", model: "o3" },
      ];
      const req = makeRequest({ userId: "u1", records });

      const res = await worker.fetch(req, env);

      expect(res.status).toBe(200);

      // prepare() called 3 times (once per record)
      expect(env.DB.prepare).toHaveBeenCalledTimes(3);

      // batch() receives array of 3 statements
      const batchArgs = (env.DB.batch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(batchArgs[0]).toHaveLength(3);
    });

    it("should return { ingested: N } on success", async () => {
      const records = [VALID_RECORD, { ...VALID_RECORD, model: "opus-4" }];
      const req = makeRequest({ userId: "u1", records });

      const res = await worker.fetch(req, env);

      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.ingested).toBe(2);
    });

    it("should return 500 when D1 batch fails", async () => {
      (env.DB.batch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("D1_ERROR: table not found"),
      );

      const req = makeRequest({ userId: "u1", records: [VALID_RECORD] });

      const res = await worker.fetch(req, env);

      expect(res.status).toBe(500);
      const body = await json(res);
      expect(body.error).toBe("Internal server error");
      expect(body.error).not.toContain("table not found");
    });

    it("should handle max batch of 50 records", async () => {
      const records = Array.from({ length: 50 }, (_, i) => ({
        ...VALID_RECORD,
        model: `model-${i}`,
      }));
      const req = makeRequest({ userId: "u1", records });

      const res = await worker.fetch(req, env);

      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.ingested).toBe(50);

      expect(env.DB.prepare).toHaveBeenCalledTimes(50);
      const batchArgs = (env.DB.batch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(batchArgs[0]).toHaveLength(50);
    });
  });
});

// ---------------------------------------------------------------------------
// GET /api/live — health check
// ---------------------------------------------------------------------------

describe("Worker /api/live endpoint", () => {
  let env: Env;

  beforeEach(() => {
    vi.clearAllMocks();
    env = createMockEnv();
  });

  function makeLiveRequest(method = "GET"): Request {
    return new Request("https://pew-ingest.workers.dev/api/live", { method });
  }

  // -----------------------------------------------------------------------
  // Healthy
  // -----------------------------------------------------------------------

  it("should return 200 with status ok when DB is reachable", async () => {
    const firstMock = vi.fn().mockResolvedValue({ 1: 1 });
    (env.DB.prepare as ReturnType<typeof vi.fn>).mockReturnValue({
      bind: vi.fn().mockReturnValue({}),
      first: firstMock,
    });

    const res = await worker.fetch(makeLiveRequest(), env);
    expect(res.status).toBe(200);

    const body = await json(res);
    expect(body.status).toBe("ok");
    expect(body.version).toBe(WORKER_VERSION);
    expect(body.component).toBe("pew-ingest");
    expect(typeof body.uptime).toBe("number");
    expect(typeof body.timestamp).toBe("string");

    const database = body.database as Record<string, unknown>;
    expect(database.connected).toBe(true);
  });

  it("should include correct response headers (no-cache)", async () => {
    const firstMock = vi.fn().mockResolvedValue({ 1: 1 });
    (env.DB.prepare as ReturnType<typeof vi.fn>).mockReturnValue({
      bind: vi.fn().mockReturnValue({}),
      first: firstMock,
    });

    const res = await worker.fetch(makeLiveRequest(), env);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("should call D1 with SELECT 1 AS probe for lightweight check", async () => {
    const firstMock = vi.fn().mockResolvedValue({ 1: 1 });
    (env.DB.prepare as ReturnType<typeof vi.fn>).mockReturnValue({
      bind: vi.fn().mockReturnValue({}),
      first: firstMock,
    });

    await worker.fetch(makeLiveRequest(), env);
    expect(env.DB.prepare).toHaveBeenCalledWith("SELECT 1 AS probe");
  });

  // -----------------------------------------------------------------------
  // DB failure
  // -----------------------------------------------------------------------

  it("should return 503 with status error when DB is unreachable", async () => {
    (env.DB.prepare as ReturnType<typeof vi.fn>).mockReturnValue({
      bind: vi.fn().mockReturnValue({}),
      first: vi.fn().mockRejectedValue(new Error("D1 connection refused")),
    });

    const res = await worker.fetch(makeLiveRequest(), env);
    expect(res.status).toBe(503);

    const body = await json(res);
    expect(body.status).toBe("error");
    expect(body.version).toBe(WORKER_VERSION);

    const database = body.database as Record<string, unknown>;
    expect(database.connected).toBe(false);
    expect(typeof database.error).toBe("string");
  });

  it("should not contain 'ok' in error response values", async () => {
    (env.DB.prepare as ReturnType<typeof vi.fn>).mockReturnValue({
      bind: vi.fn().mockReturnValue({}),
      first: vi.fn().mockRejectedValue(new Error("token is not ok")),
    });

    const res = await worker.fetch(makeLiveRequest(), env);
    const body = await json(res);
    expect(body.status).toBe("error");

    const database = body.database as Record<string, unknown>;
    expect(database.error).not.toMatch(/\bok\b/i);
  });

  it("should sanitize ok from D1 error messages", async () => {
    (env.DB.prepare as ReturnType<typeof vi.fn>).mockReturnValue({
      bind: vi.fn().mockReturnValue({}),
      first: vi.fn().mockRejectedValue(new Error("ok something failed")),
    });

    const res = await worker.fetch(makeLiveRequest(), env);
    const body = await json(res);
    const database = body.database as Record<string, unknown>;
    expect(database.error).toBe("Internal server error");
    expect(database.error).not.toMatch(/\bok\b/i);
  });

  it("should handle non-Error throw from D1", async () => {
    (env.DB.prepare as ReturnType<typeof vi.fn>).mockReturnValue({
      bind: vi.fn().mockReturnValue({}),
      first: vi.fn().mockRejectedValue("string error"),
    });

    const res = await worker.fetch(makeLiveRequest(), env);
    expect(res.status).toBe(503);

    const body = await json(res);
    const database = body.database as Record<string, unknown>;
    expect(database.connected).toBe(false);
    expect(database.error).toBe("Internal server error");
  });

  // -----------------------------------------------------------------------
  // No auth required
  // -----------------------------------------------------------------------

  it("should not require authentication", async () => {
    const firstMock = vi.fn().mockResolvedValue({ 1: 1 });
    (env.DB.prepare as ReturnType<typeof vi.fn>).mockReturnValue({
      bind: vi.fn().mockReturnValue({}),
      first: firstMock,
    });

    // No Authorization header
    const req = new Request("https://pew-ingest.workers.dev/api/live", {
      method: "GET",
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
  });

  // -----------------------------------------------------------------------
  // Method guard
  // -----------------------------------------------------------------------

  it("should reject POST to /api/live with 405", async () => {
    const res = await worker.fetch(makeLiveRequest("POST"), env);
    expect(res.status).toBe(405);
  });

  // -----------------------------------------------------------------------
  // Response shape
  // -----------------------------------------------------------------------

  it("should return all required fields in healthy response", async () => {
    const firstMock = vi.fn().mockResolvedValue({ 1: 1 });
    (env.DB.prepare as ReturnType<typeof vi.fn>).mockReturnValue({
      bind: vi.fn().mockReturnValue({}),
      first: firstMock,
    });

    const res = await worker.fetch(makeLiveRequest(), env);
    const body = await json(res);
    const keys = Object.keys(body).sort();
    expect(keys).toEqual(["component", "database", "status", "timestamp", "uptime", "version"]);
  });

  it("should return all required fields in error response", async () => {
    (env.DB.prepare as ReturnType<typeof vi.fn>).mockReturnValue({
      bind: vi.fn().mockReturnValue({}),
      first: vi.fn().mockRejectedValue(new Error("boom")),
    });

    const res = await worker.fetch(makeLiveRequest(), env);
    const body = await json(res);
    const keys = Object.keys(body).sort();
    expect(keys).toEqual(["component", "database", "status", "timestamp", "uptime", "version"]);
  });

  it("should return valid ISO 8601 timestamp", async () => {
    const firstMock = vi.fn().mockResolvedValue({ 1: 1 });
    (env.DB.prepare as ReturnType<typeof vi.fn>).mockReturnValue({
      bind: vi.fn().mockReturnValue({}),
      first: firstMock,
    });

    const res = await worker.fetch(makeLiveRequest(), env);
    const body = await json(res);
    const ts = new Date(body.timestamp as string);
    expect(ts.toISOString()).toBe(body.timestamp);
  });

  // -----------------------------------------------------------------------
  // Existing ingest routes still work
  // -----------------------------------------------------------------------

  it("should still require auth for ingest routes", async () => {
    const req = new Request("https://pew-ingest.workers.dev/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "u1", records: [VALID_RECORD] }),
    });

    const res = await worker.fetch(req, env);
    expect(res.status).toBe(401);
  });

  it("should still reject GET on ingest routes", async () => {
    const req = new Request("https://pew-ingest.workers.dev/ingest", {
      method: "GET",
      headers: { Authorization: `Bearer ${SECRET}` },
    });

    const res = await worker.fetch(req, env);
    expect(res.status).toBe(405);
  });
});
