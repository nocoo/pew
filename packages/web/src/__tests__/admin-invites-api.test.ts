import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be before imports that trigger the module chain
// ---------------------------------------------------------------------------

vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
  getDbWrite: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({
  resolveAdmin: vi.fn(),
}));

vi.mock("@/auth", () => ({
  shouldUseSecureCookies: vi.fn(() => false),
}));

// generateInviteCode always returns a predictable value for tests
let inviteCallCount = 0;
vi.mock("@/lib/invite", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/invite")>();
  return {
    ...original,
    generateInviteCode: vi.fn(() => {
      inviteCallCount++;
      return `CODE${String(inviteCallCount).padStart(4, "0")}`;
    }),
  };
});

import { GET, POST, DELETE } from "@/app/api/admin/invites/route";
import { createMockDbRead, createMockDbWrite, makeJsonRequest } from "./test-utils";
import * as dbModule from "@/lib/db";

const { resolveAdmin } = (await import("@/lib/admin")) as unknown as {
  resolveAdmin: ReturnType<typeof vi.fn>;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/admin/invites", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as never);
  });

  it("should return 403 for non-admin", async () => {
    resolveAdmin.mockResolvedValueOnce(null);
    const res = await GET(makeJsonRequest("GET", "/api/admin/invites"));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("Forbidden");
  });

  it("should return empty rows when table does not exist", async () => {
    resolveAdmin.mockResolvedValueOnce({ userId: "admin-1", email: "admin@test.com" });
    mockDbRead.listInviteCodes.mockRejectedValueOnce(new Error("no such table: invite_codes"));

    const res = await GET(makeJsonRequest("GET", "/api/admin/invites"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.rows).toEqual([]);
  });

  it("should return 500 on unexpected error", async () => {
    resolveAdmin.mockResolvedValueOnce({ userId: "admin-1", email: "admin@test.com" });
    mockDbRead.listInviteCodes.mockRejectedValueOnce(new Error("D1 connection failed"));

    const res = await GET(makeJsonRequest("GET", "/api/admin/invites"));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("Failed to load invite codes");
  });

  it("should return rows for admin", async () => {
    resolveAdmin.mockResolvedValueOnce({
      userId: "admin-1",
      email: "admin@test.com",
    });
    const mockRows = [
      {
        id: 1,
        code: "A3K9X2M4",
        created_by: "admin-1",
        created_by_email: "admin@test.com",
        used_by: null,
        used_by_email: null,
        used_at: null,
        created_at: "2026-03-10T12:00:00Z",
      },
    ];
    mockDbRead.listInviteCodes.mockResolvedValueOnce(mockRows);

    const res = await GET(makeJsonRequest("GET", "/api/admin/invites"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.rows).toEqual(mockRows);
  });
});

describe("POST /api/admin/invites", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;
  let mockDbWrite: ReturnType<typeof createMockDbWrite>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    mockDbWrite = createMockDbWrite();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as never);
    vi.mocked(dbModule.getDbWrite).mockResolvedValue(mockDbWrite as never);
  });

  it("should return 403 for non-admin", async () => {
    resolveAdmin.mockResolvedValueOnce(null);
    const res = await POST(makeJsonRequest("POST", "/api/admin/invites", { count: 1 }));
    expect(res.status).toBe(403);
  });

  it("should generate N codes", async () => {
    resolveAdmin.mockResolvedValueOnce({
      userId: "admin-1",
      email: "admin@test.com",
    });
    // checkInviteCodeExists returns null (no collision)
    mockDbRead.checkInviteCodeExists.mockResolvedValue(null);
    mockDbWrite.execute.mockResolvedValue({ changes: 1, duration: 0.01 });

    const res = await POST(makeJsonRequest("POST", "/api/admin/invites", { count: 3 }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.codes).toHaveLength(3);
    // Each code should be a string
    for (const code of json.codes) {
      expect(typeof code).toBe("string");
    }
  });

  it("should reject count > 20", async () => {
    resolveAdmin.mockResolvedValueOnce({
      userId: "admin-1",
      email: "admin@test.com",
    });
    const res = await POST(makeJsonRequest("POST", "/api/admin/invites", { count: 21 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("count must be at most 20");
  });

  it("should return 400 for invalid JSON body", async () => {
    resolveAdmin.mockResolvedValueOnce({ userId: "admin-1", email: "admin@test.com" });
    const req = new Request("http://localhost:7020/api/admin/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid JSON");
  });

  it("should default count to 1 when not provided", async () => {
    resolveAdmin.mockResolvedValueOnce({ userId: "admin-1", email: "admin@test.com" });
    mockDbRead.checkInviteCodeExists.mockResolvedValue(null);
    mockDbWrite.execute.mockResolvedValue({ changes: 1, duration: 0.01 });

    const res = await POST(makeJsonRequest("POST", "/api/admin/invites", {}));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.codes).toHaveLength(1);
  });

  it("should reject non-integer count like 1.5", async () => {
    resolveAdmin.mockResolvedValueOnce({ userId: "admin-1", email: "admin@test.com" });
    const res = await POST(makeJsonRequest("POST", "/api/admin/invites", { count: 1.5 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("count must be a positive integer");
  });

  it("should retry on code collision and succeed", async () => {
    resolveAdmin.mockResolvedValueOnce({ userId: "admin-1", email: "admin@test.com" });
    // First call: collision (code exists), second call: no collision
    mockDbRead.checkInviteCodeExists.mockResolvedValueOnce({ id: 1 }).mockResolvedValueOnce(null);
    mockDbWrite.execute.mockResolvedValue({ changes: 1, duration: 0.01 });

    const res = await POST(makeJsonRequest("POST", "/api/admin/invites", { count: 1 }));
    expect(res.status).toBe(201);
    expect(mockDbRead.checkInviteCodeExists).toHaveBeenCalledTimes(2);
  });

  it("should return 500 after exceeding collision retry limit", async () => {
    resolveAdmin.mockResolvedValueOnce({ userId: "admin-1", email: "admin@test.com" });
    // Always collision
    mockDbRead.checkInviteCodeExists.mockResolvedValue({ id: 1 });

    const res = await POST(makeJsonRequest("POST", "/api/admin/invites", { count: 1 }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain("unique code after retries");
  });

  it("should return 500 when dbWrite.execute fails", async () => {
    resolveAdmin.mockResolvedValueOnce({ userId: "admin-1", email: "admin@test.com" });
    mockDbRead.checkInviteCodeExists.mockResolvedValue(null);
    mockDbWrite.execute.mockRejectedValueOnce(new Error("D1 write failed"));

    const res = await POST(makeJsonRequest("POST", "/api/admin/invites", { count: 1 }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("Failed to generate invite codes");
  });

  it("should reject count < 1", async () => {
    resolveAdmin.mockResolvedValueOnce({
      userId: "admin-1",
      email: "admin@test.com",
    });
    const res = await POST(makeJsonRequest("POST", "/api/admin/invites", { count: 0 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("count must be a positive integer");
  });
});

describe("DELETE /api/admin/invites", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;
  let mockDbWrite: ReturnType<typeof createMockDbWrite>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    mockDbWrite = createMockDbWrite();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as never);
    vi.mocked(dbModule.getDbWrite).mockResolvedValue(mockDbWrite as never);
  });

  it("should return 403 for non-admin", async () => {
    resolveAdmin.mockResolvedValueOnce(null);
    const res = await DELETE(makeJsonRequest("DELETE", "/api/admin/invites?id=1"));
    expect(res.status).toBe(403);
  });

  it("should return 400 without id parameter", async () => {
    resolveAdmin.mockResolvedValueOnce({
      userId: "admin-1",
      email: "admin@test.com",
    });
    const res = await DELETE(makeJsonRequest("DELETE", "/api/admin/invites"));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("id query parameter is required");
  });

  it("should return 400 for non-integer id like '1abc'", async () => {
    resolveAdmin.mockResolvedValueOnce({
      userId: "admin-1",
      email: "admin@test.com",
    });
    const res = await DELETE(makeJsonRequest("DELETE", "/api/admin/invites?id=1abc"));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid id");
  });

  it("should return 400 for negative id", async () => {
    resolveAdmin.mockResolvedValueOnce({
      userId: "admin-1",
      email: "admin@test.com",
    });
    const res = await DELETE(makeJsonRequest("DELETE", "/api/admin/invites?id=-1"));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid id");
  });

  it("should delete unused code (atomic DELETE succeeds)", async () => {
    resolveAdmin.mockResolvedValueOnce({
      userId: "admin-1",
      email: "admin@test.com",
    });
    // Atomic DELETE matches (unused or pending:*)
    mockDbWrite.execute.mockResolvedValueOnce({ changes: 1, duration: 0.01 });

    const res = await DELETE(makeJsonRequest("DELETE", "/api/admin/invites?id=1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.deleted).toBe(true);
    // Should NOT have called getInviteCodeById (no fallback needed)
    expect(mockDbRead.getInviteCodeById).not.toHaveBeenCalled();
  });

  it("should delete burned pending:* code (atomic DELETE succeeds)", async () => {
    resolveAdmin.mockResolvedValueOnce({
      userId: "admin-1",
      email: "admin@test.com",
    });
    // Atomic DELETE matches (pending:* code)
    mockDbWrite.execute.mockResolvedValueOnce({ changes: 1, duration: 0.01 });

    const res = await DELETE(makeJsonRequest("DELETE", "/api/admin/invites?id=2"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.deleted).toBe(true);
  });

  it("should return 409 for fully used code (real user ID)", async () => {
    resolveAdmin.mockResolvedValueOnce({
      userId: "admin-1",
      email: "admin@test.com",
    });
    // Atomic DELETE didn't match (code is fully consumed)
    mockDbWrite.execute.mockResolvedValueOnce({ changes: 0, duration: 0.01 });
    // Fallback getInviteCodeById finds the row with a real user ID
    mockDbRead.getInviteCodeById.mockResolvedValueOnce({
      used_by: "user-uuid-abc123",
    });

    const res = await DELETE(makeJsonRequest("DELETE", "/api/admin/invites?id=3"));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("Cannot delete a used invite code");
  });

  it("should return 404 when code does not exist", async () => {
    resolveAdmin.mockResolvedValueOnce({
      userId: "admin-1",
      email: "admin@test.com",
    });
    // Atomic DELETE didn't match (no such row)
    mockDbWrite.execute.mockResolvedValueOnce({ changes: 0, duration: 0.01 });
    // Fallback getInviteCodeById also finds nothing
    mockDbRead.getInviteCodeById.mockResolvedValueOnce(null);

    const res = await DELETE(makeJsonRequest("DELETE", "/api/admin/invites?id=999"));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("Code not found");
  });

  it("should return 400 for id=0", async () => {
    resolveAdmin.mockResolvedValueOnce({ userId: "admin-1", email: "admin@test.com" });
    const res = await DELETE(makeJsonRequest("DELETE", "/api/admin/invites?id=0"));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid id");
  });

  it("should return 500 when dbWrite.execute throws", async () => {
    resolveAdmin.mockResolvedValueOnce({ userId: "admin-1", email: "admin@test.com" });
    mockDbWrite.execute.mockRejectedValueOnce(new Error("D1 write failed"));

    const res = await DELETE(makeJsonRequest("DELETE", "/api/admin/invites?id=1"));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("Failed to delete invite code");
  });
});
