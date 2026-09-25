import { describe, it, expect, vi, beforeEach } from "vitest";
import worker from "./index";
import type { Env } from "./index";
import { WORKER_VERSION } from "./index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SECRET = "test-read-secret";

function createMockKV(): KVNamespace {
  return {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ keys: [], list_complete: true }),
    getWithMetadata: vi.fn().mockResolvedValue({ value: null, metadata: null }),
  } as unknown as KVNamespace;
}

function createEnv(overrides?: Partial<Env>): Env {
  return {
    DB: createMockDB(),
    CACHE: createMockKV(),
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
    headers.Authorization = `Bearer ${token}`;
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

  it.each([undefined, null, "", "   "])("rejects an unconfigured secret (%s) before touching bindings", async (secret) => {
    Object.assign(env, { WORKER_READ_SECRET: secret });
    const res = await callWorker(makeRequest("POST", "/api/rpc", {
      method: "users.getById", id: "dummy-private-user",
    }, String(secret)), env);
    expect(res.status).toBe(503);
    expect(env.DB.prepare).not.toHaveBeenCalled();
    expect(env.CACHE.get).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // GET /api/live
  // -----------------------------------------------------------------------

  describe("GET /api/live", () => {
    it("should return 200 with version and DB status when healthy", async () => {
      const res = await callWorker(makeRequest("GET", "/api/live"), env);
      expect(res.status).toBe(200);

      const body = await res.json() as Record<string, unknown>;
      expect(body.status).toBe("ok");
      expect(body.version).toBe(WORKER_VERSION);
      expect(body.component).toBe("worker-read");
      expect(body.database).toEqual(
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

      const res = await callWorker(makeRequest("GET", "/api/live"), badEnv);
      expect(res.status).toBe(503);

      const body = await res.json() as Record<string, unknown>;
      expect(body.status).toBe("error");
      expect((body.database as Record<string, unknown>).connected).toBe(false);
      // D1 error messages are sanitized to a generic string to avoid info disclosure.
      expect((body.database as Record<string, unknown>).error).toBe("Internal server error");
    });

    it("should not leak raw D1 error messages (and never expose 'ok' that monitors might match)", async () => {
      const badDB = {
        prepare: vi.fn().mockReturnValue({
          first: vi.fn().mockRejectedValue(new Error("ok something failed")),
        }),
      } as unknown as D1Database;
      const badEnv = createEnv({ DB: badDB });

      const res = await callWorker(makeRequest("GET", "/api/live"), badEnv);
      expect(res.status).toBe(503);

      const body = await res.json() as Record<string, unknown>;
      expect(body.status).toBe("error");
      const database = body.database as Record<string, unknown>;
      expect(database.error).toBe("Internal server error");
      expect(database.error).not.toMatch(/\bok\b/i);
    });

    it("should skip auth for /api/live", async () => {
      // No Authorization header
      const req = new Request("https://pew.test.workers.dev/api/live", {
        method: "GET",
      });
      const res = await callWorker(req, env);
      expect(res.status).toBe(200);
    });

    it("should return 405 for non-GET on /api/live", async () => {
      const res = await callWorker(makeRequest("POST", "/api/live"), env);
      expect(res.status).toBe(405);
    });
  });

  // -----------------------------------------------------------------------
  // Auth
  // -----------------------------------------------------------------------

  describe("auth", () => {
    it("should return 401 when Authorization header is missing", async () => {
      const req = new Request("https://pew.test.workers.dev/api/rpc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "users.getById", id: "u1" }),
      });

      const res = await callWorker(req, env);
      expect(res.status).toBe(401);
      const body = await res.json() as Record<string, unknown>;
      expect(body.error).toBe("Unauthorized");
    });

    it("should return 401 when token is wrong", async () => {
      const res = await callWorker(
        makeRequest("POST", "/api/rpc", { method: "users.getById", id: "u1" }, "wrong-token"),
        env,
      );
      expect(res.status).toBe(401);
    });

    it("should pass auth with correct token", async () => {
      const res = await callWorker(
        makeRequest("POST", "/api/rpc", { method: "users.getById", id: "u1" }, SECRET),
        env,
      );
      expect(res.status).toBe(200);
    });
  });

  it.each(["SELECT * FROM users", "DELETE FROM users", "WITH x AS (SELECT 1) SELECT * FROM x"])(
    "rejects the removed SQL endpoint without accessing D1: %s",
    async (sql) => {
      const res = await callWorker(makeRequest("POST", "/api/query", { sql }, SECRET), env);
      expect(res.status).toBe(404);
      expect(env.DB.prepare).not.toHaveBeenCalled();
    },
  );

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

    it("should return 404 for GET on /api/query", async () => {
      const res = await callWorker(
        makeRequest("GET", "/api/query", undefined, SECRET),
        env,
      );
      expect(res.status).toBe(404);
    });

    it("should return 405 for GET on /api/rpc", async () => {
      const res = await callWorker(
        makeRequest("GET", "/api/rpc", undefined, SECRET),
        env,
      );
      expect(res.status).toBe(405);
    });
  });

  // -----------------------------------------------------------------------
  // POST /api/rpc
  // -----------------------------------------------------------------------

  describe("POST /api/rpc", () => {
    it("should return 401 without auth", async () => {
      const req = new Request("https://pew.test.workers.dev/api/rpc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "users.getById", id: "usr_123" }),
      });

      const res = await callWorker(req, env);
      expect(res.status).toBe(401);
    });

    it("should return 400 for missing method", async () => {
      const res = await callWorker(
        makeRequest("POST", "/api/rpc", { id: "usr_123" }, SECRET),
        env,
      );
      expect(res.status).toBe(400);
      const body = await res.json() as Record<string, unknown>;
      expect(body.error).toContain("method");
    });

    it("should return 400 for unknown domain", async () => {
      const res = await callWorker(
        makeRequest("POST", "/api/rpc", { method: "unknown.method" }, SECRET),
        env,
      );
      expect(res.status).toBe(400);
      const body = await res.json() as Record<string, unknown>;
      expect(body.error).toContain("Unknown RPC domain");
    });

    it("should route users domain to users handler", async () => {
      const mockUser = {
        id: "usr_123",
        email: "test@example.com",
        name: "Test",
        image: null,
        email_verified: null,
      };
      const db = createMockDB();
      (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(mockUser),
        }),
      });
      const testEnv = createEnv({ DB: db });

      const res = await callWorker(
        makeRequest("POST", "/api/rpc", { method: "users.getById", id: "usr_123" }, SECRET),
        testEnv,
      );

      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.result).toEqual(mockUser);
    });

    it("should return 400 for invalid JSON body", async () => {
      const req = new Request("https://pew.test.workers.dev/api/rpc", {
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
  });

  describe("scheduled handler", () => {
    it("is exported and callable; logs success path", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ data: [] }), { status: 200 })
      );
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        expect(typeof worker.scheduled).toBe("function");
        await worker.scheduled!(
          { cron: "0 3 * * *", scheduledTime: Date.now(), type: "scheduled" } as unknown as ScheduledController,
          createEnv(),
          { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext
        );
        expect(logSpy.mock.calls.flat().some((arg) =>
          typeof arg === "string" && arg.startsWith("dynamic pricing sync")
        ) || errSpy.mock.calls.flat().some((arg) =>
          typeof arg === "string" && arg.startsWith("dynamic pricing sync")
        )).toBe(true);
      } finally {
        fetchSpy.mockRestore();
        logSpy.mockRestore();
        errSpy.mockRestore();
      }
    });
  });
});
