import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Env } from "./index";

// Import the default export (Worker handler)
import worker from "./index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_SESSION_RECORD = {
  session_key: "claude-code:abc123",
  source: "claude-code",
  kind: "human" as const,
  started_at: "2026-03-08T10:00:00Z",
  last_message_at: "2026-03-08T10:30:00Z",
  duration_seconds: 1800,
  user_messages: 12,
  assistant_messages: 10,
  total_messages: 25,
  project_ref: "a1b2c3",
  model: "claude-sonnet-4-20250514",
  snapshot_at: "2026-03-08T11:00:00Z",
};

const VALID_TOKEN_RECORD = {
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
  path: string,
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
  return new Request(`https://pew-ingest.workers.dev${path}`, {
    method,
    headers,
    ...(method !== "GET" ? { body: JSON.stringify(body) } : {}),
  });
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Worker session ingest endpoint", () => {
  let env: Env;

  beforeEach(() => {
    vi.clearAllMocks();
    env = createMockEnv();
  });

  // -----------------------------------------------------------------------
  // Path routing
  // -----------------------------------------------------------------------

  describe("path routing", () => {
    it("should handle POST /ingest/sessions", async () => {
      const req = makeRequest("/ingest/sessions", {
        userId: "u1",
        records: [VALID_SESSION_RECORD],
      });

      const res = await worker.fetch(req, env);

      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.ingested).toBe(1);
    });

    it("should still handle POST /ingest/tokens for token records", async () => {
      const req = makeRequest("/ingest/tokens", {
        userId: "u1",
        records: [VALID_TOKEN_RECORD],
      });

      const res = await worker.fetch(req, env);

      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.ingested).toBe(1);
    });

    it("should handle legacy root POST for backward compat (tokens)", async () => {
      const req = makeRequest("/ingest", {
        userId: "u1",
        records: [VALID_TOKEN_RECORD],
      });

      const res = await worker.fetch(req, env);

      expect(res.status).toBe(200);
    });

    it("should return 404 for unknown paths", async () => {
      const req = makeRequest("/ingest/unknown", {
        userId: "u1",
        records: [VALID_SESSION_RECORD],
      });

      const res = await worker.fetch(req, env);

      expect(res.status).toBe(404);
      const body = await json(res);
      expect(body.error).toContain("Not found");
    });
  });

  // -----------------------------------------------------------------------
  // Session validation
  // -----------------------------------------------------------------------

  describe("session validation", () => {
    it("should reject missing userId with 400", async () => {
      const req = makeRequest("/ingest/sessions", {
        records: [VALID_SESSION_RECORD],
      });

      const res = await worker.fetch(req, env);

      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error).toContain("userId");
    });

    it("should reject empty records array with 400", async () => {
      const req = makeRequest("/ingest/sessions", {
        userId: "u1",
        records: [],
      });

      const res = await worker.fetch(req, env);

      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error).toContain("records");
    });

    it("should reject batch exceeding 50 session records with 400", async () => {
      const records = Array.from({ length: 51 }, () => ({
        ...VALID_SESSION_RECORD,
      }));
      const req = makeRequest("/ingest/sessions", {
        userId: "u1",
        records,
      });

      const res = await worker.fetch(req, env);

      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error).toContain("50");
    });

    it("should reject session record missing session_key", async () => {
      const { session_key: _, ...noKey } = VALID_SESSION_RECORD;
      const req = makeRequest("/ingest/sessions", {
        userId: "u1",
        records: [noKey],
      });

      const res = await worker.fetch(req, env);

      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error).toContain("session_key");
    });

    it("should reject session record missing source", async () => {
      const { source: _, ...noSource } = VALID_SESSION_RECORD;
      const req = makeRequest("/ingest/sessions", {
        userId: "u1",
        records: [noSource],
      });

      const res = await worker.fetch(req, env);

      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error).toContain("source");
    });

    it("should reject session record with non-number duration_seconds", async () => {
      const badRecord = {
        ...VALID_SESSION_RECORD,
        duration_seconds: "not-a-number",
      };
      const req = makeRequest("/ingest/sessions", {
        userId: "u1",
        records: [badRecord],
      });

      const res = await worker.fetch(req, env);

      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error).toContain("duration_seconds");
    });

    it("should accept session record with null project_ref", async () => {
      const record = { ...VALID_SESSION_RECORD, project_ref: null };
      const req = makeRequest("/ingest/sessions", {
        userId: "u1",
        records: [record],
      });

      const res = await worker.fetch(req, env);

      expect(res.status).toBe(200);
    });

    it("should accept session record with null model", async () => {
      const record = { ...VALID_SESSION_RECORD, model: null };
      const req = makeRequest("/ingest/sessions", {
        userId: "u1",
        records: [record],
      });

      const res = await worker.fetch(req, env);

      expect(res.status).toBe(200);
    });
  });

  // -----------------------------------------------------------------------
  // Session batch execution
  // -----------------------------------------------------------------------

  describe("session batch execution", () => {
    it("should use session upsert SQL with INSERT INTO session_records", async () => {
      const req = makeRequest("/ingest/sessions", {
        userId: "u1",
        records: [VALID_SESSION_RECORD],
      });

      const res = await worker.fetch(req, env);

      expect(res.status).toBe(200);
      expect(env.DB.prepare).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO session_records"),
      );
    });

    it("should bind correct session params in order", async () => {
      const req = makeRequest("/ingest/sessions", {
        userId: "u1",
        records: [VALID_SESSION_RECORD],
      });

      await worker.fetch(req, env);

      const bindMock = (env.DB.prepare as ReturnType<typeof vi.fn>).mock
        .results[0]!.value.bind;
      expect(bindMock).toHaveBeenCalledWith(
        "u1",
        VALID_SESSION_RECORD.session_key,
        VALID_SESSION_RECORD.source,
        VALID_SESSION_RECORD.kind,
        VALID_SESSION_RECORD.started_at,
        VALID_SESSION_RECORD.last_message_at,
        VALID_SESSION_RECORD.duration_seconds,
        VALID_SESSION_RECORD.user_messages,
        VALID_SESSION_RECORD.assistant_messages,
        VALID_SESSION_RECORD.total_messages,
        VALID_SESSION_RECORD.project_ref,
        VALID_SESSION_RECORD.model,
        VALID_SESSION_RECORD.snapshot_at,
      );
    });

    it("should create one statement per session record", async () => {
      const records = [
        VALID_SESSION_RECORD,
        { ...VALID_SESSION_RECORD, session_key: "gemini-cli:def456" },
        { ...VALID_SESSION_RECORD, session_key: "opencode:ghi789" },
      ];
      const req = makeRequest("/ingest/sessions", {
        userId: "u1",
        records,
      });

      const res = await worker.fetch(req, env);

      expect(res.status).toBe(200);
      expect(env.DB.prepare).toHaveBeenCalledTimes(3);

      const batchArgs = (env.DB.batch as ReturnType<typeof vi.fn>).mock
        .calls[0]!;
      expect(batchArgs[0]).toHaveLength(3);
    });

    it("should return { ingested: N } on success", async () => {
      const records = [
        VALID_SESSION_RECORD,
        { ...VALID_SESSION_RECORD, session_key: "gemini-cli:x" },
      ];
      const req = makeRequest("/ingest/sessions", {
        userId: "u1",
        records,
      });

      const res = await worker.fetch(req, env);

      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.ingested).toBe(2);
    });

    it("should include monotonic WHERE clause in upsert SQL", async () => {
      const req = makeRequest("/ingest/sessions", {
        userId: "u1",
        records: [VALID_SESSION_RECORD],
      });

      await worker.fetch(req, env);

      expect(env.DB.prepare).toHaveBeenCalledWith(
        expect.stringContaining("excluded.snapshot_at >= session_records.snapshot_at"),
      );
    });

    it("should return 500 when D1 batch fails", async () => {
      (env.DB.batch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("D1_ERROR: table not found"),
      );

      const req = makeRequest("/ingest/sessions", {
        userId: "u1",
        records: [VALID_SESSION_RECORD],
      });

      const res = await worker.fetch(req, env);

      expect(res.status).toBe(500);
      const body = await json(res);
      expect(body.error).toBe("Internal server error");
    });
  });
});
