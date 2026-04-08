import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, PUT, DELETE } from "@/app/api/devices/route";
import { createMockDbRead, createMockDbWrite } from "./test-utils";
import * as dbModule from "@/lib/db";

// Mock db
vi.mock("@/lib/db", async (importOriginal) => {
  const original = await importOriginal<typeof dbModule>();
  return {
    ...original,
    getDbRead: vi.fn(),
    getDbWrite: vi.fn(),
  };
});

// Mock resolveUser
vi.mock("@/lib/auth-helpers", () => ({
  resolveUser: vi.fn(),
}));

const { resolveUser } = (await import("@/lib/auth-helpers")) as unknown as {
  resolveUser: ReturnType<typeof vi.fn>;
};

function makeGetRequest(): Request {
  return new Request("http://localhost:7020/api/devices");
}

function makePutRequest(body: unknown): Request {
  return new Request("http://localhost:7020/api/devices", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/devices", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(
      mockDbRead as unknown as dbModule.DbRead
    );
  });

  it("should reject unauthenticated requests", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce(null);

    const res = await GET(makeGetRequest());

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("should return all devices with stats", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    mockDbRead.query.mockResolvedValueOnce({
      results: [
        {
          device_id: "aaaa-1111",
          alias: "MacBook Pro",
          first_seen: "2026-03-01T00:00:00Z",
          last_seen: "2026-03-10T12:00:00Z",
          total_tokens: 50000,
          sources: "claude-code,opencode",
          model_count: 3,
        },
        {
          device_id: "bbbb-2222",
          alias: null,
          first_seen: "2026-03-05T00:00:00Z",
          last_seen: "2026-03-10T10:00:00Z",
          total_tokens: 20000,
          sources: "opencode",
          model_count: 1,
        },
      ],
      meta: {},
    });

    const res = await GET(makeGetRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.devices).toHaveLength(2);
    expect(body.devices[0].device_id).toBe("aaaa-1111");
    expect(body.devices[0].alias).toBe("MacBook Pro");
    expect(body.devices[0].total_tokens).toBe(50000);
    expect(Array.isArray(body.devices[0].sources)).toBe(true);
    expect(body.devices[0].sources).toEqual(["claude-code", "opencode"]);
    expect(body.devices[0].model_count).toBe(3);
    expect(body.devices[1].alias).toBeNull();
  });

  it("should include 'default' device", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    mockDbRead.query.mockResolvedValueOnce({
      results: [
        {
          device_id: "default",
          alias: null,
          first_seen: "2026-01-15T00:00:00Z",
          last_seen: "2026-02-28T00:00:00Z",
          total_tokens: 200000,
          sources: "claude-code",
          model_count: 1,
        },
      ],
      meta: {},
    });

    const res = await GET(makeGetRequest());
    const body = await res.json();

    expect(body.devices).toHaveLength(1);
    expect(body.devices[0].device_id).toBe("default");
  });

  it("should return 500 on D1 error", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });
    mockDbRead.query.mockRejectedValueOnce(new Error("D1 down"));

    const res = await GET(makeGetRequest());

    expect(res.status).toBe(500);
  });
});

describe("PUT /api/devices", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;
  let mockDbWrite: ReturnType<typeof createMockDbWrite>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    mockDbWrite = createMockDbWrite();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(
      mockDbRead as unknown as dbModule.DbRead
    );
    vi.mocked(dbModule.getDbWrite).mockResolvedValue(
      mockDbWrite as unknown as dbModule.DbWrite
    );
  });

  it("should reject unauthenticated requests", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce(null);

    const res = await PUT(makePutRequest({ device_id: "x", alias: "y" }));

    expect(res.status).toBe(401);
  });

  it("should create alias for a valid device", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    // Device exists check
    mockDbRead.firstOrNull.mockResolvedValueOnce({ device_id: "aaaa-1111" });
    // Duplicate alias check
    mockDbRead.firstOrNull.mockResolvedValueOnce(null);
    // Upsert
    mockDbWrite.execute.mockResolvedValueOnce({ meta: {} });

    const res = await PUT(
      makePutRequest({ device_id: "aaaa-1111", alias: "MacBook Pro" })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("should update existing alias", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    mockDbRead.firstOrNull.mockResolvedValueOnce({ device_id: "aaaa-1111" });
    mockDbRead.firstOrNull.mockResolvedValueOnce(null);
    mockDbWrite.execute.mockResolvedValueOnce({ meta: {} });

    const res = await PUT(
      makePutRequest({ device_id: "aaaa-1111", alias: "New Name" })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("should reject empty alias", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    const res = await PUT(makePutRequest({ device_id: "aaaa-1111", alias: "" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/alias/i);
  });

  it("should reject alias longer than 50 chars", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    const longAlias = "A".repeat(51);
    const res = await PUT(
      makePutRequest({ device_id: "aaaa-1111", alias: longAlias })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/alias/i);
  });

  it("should reject duplicate alias (case-insensitive)", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    // Device exists
    mockDbRead.firstOrNull.mockResolvedValueOnce({ device_id: "bbbb-2222" });
    // Duplicate check — another device has this alias
    mockDbRead.firstOrNull.mockResolvedValueOnce({
      device_id: "aaaa-1111",
    });

    const res = await PUT(
      makePutRequest({ device_id: "bbbb-2222", alias: "macbook" })
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already in use/i);
  });

  it("should allow same alias for same device (self-update)", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    // Device exists
    mockDbRead.firstOrNull.mockResolvedValueOnce({ device_id: "aaaa-1111" });
    // Duplicate check — returns same device (self)
    mockDbRead.firstOrNull.mockResolvedValueOnce(null);
    // Upsert
    mockDbWrite.execute.mockResolvedValueOnce({ meta: {} });

    const res = await PUT(
      makePutRequest({ device_id: "aaaa-1111", alias: "MacBook" })
    );

    expect(res.status).toBe(200);
  });

  it("should reject phantom device_id", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    // Device NOT found in usage_records
    mockDbRead.firstOrNull.mockResolvedValueOnce(null);

    const res = await PUT(
      makePutRequest({ device_id: "phantom-9999", alias: "Ghost" })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/device/i);
  });

  it("should allow alias for 'default' device", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    mockDbRead.firstOrNull.mockResolvedValueOnce({ device_id: "default" });
    mockDbRead.firstOrNull.mockResolvedValueOnce(null);
    mockDbWrite.execute.mockResolvedValueOnce({ meta: {} });

    const res = await PUT(
      makePutRequest({ device_id: "default", alias: "Old Machine" })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("should reject missing device_id", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    const res = await PUT(makePutRequest({ alias: "Name" }));

    expect(res.status).toBe(400);
  });

  it("should return 500 on D1 error", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    mockDbRead.firstOrNull.mockRejectedValueOnce(new Error("D1 down"));

    const res = await PUT(
      makePutRequest({ device_id: "aaaa-1111", alias: "Name" })
    );

    expect(res.status).toBe(500);
  });

  it("should reject invalid JSON body", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    const req = new Request("http://localhost:7020/api/devices", {
      method: "PUT",
      body: "not json",
      headers: { "Content-Type": "application/json" },
    });

    const res = await PUT(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid JSON");
  });

  it("should handle null first_seen / last_seen / total_tokens in GET results", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    mockDbRead.query.mockResolvedValueOnce({
      results: [
        {
          device_id: "orphan-device",
          alias: "Orphan",
          first_seen: null,
          last_seen: null,
          total_tokens: null,
          sources: null,
          model_count: null,
        },
      ],
      meta: {},
    });

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.devices[0].first_seen).toBeNull();
    expect(body.devices[0].last_seen).toBeNull();
    expect(body.devices[0].total_tokens).toBe(0);
    expect(body.devices[0].sources).toEqual([]);
    expect(body.devices[0].model_count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/devices
// ---------------------------------------------------------------------------

function makeDeleteRequest(body: unknown): Request {
  return new Request("http://localhost:7020/api/devices", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("DELETE /api/devices", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;
  let mockDbWrite: ReturnType<typeof createMockDbWrite>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    mockDbWrite = createMockDbWrite();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(
      mockDbRead as unknown as dbModule.DbRead
    );
    vi.mocked(dbModule.getDbWrite).mockResolvedValue(
      mockDbWrite as unknown as dbModule.DbWrite
    );
  });

  it("should reject unauthenticated requests", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce(null);

    const res = await DELETE(makeDeleteRequest({ device_id: "x" }));
    expect(res.status).toBe(401);
  });

  it("should delete device with zero usage records", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    // Has zero records
    mockDbRead.firstOrNull.mockResolvedValueOnce({ cnt: 0 });
    mockDbWrite.execute.mockResolvedValueOnce({ meta: {} });

    const res = await DELETE(makeDeleteRequest({ device_id: "orphan-device" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("should refuse to delete device with usage records", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    // Has records
    mockDbRead.firstOrNull.mockResolvedValueOnce({ cnt: 5 });

    const res = await DELETE(makeDeleteRequest({ device_id: "active-device" }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("usage records");
  });

  it("should reject missing device_id", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    const res = await DELETE(makeDeleteRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("device_id");
  });

  it("should reject invalid JSON body", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    const req = new Request("http://localhost:7020/api/devices", {
      method: "DELETE",
      body: "not json",
      headers: { "Content-Type": "application/json" },
    });

    const res = await DELETE(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid JSON");
  });

  it("should return 500 on D1 error", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    mockDbRead.firstOrNull.mockRejectedValueOnce(new Error("D1 down"));

    const res = await DELETE(makeDeleteRequest({ device_id: "x" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("Failed to delete device");
  });

  it("should allow delete when hasRecords is null", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    // hasRecords is null (no matching records at all)
    mockDbRead.firstOrNull.mockResolvedValueOnce(null);
    mockDbWrite.execute.mockResolvedValueOnce({ meta: {} });

    const res = await DELETE(makeDeleteRequest({ device_id: "x" }));
    expect(res.status).toBe(200);
  });

  it("should reject empty string device_id", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    const res = await DELETE(makeDeleteRequest({ device_id: "  " }));
    expect(res.status).toBe(400);
  });
});
