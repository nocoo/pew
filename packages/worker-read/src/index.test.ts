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

    it("should return 401 for a same-length wrong token (fast path must compare bytes)", async () => {
      // "test-read-wrong!" matches SECRET's length, so a length short-circuit
      // would pass it. Only the byte comparison may reject it.
      const res = await callWorker(
        makeRequest("POST", "/api/rpc", { method: "users.getById", id: "u1" }, "test-read-wrong!"),
        env,
      );
      expect(res.status).toBe(401);
    });

    it("accepts matching bytes when the runtime provides subtle.timingSafeEqual", async () => {
      // The Workers fast path. Bun/Node do not expose it, so it must be stubbed
      // explicitly, otherwise this branch never executes and the length guard
      // inside the `&&` stays unproven.
      const fastEqual = (a: BufferSource, b: BufferSource): boolean => {
        const x = a as Uint8Array;
        const y = b as Uint8Array;
        return x.length === y.length && x.every((v, i) => v === y[i]);
      };
      const realCrypto = (globalThis as unknown as { crypto: Crypto }).crypto;
      vi.stubGlobal("crypto", new Proxy(realCrypto, {
        get: (target, key) => key === "subtle"
          ? { timingSafeEqual: fastEqual }
          : Reflect.get(target, key),
      }));
      try {
        const ok = await callWorker(
          makeRequest("POST", "/api/rpc", { method: "users.getById", id: "u1" }, SECRET),
          env,
        );
        expect(ok.status).toBe(200);

        const bad = await callWorker(
          makeRequest("POST", "/api/rpc", { method: "users.getById", id: "u1" }, "test-read-wrong!"),
          env,
        );
        expect(bad.status).toBe(401);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("auth still works when the runtime lacks subtle.timingSafeEqual", async () => {
      // The fallback constant-time comparison exists for runtimes whose
      // crypto.subtle has no timingSafeEqual (Node/Vitest). Stub the global so
      // the fast path is unreachable, then exercise both outcomes of the XOR
      // loop: matching bytes accept, differing bytes reject.
      vi.stubGlobal("crypto", { subtle: {} });
      try {
        const ok = await callWorker(
          makeRequest("POST", "/api/rpc", { method: "users.getById", id: "u1" }, SECRET),
          env,
        );
        expect(ok.status).toBe(200);
        const afterAccept = vi.mocked(env.DB.prepare).mock.calls.length;

        const bad = await callWorker(
          makeRequest("POST", "/api/rpc", { method: "users.getById", id: "u1" }, "test-read-wrong!"),
          env,
        );
        expect(bad.status).toBe(401);
        // The rejected request must have been stopped at auth, not carried on
        // to the domain handler.
        expect(vi.mocked(env.DB.prepare).mock.calls.length).toBe(afterAccept);
      } finally {
        vi.unstubAllGlobals();
      }
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
    it("should return 400 for a JSON body that is not an envelope", async () => {
      // `null` is the `typeof body === "object"` trap the explicit null check
      // exists for; a number or string fails `typeof !== "object"`; an array
      // is an object, so it falls through to the method lookup. All four are
      // pre-dispatch rejections, and none may reach a domain handler.
      const raws = ["null", "5", '"str"', "[1,2]"];
      for (const raw of raws) {
        const req = new Request("https://pew.test.workers.dev/api/rpc", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}` },
          body: raw,
        });
        const res = await callWorker(req, env);
        expect(res.status, raw).toBe(400);
        const body = await res.json() as Record<string, unknown>;
        if (raw === "null") expect(body.error).toContain("Invalid request body");
      }
      expect(env.DB.prepare).not.toHaveBeenCalled();
    });

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

    // The handlers have their own unit tests, but those import them directly:
    // they would all still pass if this switch routed a domain to the wrong
    // handler or lost a case entirely. Each domain is probed with a method it
    // does not implement, so reaching the handler is observable in the error
    // text ("Unknown <domain> method") rather than in any real query.
    it.each([
      "users", "teams", "seasons", "usage", "devices", "organizations", "settings",
      "auth", "sessions", "leaderboard", "pricing", "admin", "live", "cache",
    ])("routes the %s domain to its handler", async (domain) => {
      const res = await callWorker(
        makeRequest("POST", "/api/rpc", { method: `${domain}.definitelyNotAMethod` }, SECRET),
        env,
      );
      const body = await res.json() as { error?: string };
      expect(body.error, `${domain} is not wired into the dispatch switch`).toContain(
        `Unknown ${domain} method`,
      );
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
    it("logs the degraded path when a pricing upstream fails with no cache", async () => {
      // Both upstreams reject and KV holds no last-fetch fallback, so the
      // outcome carries errors and the cron path must report it as degraded
      // rather than claiming a clean sync.
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("upstream down", { status: 503 })
      );
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        await worker.scheduled!(
          { cron: "0 3 * * *", scheduledTime: Date.now(), type: "scheduled" } as unknown as ScheduledController,
          createEnv(),
          { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext
        );
        const degraded = errSpy.mock.calls.flat();
        expect(degraded.some((arg) =>
          typeof arg === "string" && arg.startsWith("dynamic pricing sync degraded")
        )).toBe(true);
        expect(logSpy.mock.calls.flat().some((arg) =>
          typeof arg === "string" && arg.startsWith("dynamic pricing sync ok")
        )).toBe(false);
      } finally {
        fetchSpy.mockRestore();
        logSpy.mockRestore();
        errSpy.mockRestore();
      }
    });

    it("logs the clean path when both upstreams succeed", async () => {
      // Both upstreams resolve concurrently and each reads its own body, so
      // the mock must hand out a fresh Response per call; a single shared one
      // makes the second read fail and turns this into the degraded path.
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
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
        // A clean run must be logged as such; accepting either branch here let
        // a regression that always reports degradation pass unnoticed.
        expect(logSpy.mock.calls.flat().some((arg) =>
          typeof arg === "string" && arg.startsWith("dynamic pricing sync ok")
        )).toBe(true);
        expect(errSpy.mock.calls.flat().some((arg) =>
          typeof arg === "string" && arg.startsWith("dynamic pricing sync degraded")
        )).toBe(false);
      } finally {
        fetchSpy.mockRestore();
        logSpy.mockRestore();
        errSpy.mockRestore();
      }
    });
  });
});


describe("RPC count precision boundary", () => {
  it("absorbs a synchronous throw from a domain handler into a generic 500", async () => {
    const env = createEnv();
    // The handler's synchronous prologue throws (checkedCountDatabase's
    // `get` trap rethrows whatever `target.prepare` throws), which becomes a
    // rejection the count guard catches — the request must still end in a
    // generic 500, never an unhandled crash or a leaked message.
    const throwingDb = new Proxy(env.DB, {
      get(target, property) {
        if (property === "prepare") return () => { throw new Error("prepare exploded PRIVATE"); };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as D1Database;
    const response = await callWorker(
      makeRequest("POST", "/api/rpc", { method: "users.getById", id: "u1" }, SECRET),
      { ...env, DB: throwingDb },
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal server error" });
  });

  it("rejects rounded aggregate results from domain handlers", async () => {
    const env = createEnv();
    vi.mocked(env.DB.prepare).mockReturnValue({ first: vi.fn().mockResolvedValue({ total_tokens: Number.MAX_SAFE_INTEGER + 1 }) } as unknown as D1PreparedStatement);
    const response = await callWorker(makeRequest("POST", "/api/rpc", { method: "admin.getSystemStats" }, SECRET), env);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Count exceeds supported integer range" });
  });

  it("catches asynchronous SQLite overflow without exposing queries or partial results", async () => {
    const env = createEnv();
    vi.mocked(env.DB.prepare).mockReturnValue({ first: vi.fn().mockRejectedValue(new Error("integer overflow PRIVATE")) } as unknown as D1PreparedStatement);
    const response = await callWorker(makeRequest("POST", "/api/rpc", { method: "admin.getSystemStats" }, SECRET), env);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal server error" });
  });
});
