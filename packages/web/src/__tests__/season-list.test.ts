import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
  getDbWrite: vi.fn(),
  resetDb: vi.fn(),
}));

vi.mock("@/lib/seasons", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/seasons")>();
  return { ...actual };
});

vi.mock("@/auth", () => ({
  shouldUseSecureCookies: vi.fn(() => false),
}));

import { GET } from "@/app/api/seasons/route";
import * as dbModule from "@/lib/db";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockClient() {
  return {
    query: vi.fn(),
    execute: vi.fn(),
    batch: vi.fn(),
    firstOrNull: vi.fn(),
  };
}

function makeRequest(
  url = "http://localhost:7030/api/seasons"
): Request {
  return new Request(url, { method: "GET" });
}

// Today is used by deriveSeasonStatus via Date — we freeze it.
const NOW = new Date("2026-03-11T12:00:00Z");

// Season fixtures with different derived statuses relative to NOW (2026-03-11)
const ACTIVE_SEASON_ROW = {
  id: "s1",
  name: "Season 1",
  slug: "s1",
  start_date: "2026-03-01T00:00:00Z",
  end_date: "2026-03-31T23:59:00Z",
  created_at: "2026-02-20T00:00:00Z",
  team_count: 3,
  has_snapshot: 0,
  allow_late_registration: 0,
  allow_late_withdrawal: 0,
};

const UPCOMING_SEASON_ROW = {
  id: "s2",
  name: "Season 2",
  slug: "s2",
  start_date: "2026-04-01T00:00:00Z",
  end_date: "2026-04-30T23:59:00Z",
  created_at: "2026-03-01T00:00:00Z",
  team_count: 1,
  has_snapshot: 0,
  allow_late_registration: 0,
  allow_late_withdrawal: 0,
};

const ENDED_SEASON_ROW = {
  id: "s3",
  name: "Season 0",
  slug: "s0",
  start_date: "2026-01-01T00:00:00Z",
  end_date: "2026-01-31T23:59:00Z",
  created_at: "2025-12-15T00:00:00Z",
  team_count: 5,
  has_snapshot: 1,
  allow_late_registration: 0,
  allow_late_withdrawal: 0,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/seasons", () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mockClient = createMockClient();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(
      mockClient as any
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should return all seasons with computed status", async () => {
    mockClient.query.mockResolvedValueOnce({
      results: [ACTIVE_SEASON_ROW, UPCOMING_SEASON_ROW, ENDED_SEASON_ROW],
    });

    const res = await GET(makeRequest());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.seasons).toHaveLength(3);

    // Verify computed status
    const statuses = data.seasons.map(
      (s: { status: string }) => s.status
    );
    expect(statuses).toContain("active");
    expect(statuses).toContain("upcoming");
    expect(statuses).toContain("ended");
  });

  it("should filter by status parameter", async () => {
    mockClient.query.mockResolvedValueOnce({
      results: [ACTIVE_SEASON_ROW, UPCOMING_SEASON_ROW, ENDED_SEASON_ROW],
    });

    const res = await GET(
      makeRequest("http://localhost:7030/api/seasons?status=active")
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.seasons).toHaveLength(1);
    expect(data.seasons[0].status).toBe("active");
    expect(data.seasons[0].id).toBe("s1");
  });

  it("should include team_count and has_snapshot", async () => {
    mockClient.query.mockResolvedValueOnce({
      results: [ACTIVE_SEASON_ROW, ENDED_SEASON_ROW],
    });

    const res = await GET(makeRequest());
    const data = await res.json();

    expect(res.status).toBe(200);

    // Active season: team_count=3, has_snapshot=false
    const active = data.seasons.find(
      (s: { id: string }) => s.id === "s1"
    );
    expect(active.team_count).toBe(3);
    expect(active.has_snapshot).toBe(false);

    // Ended season: team_count=5, has_snapshot=true
    const ended = data.seasons.find(
      (s: { id: string }) => s.id === "s3"
    );
    expect(ended.team_count).toBe(5);
    expect(ended.has_snapshot).toBe(true);
  });

  it("should sort active > upcoming > ended", async () => {
    // Return them in "wrong" order: ended, upcoming, active
    mockClient.query.mockResolvedValueOnce({
      results: [ENDED_SEASON_ROW, UPCOMING_SEASON_ROW, ACTIVE_SEASON_ROW],
    });

    const res = await GET(makeRequest());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.seasons).toHaveLength(3);
    // Sorted: active first, then upcoming, then ended
    expect(data.seasons[0].status).toBe("active");
    expect(data.seasons[1].status).toBe("upcoming");
    expect(data.seasons[2].status).toBe("ended");
  });

  it("should handle no-such-table gracefully", async () => {
    mockClient.query.mockRejectedValueOnce(
      new Error("no such table: seasons")
    );

    const res = await GET(makeRequest());
    const data = await res.json();

    // Returns empty array instead of error for public endpoint
    expect(res.status).toBe(200);
    expect(data.seasons).toEqual([]);
  });

  it("should return 400 for invalid status filter", async () => {
    const res = await GET(
      makeRequest("http://localhost:7030/api/seasons?status=invalid")
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain("Invalid status filter");
  });

  it("should return empty seasons array when no seasons exist", async () => {
    mockClient.query.mockResolvedValueOnce({ results: [] });

    const res = await GET(makeRequest());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.seasons).toEqual([]);
  });

  it("should include allow_late_registration and allow_late_withdrawal flags", async () => {
    const withLateReg = {
      ...ACTIVE_SEASON_ROW,
      allow_late_registration: 1,
      allow_late_withdrawal: 1,
    };
    mockClient.query.mockResolvedValueOnce({
      results: [withLateReg, UPCOMING_SEASON_ROW],
    });

    const res = await GET(makeRequest());
    const data = await res.json();

    expect(res.status).toBe(200);
    const active = data.seasons.find(
      (s: { id: string }) => s.id === "s1"
    );
    expect(active.allow_late_registration).toBe(true);
    expect(active.allow_late_withdrawal).toBe(true);

    const upcoming = data.seasons.find(
      (s: { id: string }) => s.id === "s2"
    );
    expect(upcoming.allow_late_registration).toBe(false);
    expect(upcoming.allow_late_withdrawal).toBe(false);
  });
});
