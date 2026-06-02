import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDbRead } from "./test-utils";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
  getDbWrite: vi.fn(),
  resetDb: vi.fn(),
}));

vi.mock("@/lib/version", () => ({
  APP_VERSION: "1.2.3",
}));

const { getDbRead: initialGetDbRead } = (await import("@/lib/db")) as unknown as {
  getDbRead: ReturnType<typeof vi.fn>;
};
let getDbRead: ReturnType<typeof vi.fn> = initialGetDbRead;

function makeGetRequest(): Request {
  return new Request("http://localhost:7020/api/live", { method: "GET" });
}

// ---------------------------------------------------------------------------
// GET /api/live
// ---------------------------------------------------------------------------

describe("GET /api/live", () => {
  let GET: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.resetModules();

    vi.doMock("@/lib/db", () => ({
      getDbRead: vi.fn(),
      getDbWrite: vi.fn(),
      resetDb: vi.fn(),
    }));
    vi.doMock("@/lib/version", () => ({
      APP_VERSION: "1.2.3",
    }));

    const mod = await import("@/app/api/live/route");
    GET = mod.GET;

    const freshDb = (await import("@/lib/db")) as unknown as {
      getDbRead: ReturnType<typeof vi.fn>;
    };
    getDbRead = freshDb.getDbRead;
  });

  // -------------------------------------------------------------------------
  // Healthy
  // -------------------------------------------------------------------------

  it("should return 200 with status ok when DB is reachable", async () => {
    const mockDbRead = createMockDbRead();
    mockDbRead.ping.mockResolvedValue(undefined);
    getDbRead.mockResolvedValue(mockDbRead);

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(body.version).toBe("1.2.3");
    expect(body.component).toBe("dashboard");
    expect(typeof body.uptime).toBe("number");
    expect(typeof body.timestamp).toBe("string");
    expect(body.database).toEqual(
      expect.objectContaining({ connected: true })
    );
  });

  it("should include correct response headers", async () => {
    const mockDbRead = createMockDbRead();
    mockDbRead.ping.mockResolvedValue(undefined);
    getDbRead.mockResolvedValue(mockDbRead);

    const res = await GET(makeGetRequest());
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("should call db.ping() for connectivity check", async () => {
    const mockDbRead = createMockDbRead();
    mockDbRead.ping.mockResolvedValue(undefined);
    getDbRead.mockResolvedValue(mockDbRead);

    await GET(makeGetRequest());
    expect(mockDbRead.ping).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // DB failure
  // -------------------------------------------------------------------------

  it("should return 503 with status error when DB is unreachable", async () => {
    const mockDbRead = createMockDbRead();
    mockDbRead.ping.mockRejectedValue(new Error("D1 connection refused"));
    getDbRead.mockResolvedValue(mockDbRead);

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(503);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("error");
    expect(body.version).toBe("1.2.3");
    expect(body.component).toBe("dashboard");
    expect(typeof body.uptime).toBe("number");
    expect(typeof body.timestamp).toBe("string");

    const database = body.database as Record<string, unknown>;
    expect(database.connected).toBe(false);
    expect(typeof database.error).toBe("string");
  });

  it("should not contain 'ok' anywhere in error response body", async () => {
    const mockDbRead = createMockDbRead();
    mockDbRead.ping.mockRejectedValue(
      new Error("token is not ok for this account")
    );
    getDbRead.mockResolvedValue(mockDbRead);

    const res = await GET(makeGetRequest());
    const text = await res.text();
    const body = JSON.parse(text) as Record<string, unknown>;
    expect(body.status).toBe("error");

    const database = body.database as Record<string, unknown>;
    expect(database.error).not.toMatch(/\bok\b/i);
  });

  it("should sanitize error messages containing ok", async () => {
    const mockDbRead = createMockDbRead();
    mockDbRead.ping.mockRejectedValue(new Error("ok something failed"));
    getDbRead.mockResolvedValue(mockDbRead);

    const res = await GET(makeGetRequest());
    const body = (await res.json()) as Record<string, unknown>;
    const database = body.database as Record<string, unknown>;
    expect(database.error).toBe("*** something failed");
  });

  it("should handle non-Error throw from D1", async () => {
    const mockDbRead = createMockDbRead();
    mockDbRead.ping.mockRejectedValue("string error");
    getDbRead.mockResolvedValue(mockDbRead);

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(503);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("error");
    const database = body.database as Record<string, unknown>;
    expect(database.connected).toBe(false);
    expect(typeof database.error).toBe("string");
  });

  // -------------------------------------------------------------------------
  // DB ping timeout (Promise.race vs 3s setTimeout)
  // -------------------------------------------------------------------------

  it("should return 503 with 'DB ping timed out' when ping exceeds 3s", async () => {
    vi.useFakeTimers();
    try {
      const mockDbRead = createMockDbRead();
      // ping never resolves -- timeout branch must win the race
      mockDbRead.ping.mockReturnValue(new Promise(() => {}));
      getDbRead.mockResolvedValue(mockDbRead);

      const resPromise = GET(makeGetRequest());
      // Advance past the 3s DB_PING_TIMEOUT_MS so setTimeout fires
      await vi.advanceTimersByTimeAsync(3_000);
      const res = await resPromise;

      expect(res.status).toBe(503);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.status).toBe("error");
      const database = body.database as Record<string, unknown>;
      expect(database.connected).toBe(false);
      expect(database.error).toBe("DB ping timed out");
    } finally {
      vi.useRealTimers();
    }
  });

  // -------------------------------------------------------------------------
  // No auth required
  // -------------------------------------------------------------------------

  it("should not require authentication", async () => {
    const mockDbRead = createMockDbRead();
    mockDbRead.ping.mockResolvedValue(undefined);
    getDbRead.mockResolvedValue(mockDbRead);

    const req = new Request("http://localhost:7020/api/live", {
      method: "GET",
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
  });

  // -------------------------------------------------------------------------
  // Response shape
  // -------------------------------------------------------------------------

  it("should return all required fields in healthy response", async () => {
    const mockDbRead = createMockDbRead();
    mockDbRead.ping.mockResolvedValue(undefined);
    getDbRead.mockResolvedValue(mockDbRead);

    const res = await GET(makeGetRequest());
    const body = (await res.json()) as Record<string, unknown>;

    const keys = Object.keys(body).sort();
    expect(keys).toEqual(["component", "database", "status", "timestamp", "uptime", "version"]);
  });

  it("should return all required fields in error response", async () => {
    const mockDbRead = createMockDbRead();
    mockDbRead.ping.mockRejectedValue(new Error("boom"));
    getDbRead.mockResolvedValue(mockDbRead);

    const res = await GET(makeGetRequest());
    const body = (await res.json()) as Record<string, unknown>;

    const keys = Object.keys(body).sort();
    expect(keys).toEqual(["component", "database", "status", "timestamp", "uptime", "version"]);
  });

  it("should return valid ISO 8601 timestamp", async () => {
    const mockDbRead = createMockDbRead();
    mockDbRead.ping.mockResolvedValue(undefined);
    getDbRead.mockResolvedValue(mockDbRead);

    const res = await GET(makeGetRequest());
    const body = (await res.json()) as Record<string, unknown>;

    const ts = new Date(body.timestamp as string);
    expect(ts.toISOString()).toBe(body.timestamp);
  });
});
