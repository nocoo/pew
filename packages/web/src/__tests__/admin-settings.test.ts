import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDbRead, createMockDbWrite } from "./test-utils";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
  getDbWrite: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({
  resolveAdmin: vi.fn(),
}));

import * as dbModule from "@/lib/db";

const { resolveAdmin } = (await import("@/lib/admin")) as unknown as {
  resolveAdmin: ReturnType<typeof vi.fn>;
};

function makeGet(): Request {
  return new Request("http://localhost:7020/api/admin/settings");
}

function makePut(body?: unknown): Request {
  const opts: RequestInit = { method: "PUT" };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
    opts.headers = { "Content-Type": "application/json" };
  }
  return new Request("http://localhost:7020/api/admin/settings", opts);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/admin/settings", () => {
  let GET: (req: Request) => Promise<Response>;
  let mockDbRead: ReturnType<typeof createMockDbRead>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as never);
    const mod = await import("@/app/api/admin/settings/route");
    GET = mod.GET;
  });

  it("should reject non-admin with 403", async () => {
    resolveAdmin.mockResolvedValueOnce(null);
    const res = await GET(makeGet());
    expect(res.status).toBe(403);
  });

  it("should return settings list", async () => {
    resolveAdmin.mockResolvedValueOnce({ userId: "admin1", email: "a@b.com" });
    mockDbRead.query.mockResolvedValueOnce({
      results: [
        { key: "max_team_members", value: "5", updated_at: "2026-01-01T00:00:00Z" },
      ],
    });

    const res = await GET(makeGet());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.settings).toHaveLength(1);
    expect(body.settings[0].key).toBe("max_team_members");
  });

  it("should return empty array when table does not exist", async () => {
    resolveAdmin.mockResolvedValueOnce({ userId: "admin1", email: "a@b.com" });
    mockDbRead.query.mockRejectedValueOnce(new Error("no such table: app_settings"));

    const res = await GET(makeGet());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.settings).toEqual([]);
  });

  it("should return 500 on unexpected error", async () => {
    resolveAdmin.mockResolvedValueOnce({ userId: "admin1", email: "a@b.com" });
    mockDbRead.query.mockRejectedValueOnce(new Error("D1 down"));

    const res = await GET(makeGet());
    expect(res.status).toBe(500);
  });
});

describe("PUT /api/admin/settings", () => {
  let PUT: (req: Request) => Promise<Response>;
  let mockDbWrite: ReturnType<typeof createMockDbWrite>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbWrite = createMockDbWrite();
    vi.mocked(dbModule.getDbWrite).mockResolvedValue(mockDbWrite as never);
    const mod = await import("@/app/api/admin/settings/route");
    PUT = mod.PUT;
  });

  it("should reject non-admin with 403", async () => {
    resolveAdmin.mockResolvedValueOnce(null);
    const res = await PUT(makePut({ key: "foo", value: "bar" }));
    expect(res.status).toBe(403);
  });

  it("should reject invalid JSON", async () => {
    resolveAdmin.mockResolvedValueOnce({ userId: "admin1", email: "a@b.com" });
    const res = await PUT(
      new Request("http://localhost:7020/api/admin/settings", {
        method: "PUT",
        body: "not json",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid JSON");
  });

  it("should reject missing key", async () => {
    resolveAdmin.mockResolvedValueOnce({ userId: "admin1", email: "a@b.com" });
    const res = await PUT(makePut({ value: "5" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("key is required");
  });

  it("should reject empty key", async () => {
    resolveAdmin.mockResolvedValueOnce({ userId: "admin1", email: "a@b.com" });
    const res = await PUT(makePut({ key: "", value: "5" }));
    expect(res.status).toBe(400);
  });

  it("should reject missing value", async () => {
    resolveAdmin.mockResolvedValueOnce({ userId: "admin1", email: "a@b.com" });
    const res = await PUT(makePut({ key: "max_team_members" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("value is required");
  });

  it("should reject non-string value", async () => {
    resolveAdmin.mockResolvedValueOnce({ userId: "admin1", email: "a@b.com" });
    const res = await PUT(makePut({ key: "max_team_members", value: 5 }));
    expect(res.status).toBe(400);
  });

  it("should upsert setting successfully", async () => {
    resolveAdmin.mockResolvedValueOnce({ userId: "admin1", email: "a@b.com" });
    mockDbWrite.execute.mockResolvedValueOnce({ changes: 1 });

    const res = await PUT(makePut({ key: "max_team_members", value: "10" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.key).toBe("max_team_members");
    expect(body.value).toBe("10");
    expect(mockDbWrite.execute.mock.calls[0]![0]).toContain("ON CONFLICT");
  });

  it("should return 503 when table does not exist", async () => {
    resolveAdmin.mockResolvedValueOnce({ userId: "admin1", email: "a@b.com" });
    mockDbWrite.execute.mockRejectedValueOnce(new Error("no such table: app_settings"));

    const res = await PUT(makePut({ key: "max_team_members", value: "5" }));
    expect(res.status).toBe(503);
  });

  it("should return 500 on unexpected error", async () => {
    resolveAdmin.mockResolvedValueOnce({ userId: "admin1", email: "a@b.com" });
    mockDbWrite.execute.mockRejectedValueOnce(new Error("D1 boom"));

    const res = await PUT(makePut({ key: "foo", value: "bar" }));
    expect(res.status).toBe(500);
  });

  // -------------------------------------------------------------------------
  // Per-key semantic validation — max_team_members must be a positive integer
  // -------------------------------------------------------------------------

  it.each(["0", "-1", "-100", "abc", "3.5", "1.0", " 5", "5 ", ""])(
    "should reject invalid max_team_members value: %j",
    async (badValue) => {
      resolveAdmin.mockResolvedValueOnce({ userId: "admin1", email: "a@b.com" });
      const res = await PUT(makePut({ key: "max_team_members", value: badValue }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("max_team_members");
    },
  );

  it.each(["1", "5", "10", "100", "999"])(
    "should accept valid max_team_members value: %j",
    async (goodValue) => {
      resolveAdmin.mockResolvedValueOnce({ userId: "admin1", email: "a@b.com" });
      mockDbWrite.execute.mockResolvedValueOnce({ changes: 1 });
      const res = await PUT(makePut({ key: "max_team_members", value: goodValue }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.value).toBe(goodValue);
    },
  );

  it("should allow unknown keys without extra validation", async () => {
    resolveAdmin.mockResolvedValueOnce({ userId: "admin1", email: "a@b.com" });
    mockDbWrite.execute.mockResolvedValueOnce({ changes: 1 });
    const res = await PUT(makePut({ key: "some_future_setting", value: "anything" }));
    expect(res.status).toBe(200);
  });
});
