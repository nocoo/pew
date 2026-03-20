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
import * as dbModule from "@/lib/db";

const { resolveAdmin } = (await import("@/lib/admin")) as unknown as {
  resolveAdmin: ReturnType<typeof vi.fn>;
};

function createMockDbRead() {
  return {
    query: vi.fn(),
    firstOrNull: vi.fn(),
  };
}

function createMockDbWrite() {
  return {
    execute: vi.fn(),
    batch: vi.fn(),
  };
}

function makeRequest(
  method: string,
  url = "http://localhost:7030/api/admin/invites",
  body?: unknown
): Request {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return new Request(url, init);
}

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
    const res = await GET(makeRequest("GET"));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("Forbidden");
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
    mockDbRead.query.mockResolvedValueOnce({ results: mockRows });

    const res = await GET(makeRequest("GET"));
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
    const res = await POST(makeRequest("POST", undefined, { count: 1 }));
    expect(res.status).toBe(403);
  });

  it("should generate N codes", async () => {
    resolveAdmin.mockResolvedValueOnce({
      userId: "admin-1",
      email: "admin@test.com",
    });
    // firstOrNull returns null (no collision)
    mockDbRead.firstOrNull.mockResolvedValue(null);
    mockDbWrite.execute.mockResolvedValue({ changes: 1, duration: 0.01 });

    const res = await POST(makeRequest("POST", undefined, { count: 3 }));
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
    const res = await POST(makeRequest("POST", undefined, { count: 21 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("count must be at most 20");
  });

  it("should reject count < 1", async () => {
    resolveAdmin.mockResolvedValueOnce({
      userId: "admin-1",
      email: "admin@test.com",
    });
    const res = await POST(makeRequest("POST", undefined, { count: 0 }));
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
    const res = await DELETE(
      makeRequest("DELETE", "http://localhost:7030/api/admin/invites?id=1")
    );
    expect(res.status).toBe(403);
  });

  it("should return 400 without id parameter", async () => {
    resolveAdmin.mockResolvedValueOnce({
      userId: "admin-1",
      email: "admin@test.com",
    });
    const res = await DELETE(makeRequest("DELETE"));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("id query parameter is required");
  });

  it("should return 400 for non-integer id like '1abc'", async () => {
    resolveAdmin.mockResolvedValueOnce({
      userId: "admin-1",
      email: "admin@test.com",
    });
    const res = await DELETE(
      makeRequest("DELETE", "http://localhost:7030/api/admin/invites?id=1abc")
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid id");
  });

  it("should return 400 for negative id", async () => {
    resolveAdmin.mockResolvedValueOnce({
      userId: "admin-1",
      email: "admin@test.com",
    });
    const res = await DELETE(
      makeRequest("DELETE", "http://localhost:7030/api/admin/invites?id=-1")
    );
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

    const res = await DELETE(
      makeRequest("DELETE", "http://localhost:7030/api/admin/invites?id=1")
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.deleted).toBe(true);
    // Should NOT have called firstOrNull (no fallback needed)
    expect(mockDbRead.firstOrNull).not.toHaveBeenCalled();
  });

  it("should delete burned pending:* code (atomic DELETE succeeds)", async () => {
    resolveAdmin.mockResolvedValueOnce({
      userId: "admin-1",
      email: "admin@test.com",
    });
    // Atomic DELETE matches (pending:* code)
    mockDbWrite.execute.mockResolvedValueOnce({ changes: 1, duration: 0.01 });

    const res = await DELETE(
      makeRequest("DELETE", "http://localhost:7030/api/admin/invites?id=2")
    );
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
    // Fallback SELECT finds the row with a real user ID
    mockDbRead.firstOrNull.mockResolvedValueOnce({
      used_by: "user-uuid-abc123",
    });

    const res = await DELETE(
      makeRequest("DELETE", "http://localhost:7030/api/admin/invites?id=3")
    );
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
    // Fallback SELECT also finds nothing
    mockDbRead.firstOrNull.mockResolvedValueOnce(null);

    const res = await DELETE(
      makeRequest("DELETE", "http://localhost:7030/api/admin/invites?id=999")
    );
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("Code not found");
  });
});
