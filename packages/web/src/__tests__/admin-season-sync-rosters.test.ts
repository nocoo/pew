import { describe, it, expect, vi, beforeEach } from "vitest";

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

vi.mock("@/lib/season-roster", () => ({
  syncAllRostersForSeason: vi.fn(),
}));

vi.mock("@/auth", () => ({
  shouldUseSecureCookies: vi.fn(() => false),
}));

import { POST } from "@/app/api/admin/seasons/[seasonId]/sync-rosters/route";
import { createMockDbRead, createMockDbWrite } from "./test-utils";
import * as dbModule from "@/lib/db";

const { resolveAdmin } = (await import("@/lib/admin")) as unknown as {
  resolveAdmin: ReturnType<typeof vi.fn>;
};

const { syncAllRostersForSeason } = (await import(
  "@/lib/season-roster"
)) as unknown as {
  syncAllRostersForSeason: ReturnType<typeof vi.fn>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(): Request {
  return new Request(
    "http://localhost:7020/api/admin/seasons/season-1/sync-rosters",
    { method: "POST" },
  );
}

const ADMIN = { userId: "admin-1", email: "admin@test.com" };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/admin/seasons/[seasonId]/sync-rosters", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;
  let mockDbWrite: ReturnType<typeof createMockDbWrite>;
  const seasonParams = Promise.resolve({ seasonId: "season-1" });

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    mockDbWrite = createMockDbWrite();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as never);
    vi.mocked(dbModule.getDbWrite).mockResolvedValue(mockDbWrite as never);
  });

  it("should reject non-admin requests", async () => {
    resolveAdmin.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(), { params: seasonParams });
    expect(res.status).toBe(403);
  });

  it("should return 404 for non-existent season", async () => {
    resolveAdmin.mockResolvedValueOnce(ADMIN);
    mockDbRead.firstOrNull.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(), { params: seasonParams });
    expect(res.status).toBe(404);
  });

  it("should reject non-active seasons", async () => {
    resolveAdmin.mockResolvedValueOnce(ADMIN);
    // Future season → upcoming
    mockDbRead.firstOrNull.mockResolvedValueOnce({
      id: "season-1",
      start_date: "2099-01-01T00:00:00Z",
      end_date: "2099-12-31T00:00:00Z",
      allow_roster_changes: 1,
    });

    const res = await POST(makeRequest(), { params: seasonParams });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/active/i);
  });

  it("should reject when allow_roster_changes is disabled", async () => {
    resolveAdmin.mockResolvedValueOnce(ADMIN);
    // Active season, but roster changes off
    mockDbRead.firstOrNull.mockResolvedValueOnce({
      id: "season-1",
      start_date: "2020-01-01T00:00:00Z",
      end_date: "2099-12-31T00:00:00Z",
      allow_roster_changes: 0,
    });

    const res = await POST(makeRequest(), { params: seasonParams });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/roster changes/i);
  });

  it("should sync rosters and return team count", async () => {
    resolveAdmin.mockResolvedValueOnce(ADMIN);
    mockDbRead.firstOrNull.mockResolvedValueOnce({
      id: "season-1",
      start_date: "2020-01-01T00:00:00Z",
      end_date: "2099-12-31T00:00:00Z",
      allow_roster_changes: 1,
    });
    syncAllRostersForSeason.mockResolvedValueOnce(3);

    const res = await POST(makeRequest(), { params: seasonParams });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.synced_teams).toBe(3);

    expect(syncAllRostersForSeason).toHaveBeenCalledWith(
      mockDbRead,
      mockDbWrite,
      "season-1",
    );
  });
});
