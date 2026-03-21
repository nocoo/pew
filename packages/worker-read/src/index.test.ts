import { describe, it, expect, vi, beforeEach } from "vitest";
import worker from "./index";
import type { Env } from "./index";
import { WORKER_VERSION } from "./index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SECRET = "test-read-secret";

function createEnv(overrides?: Partial<Env>): Env {
  return {
    DB: createMockDB(),
    WORKER_READ_SECRET: SECRET,
    ...overrides,
  };
}

function createMockDB() {
  const first = vi.fn().mockResolvedValue({ "1": 1 });
  const all = vi.fn().mockResolvedValue({
    results: [],
    meta: { changes: 0, duration: 0.5 },
  });
  const bind = vi.fn().mockReturnValue({ all, first });
  const prepare = vi.fn().mockReturnValue({ bind, all, first });
  return { prepare } as unknown as D1Database;
}

function makeRequest(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Request {
  const url = `https://pew.test.workers.dev${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token !== undefined) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return new Request(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/**
 * Type-safe wrapper around worker.fetch!().
 *
 * `new Request()` produces `Request<unknown, CfProperties>` but
 * `ExportedHandler.fetch()` expects `IncomingRequestCfProperties`.
 * In production Cloudflare fills the cf properties; in tests we cast.
 */
async function callWorker(req: Request, env: Env): Promise<Response> {
  return worker.fetch!(
    req as unknown as Request<unknown, IncomingRequestCfProperties>,
    env,
    {} as ExecutionContext,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("pew read Worker", () => {
  let env: Env;

  beforeEach(() => {
    vi.clearAllMocks();
    env = createEnv();
  });

  // -----------------------------------------------------------------------
  // GET /live
  // -----------------------------------------------------------------------

  describe("GET /live", () => {
    it("should return 200 with version and DB status when healthy", async () => {
      const res = await callWorker(makeRequest("GET", "/live"), env);
      expect(res.status).toBe(200);

      const body = await res.json() as Record<string, unknown>;
      expect(body.status).toBe("ok");
      expect(body.version).toBe(WORKER_VERSION);
      expect(body.db).toEqual(
        expect.objectContaining({ connected: true }),
      );
      expect(body.timestamp).toBeDefined();
      expect(typeof body.uptime).toBe("number");
    });

    it("should return 503 when DB is down", async () => {
      const badDB = {
        prepare: vi.fn().mockReturnValue({
          first: vi.fn().mockRejectedValue(new Error("DB unavailable")),
        }),
      } as unknown as D1Database;
      const badEnv = createEnv({ DB: badDB });

      const res = await callWorker(makeRequest("GET", "/live"), badEnv);
      expect(res.status).toBe(503);

      const body = await res.json() as Record<string, unknown>;
      expect(body.status).toBe("error");
      expect((body.db as Record<string, unknown>).connected).toBe(false);
      expect((body.db as Record<string, unknown>).error).toBe("DB unavailable");
    });

    it("should skip auth for /live", async () => {
      // No Authorization header
      const req = new Request("https://pew.test.workers.dev/live", {
        method: "GET",
      });
      const res = await callWorker(req, env);
      expect(res.status).toBe(200);
    });

    it("should return 405 for non-GET on /live", async () => {
      const res = await callWorker(makeRequest("POST", "/live"), env);
      expect(res.status).toBe(405);
    });
  });

  // -----------------------------------------------------------------------
  // Auth
  // -----------------------------------------------------------------------

  describe("auth", () => {
    it("should return 401 when Authorization header is missing", async () => {
      const req = new Request("https://pew.test.workers.dev/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: "SELECT 1" }),
      });

      const res = await callWorker(req, env);
      expect(res.status).toBe(401);
      const body = await res.json() as Record<string, unknown>;
      expect(body.error).toBe("Unauthorized");
    });

    it("should return 401 when token is wrong", async () => {
      const res = await callWorker(
        makeRequest("POST", "/query", { sql: "SELECT 1" }, "wrong-token"),
        env,
      );
      expect(res.status).toBe(401);
    });

    it("should pass auth with correct token", async () => {
      const res = await callWorker(
        makeRequest("POST", "/query", { sql: "SELECT 1" }, SECRET),
        env,
      );
      expect(res.status).toBe(200);
    });
  });

  // -----------------------------------------------------------------------
  // POST /query
  // -----------------------------------------------------------------------

  describe("POST /query", () => {
    it("should return results and meta for valid SELECT", async () => {
      const mockResults = [
        { source: "claude-code", total_tokens: 42000 },
        { source: "opencode", total_tokens: 15000 },
      ];
      const mockMeta = { changes: 0, duration: 1.2, rows_read: 150 };

      const db = createMockDB();
      (db.prepare("").all as ReturnType<typeof vi.fn>).mockResolvedValue({
        results: mockResults,
        meta: mockMeta,
      });
      // Make prepare always return same mock chain
      (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue({
        bind: vi.fn().mockReturnValue({
          all: vi.fn().mockResolvedValue({ results: mockResults, meta: mockMeta }),
        }),
        all: vi.fn().mockResolvedValue({ results: mockResults, meta: mockMeta }),
      });
      const testEnv = createEnv({ DB: db });

      const res = await callWorker(
        makeRequest("POST", "/query", { sql: "SELECT * FROM usage_records" }, SECRET),
        testEnv,
      );

      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.results).toEqual(mockResults);
      expect(body.meta).toEqual(mockMeta);
    });

    it("should bind params correctly", async () => {
      const db = createMockDB();
      const mockBind = vi.fn().mockReturnValue({
        all: vi.fn().mockResolvedValue({
          results: [],
          meta: { changes: 0, duration: 0.5 },
        }),
      });
      (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue({
        bind: mockBind,
        all: vi.fn(),
      });
      const testEnv = createEnv({ DB: db });

      await callWorker(
        makeRequest(
          "POST",
          "/query",
          { sql: "SELECT * FROM users WHERE id = ?", params: ["usr_abc"] },
          SECRET,
        ),
        testEnv,
      );

      expect(mockBind).toHaveBeenCalledWith("usr_abc");
    });

    it("should work with empty params array", async () => {
      const res = await callWorker(
        makeRequest("POST", "/query", { sql: "SELECT 1", params: [] }, SECRET),
        env,
      );
      expect(res.status).toBe(200);
    });

    it("should return 400 for missing sql", async () => {
      const res = await callWorker(
        makeRequest("POST", "/query", { params: [] }, SECRET),
        env,
      );
      expect(res.status).toBe(400);
      const body = await res.json() as Record<string, unknown>;
      expect(body.error).toContain("sql");
    });

    it("should return 400 for empty sql", async () => {
      const res = await callWorker(
        makeRequest("POST", "/query", { sql: "  " }, SECRET),
        env,
      );
      expect(res.status).toBe(400);
    });

    it("should return 400 for non-string sql", async () => {
      const res = await callWorker(
        makeRequest("POST", "/query", { sql: 123 }, SECRET),
        env,
      );
      expect(res.status).toBe(400);
    });

    it("should return 400 for invalid request body", async () => {
      const req = new Request("https://pew.test.workers.dev/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SECRET}`,
        },
        body: "not-json",
      });
      const res = await callWorker(req, env);
      expect(res.status).toBe(400);
      const body = await res.json() as Record<string, unknown>;
      expect(body.error).toContain("JSON");
    });

    // Write statement rejection
    it("should reject INSERT → 403", async () => {
      const res = await callWorker(
        makeRequest("POST", "/query", { sql: "INSERT INTO users (id) VALUES (?)" }, SECRET),
        env,
      );
      expect(res.status).toBe(403);
      const body = await res.json() as Record<string, unknown>;
      expect(body.error).toContain("Write");
    });

    it("should reject UPDATE → 403", async () => {
      const res = await callWorker(
        makeRequest("POST", "/query", { sql: "UPDATE users SET name = ?" }, SECRET),
        env,
      );
      expect(res.status).toBe(403);
    });

    it("should reject DELETE → 403", async () => {
      const res = await callWorker(
        makeRequest("POST", "/query", { sql: "DELETE FROM users WHERE id = ?" }, SECRET),
        env,
      );
      expect(res.status).toBe(403);
    });

    it("should reject DROP → 403", async () => {
      const res = await callWorker(
        makeRequest("POST", "/query", { sql: "DROP TABLE users" }, SECRET),
        env,
      );
      expect(res.status).toBe(403);
    });

    it("should reject ALTER → 403", async () => {
      const res = await callWorker(
        makeRequest("POST", "/query", { sql: "ALTER TABLE users ADD COLUMN foo TEXT" }, SECRET),
        env,
      );
      expect(res.status).toBe(403);
    });

    it("should reject CREATE → 403", async () => {
      const res = await callWorker(
        makeRequest("POST", "/query", { sql: "CREATE TABLE evil (id TEXT)" }, SECRET),
        env,
      );
      expect(res.status).toBe(403);
    });

    it("should reject PRAGMA → 403", async () => {
      const res = await callWorker(
        makeRequest("POST", "/query", { sql: "PRAGMA table_info(users)" }, SECRET),
        env,
      );
      expect(res.status).toBe(403);
    });

    it("should return 500 on D1 error", async () => {
      const db = {
        prepare: vi.fn().mockReturnValue({
          all: vi.fn().mockRejectedValue(new Error("SQLITE_ERROR: no such table")),
          bind: vi.fn().mockReturnValue({
            all: vi.fn().mockRejectedValue(new Error("SQLITE_ERROR: no such table")),
          }),
        }),
      } as unknown as D1Database;
      const errEnv = createEnv({ DB: db });

      const res = await callWorker(
        makeRequest("POST", "/query", { sql: "SELECT * FROM nonexistent" }, SECRET),
        errEnv,
      );
      expect(res.status).toBe(500);
      const body = await res.json() as Record<string, unknown>;
      expect(body.error).toContain("D1 query failed");
    });
  });

  // -----------------------------------------------------------------------
  // Router
  // -----------------------------------------------------------------------

  describe("router", () => {
    it("should return 404 for unknown path", async () => {
      const res = await callWorker(
        makeRequest("GET", "/unknown", undefined, SECRET),
        env,
      );
      expect(res.status).toBe(404);
    });

    it("should return 405 for GET on /query", async () => {
      const res = await callWorker(
        makeRequest("GET", "/query", undefined, SECRET),
        env,
      );
      expect(res.status).toBe(405);
    });
  });
});
