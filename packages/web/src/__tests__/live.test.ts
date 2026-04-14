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

const { getDbRead } = (await import("@/lib/db")) as unknown as {
  getDbRead: ReturnType<typeof vi.fn>;
};

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
    Object.assign(getDbRead, freshDb.getDbRead);
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
    expect(typeof body.uptime).toBe("number");
    expect(typeof body.timestamp).toBe("string");
    expect(body.db).toEqual(
      expect.objectContaining({ connected: true, latencyMs: expect.any(Number) })
    );
  });

  it("should include correct response headers", async () => {
    const mockDbRead = createMockDbRead();
    mockDbRead.ping.mockResolvedValue(undefined);
    getDbRead.mockResolvedValue(mockDbRead);

    const res = await GET(makeGetRequest());
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=10"
    );
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
    expect(typeof body.uptime).toBe("number");
    expect(typeof body.timestamp).toBe("string");

    const db = body.db as Record<string, unknown>;
    expect(db.connected).toBe(false);
    expect(typeof db.error).toBe("string");
  });

  it("should not contain 'ok' anywhere in error response body", async () => {
    const mockDbRead = createMockDbRead();
    mockDbRead.ping.mockRejectedValue(
      new Error("token is not ok for this account")
    );
    getDbRead.mockResolvedValue(mockDbRead);

    const res = await GET(makeGetRequest());
    const text = await res.text();
    // "ok" should only appear as a key name, never in any value for error state
    // Parse the response and check status is "error", and error message sanitized
    const body = JSON.parse(text) as Record<string, unknown>;
    expect(body.status).toBe("error");

    const db = body.db as Record<string, unknown>;
    expect(db.error).not.toMatch(/\bok\b/i);
  });

  it("should sanitize error details from D1 error messages", async () => {
    const mockDbRead = createMockDbRead();
    mockDbRead.ping.mockRejectedValue(new Error("ok something failed"));
    getDbRead.mockResolvedValue(mockDbRead);

    const res = await GET(makeGetRequest());
    const body = (await res.json()) as Record<string, unknown>;
    const db = body.db as Record<string, unknown>;
    // Internal error details are redacted for security
    expect(db.error).toBe("Service unavailable");
  });

  it("should handle non-Error throw from D1", async () => {
    const mockDbRead = createMockDbRead();
    mockDbRead.ping.mockRejectedValue("string error");
    getDbRead.mockResolvedValue(mockDbRead);

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(503);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("error");
    const db = body.db as Record<string, unknown>;
    expect(db.connected).toBe(false);
    // Internal error details are redacted for security
    expect(db.error).toBe("Service unavailable");
  });

  // -------------------------------------------------------------------------
  // No auth required
  // -------------------------------------------------------------------------

  it("should not require authentication", async () => {
    const mockDbRead = createMockDbRead();
    mockDbRead.ping.mockResolvedValue(undefined);
    getDbRead.mockResolvedValue(mockDbRead);

    // No auth headers at all
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
    expect(keys).toEqual(["db", "status", "timestamp", "uptime", "version"]);
  });

  it("should return all required fields in error response", async () => {
    const mockDbRead = createMockDbRead();
    mockDbRead.ping.mockRejectedValue(new Error("boom"));
    getDbRead.mockResolvedValue(mockDbRead);

    const res = await GET(makeGetRequest());
    const body = (await res.json()) as Record<string, unknown>;

    const keys = Object.keys(body).sort();
    expect(keys).toEqual(["db", "status", "timestamp", "uptime", "version"]);
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
