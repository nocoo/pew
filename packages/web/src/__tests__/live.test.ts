import { describe, it, expect, vi, beforeEach } from "vitest";
import * as d1Module from "@/lib/d1";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/d1", async (importOriginal) => {
  const original = await importOriginal<typeof d1Module>();
  return { ...original, getD1Client: vi.fn() };
});

vi.mock("@/lib/version", () => ({
  APP_VERSION: "1.2.3",
}));

const { getD1Client } = (await import("@/lib/d1")) as unknown as {
  getD1Client: ReturnType<typeof vi.fn>;
};

function createMockClient() {
  return {
    query: vi.fn(),
    execute: vi.fn(),
    batch: vi.fn(),
    firstOrNull: vi.fn(),
  };
}

function makeGetRequest(): Request {
  return new Request("http://localhost:7030/api/live", { method: "GET" });
}

// ---------------------------------------------------------------------------
// GET /api/live
// ---------------------------------------------------------------------------

describe("GET /api/live", () => {
  let GET: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.resetModules();

    vi.doMock("@/lib/d1", async (importOriginal) => {
      const original = await importOriginal<typeof d1Module>();
      return { ...original, getD1Client: vi.fn() };
    });
    vi.doMock("@/lib/version", () => ({
      APP_VERSION: "1.2.3",
    }));

    const mod = await import("@/app/api/live/route");
    GET = mod.GET;

    const freshD1 = (await import("@/lib/d1")) as unknown as {
      getD1Client: ReturnType<typeof vi.fn>;
    };
    Object.assign(getD1Client, freshD1.getD1Client);
  });

  // -------------------------------------------------------------------------
  // Healthy
  // -------------------------------------------------------------------------

  it("should return 200 with status ok when DB is reachable", async () => {
    const mockClient = createMockClient();
    mockClient.query.mockResolvedValue({ results: [{ 1: 1 }], meta: {} });
    getD1Client.mockReturnValue(mockClient);

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
    const mockClient = createMockClient();
    mockClient.query.mockResolvedValue({ results: [], meta: {} });
    getD1Client.mockReturnValue(mockClient);

    const res = await GET(makeGetRequest());
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.headers.get("Cache-Control")).toBe(
      "no-store, no-cache, must-revalidate"
    );
  });

  it("should call D1 with SELECT 1 for lightweight connectivity check", async () => {
    const mockClient = createMockClient();
    mockClient.query.mockResolvedValue({ results: [], meta: {} });
    getD1Client.mockReturnValue(mockClient);

    await GET(makeGetRequest());
    expect(mockClient.query).toHaveBeenCalledWith("SELECT 1");
  });

  // -------------------------------------------------------------------------
  // DB failure
  // -------------------------------------------------------------------------

  it("should return 503 with status error when DB is unreachable", async () => {
    const mockClient = createMockClient();
    mockClient.query.mockRejectedValue(new Error("D1 connection refused"));
    getD1Client.mockReturnValue(mockClient);

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
    const mockClient = createMockClient();
    mockClient.query.mockRejectedValue(
      new Error("token is not ok for this account")
    );
    getD1Client.mockReturnValue(mockClient);

    const res = await GET(makeGetRequest());
    const text = await res.text();
    // "ok" should only appear as a key name, never in any value for error state
    // Parse the response and check status is "error", and error message sanitized
    const body = JSON.parse(text) as Record<string, unknown>;
    expect(body.status).toBe("error");

    const db = body.db as Record<string, unknown>;
    expect(db.error).not.toMatch(/\bok\b/i);
  });

  it("should sanitize ok from D1 error messages", async () => {
    const mockClient = createMockClient();
    mockClient.query.mockRejectedValue(new Error("ok something failed"));
    getD1Client.mockReturnValue(mockClient);

    const res = await GET(makeGetRequest());
    const body = (await res.json()) as Record<string, unknown>;
    const db = body.db as Record<string, unknown>;
    expect(db.error).toBe("*** something failed");
  });

  it("should handle non-Error throw from D1", async () => {
    const mockClient = createMockClient();
    mockClient.query.mockRejectedValue("string error");
    getD1Client.mockReturnValue(mockClient);

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(503);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("error");
    const db = body.db as Record<string, unknown>;
    expect(db.connected).toBe(false);
    expect(db.error).toBe("string error");
  });

  // -------------------------------------------------------------------------
  // No auth required
  // -------------------------------------------------------------------------

  it("should not require authentication", async () => {
    const mockClient = createMockClient();
    mockClient.query.mockResolvedValue({ results: [], meta: {} });
    getD1Client.mockReturnValue(mockClient);

    // No auth headers at all
    const req = new Request("http://localhost:7030/api/live", {
      method: "GET",
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
  });

  // -------------------------------------------------------------------------
  // Response shape
  // -------------------------------------------------------------------------

  it("should return all required fields in healthy response", async () => {
    const mockClient = createMockClient();
    mockClient.query.mockResolvedValue({ results: [], meta: {} });
    getD1Client.mockReturnValue(mockClient);

    const res = await GET(makeGetRequest());
    const body = (await res.json()) as Record<string, unknown>;

    const keys = Object.keys(body).sort();
    expect(keys).toEqual(["db", "status", "timestamp", "uptime", "version"]);
  });

  it("should return all required fields in error response", async () => {
    const mockClient = createMockClient();
    mockClient.query.mockRejectedValue(new Error("boom"));
    getD1Client.mockReturnValue(mockClient);

    const res = await GET(makeGetRequest());
    const body = (await res.json()) as Record<string, unknown>;

    const keys = Object.keys(body).sort();
    expect(keys).toEqual(["db", "status", "timestamp", "uptime", "version"]);
  });

  it("should return valid ISO 8601 timestamp", async () => {
    const mockClient = createMockClient();
    mockClient.query.mockResolvedValue({ results: [], meta: {} });
    getD1Client.mockReturnValue(mockClient);

    const res = await GET(makeGetRequest());
    const body = (await res.json()) as Record<string, unknown>;

    const ts = new Date(body.timestamp as string);
    expect(ts.toISOString()).toBe(body.timestamp);
  });
});
