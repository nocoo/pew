import { describe, it, expect, vi, beforeEach } from "vitest";
import * as dbModule from "@/lib/db";
import { createMockDbRead } from "./test-utils";

const mockResolveAdmin = vi.fn();

vi.mock("@/lib/admin", () => ({
  resolveAdmin: (...args: unknown[]) => mockResolveAdmin(...args),
}));

vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
  getDbWrite: vi.fn(),
  resetDb: vi.fn(),
}));

import { GET } from "@/app/api/admin/storage/route";

describe("GET /api/admin/storage", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;

  function createRequest() {
    return new Request("http://localhost/api/admin/storage", {
      method: "GET",
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as any);
  });

  it("should return 403 when not admin", async () => {
    mockResolveAdmin.mockResolvedValue(null);

    const response = await GET(createRequest());

    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBe("Forbidden");
  });

  it("should return user storage stats for admin", async () => {
    mockResolveAdmin.mockResolvedValue({ userId: "admin-1" });
    mockDbRead.getAdminStorageStats.mockResolvedValue([
      {
        user_id: "user-1",
        slug: "alice",
        email: "alice@example.com",
        name: "Alice",
        image: null,
        team_count: 2,
        device_count: 3,
        total_tokens: 1000000,
        tokens_7d: 100000,
        tokens_30d: 500000,
        usage_row_count: 100,
        session_count: 50,
        total_messages: 200,
        total_duration_seconds: 3600,
        first_seen: "2026-01-01T00:00:00Z",
        last_seen: "2026-04-06T00:00:00Z",
      },
      {
        user_id: "user-2",
        slug: "bob",
        email: "bob@example.com",
        name: "Bob",
        image: null,
        team_count: 1,
        device_count: 1,
        total_tokens: 500000,
        tokens_7d: 50000,
        tokens_30d: 200000,
        usage_row_count: 50,
        session_count: 25,
        total_messages: 100,
        total_duration_seconds: 1800,
        first_seen: "2026-02-01T00:00:00Z",
        last_seen: "2026-04-05T00:00:00Z",
      },
    ]);

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.users).toHaveLength(2);
    expect(data.summary.total_users).toBe(2);
    expect(data.summary.total_tokens).toBe(1500000);
    expect(data.summary.total_sessions).toBe(75);
    expect(data.summary.total_usage_rows).toBe(150);
    expect(data.summary.total_messages).toBe(300);
    expect(data.summary.total_duration_seconds).toBe(5400);
  });

  it("should return empty results when tables do not exist", async () => {
    mockResolveAdmin.mockResolvedValue({ userId: "admin-1" });
    mockDbRead.getAdminStorageStats.mockRejectedValue(new Error("no such table: users"));

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.users).toEqual([]);
    expect(data.summary).toEqual({
      total_users: 0,
      total_tokens: 0,
      total_sessions: 0,
      total_usage_rows: 0,
      total_messages: 0,
      total_duration_seconds: 0,
    });
  });

  it("returns 500 when a non-Error value is thrown (err instanceof Error false-branch)", async () => {
    mockResolveAdmin.mockResolvedValue({ userId: "admin-1" });
    // Throw a plain string — covers the `err instanceof Error ? ... : ""` false path.
    mockDbRead.getAdminStorageStats.mockRejectedValue("some non-error value");

    const response = await GET(createRequest());
    expect(response.status).toBe(500);
    const data = (await response.json()) as { error: string };
    expect(data.error).toBe("Failed to load storage stats");
  });

  it("should return 500 on unexpected error", async () => {
    mockResolveAdmin.mockResolvedValue({ userId: "admin-1" });
    mockDbRead.getAdminStorageStats.mockRejectedValue(new Error("Connection timeout"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET(createRequest());

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toContain("Failed to load storage stats");
    consoleSpy.mockRestore();
  });
});
