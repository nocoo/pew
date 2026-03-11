import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be before imports that trigger the module chain
// ---------------------------------------------------------------------------

vi.mock("@/lib/d1", () => ({
  getD1Client: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({
  resolveAdmin: vi.fn(),
}));

vi.mock("@/auth", () => ({
  shouldUseSecureCookies: vi.fn(() => false),
}));

import { POST } from "@/app/api/admin/seasons/[seasonId]/snapshot/route";
import * as d1Module from "@/lib/d1";

const { resolveAdmin } = (await import("@/lib/admin")) as unknown as {
  resolveAdmin: ReturnType<typeof vi.fn>;
};

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
  url = "http://localhost:7030/api/admin/seasons/season-1/snapshot"
): Request {
  return new Request(url, { method: "POST" });
}

const ADMIN = { userId: "admin-1", email: "admin@test.com" };
const routeParams = Promise.resolve({ seasonId: "season-1" });

// An ended season (both dates in the past)
const ENDED_SEASON = {
  id: "season-1",
  start_date: "2026-01-01",
  end_date: "2026-01-31",
};

// An active season (end date in the future)
const ACTIVE_SEASON = {
  id: "season-1",
  start_date: "2026-03-01",
  end_date: "2026-12-31",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/admin/seasons/[seasonId]/snapshot", () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    vi.mocked(d1Module.getD1Client).mockReturnValue(
      mockClient as unknown as d1Module.D1Client
    );
  });

  it("should create snapshots for all registered teams", async () => {
    resolveAdmin.mockResolvedValueOnce(ADMIN);
    // Season lookup
    mockClient.firstOrNull.mockResolvedValueOnce(ENDED_SEASON);
    // Team aggregation: two teams
    mockClient.query.mockResolvedValueOnce({
      results: [
        {
          team_id: "team-a",
          total_tokens: 15000,
          input_tokens: 10000,
          output_tokens: 5000,
          cached_input_tokens: 3000,
        },
        {
          team_id: "team-b",
          total_tokens: 8000,
          input_tokens: 5000,
          output_tokens: 3000,
          cached_input_tokens: 1000,
        },
      ],
    });
    // Member aggregation
    mockClient.query.mockResolvedValueOnce({
      results: [
        {
          team_id: "team-a",
          user_id: "user-1",
          total_tokens: 9000,
          input_tokens: 6000,
          output_tokens: 3000,
          cached_input_tokens: 2000,
        },
        {
          team_id: "team-a",
          user_id: "user-2",
          total_tokens: 6000,
          input_tokens: 4000,
          output_tokens: 2000,
          cached_input_tokens: 1000,
        },
        {
          team_id: "team-b",
          user_id: "user-3",
          total_tokens: 8000,
          input_tokens: 5000,
          output_tokens: 3000,
          cached_input_tokens: 1000,
        },
      ],
    });
    // DELETE old snapshots (member + team)
    mockClient.execute.mockResolvedValueOnce(undefined);
    mockClient.execute.mockResolvedValueOnce(undefined);
    // INSERT team snapshots (2 teams)
    mockClient.execute.mockResolvedValueOnce(undefined);
    mockClient.execute.mockResolvedValueOnce(undefined);
    // INSERT member snapshots (3 members)
    mockClient.execute.mockResolvedValueOnce(undefined);
    mockClient.execute.mockResolvedValueOnce(undefined);
    mockClient.execute.mockResolvedValueOnce(undefined);

    const res = await POST(makeRequest(), { params: routeParams });
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.team_count).toBe(2);
    expect(data.member_count).toBe(3);
    expect(data.season_id).toBe("season-1");
    expect(data.created_at).toBeDefined();
  });

  it("should create member snapshots for all team members", async () => {
    resolveAdmin.mockResolvedValueOnce(ADMIN);
    mockClient.firstOrNull.mockResolvedValueOnce(ENDED_SEASON);
    // Team aggregation: one team
    mockClient.query.mockResolvedValueOnce({
      results: [
        {
          team_id: "team-a",
          total_tokens: 20000,
          input_tokens: 12000,
          output_tokens: 8000,
          cached_input_tokens: 5000,
        },
      ],
    });
    // Member aggregation: two members
    mockClient.query.mockResolvedValueOnce({
      results: [
        {
          team_id: "team-a",
          user_id: "user-1",
          total_tokens: 12000,
          input_tokens: 7000,
          output_tokens: 5000,
          cached_input_tokens: 3000,
        },
        {
          team_id: "team-a",
          user_id: "user-2",
          total_tokens: 8000,
          input_tokens: 5000,
          output_tokens: 3000,
          cached_input_tokens: 2000,
        },
      ],
    });
    // DELETEs + INSERTs
    mockClient.execute.mockResolvedValue(undefined);

    const res = await POST(makeRequest(), { params: routeParams });
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.member_count).toBe(2);

    // Verify member INSERT calls: 2 DELETEs + 1 team INSERT + 2 member INSERTs = 5
    // Check that member INSERT SQL contains season_member_snapshots
    const executeCalls = mockClient.execute.mock.calls;
    const memberInserts = executeCalls.filter((call) =>
      (call[0] as string).includes("season_member_snapshots")
    );
    // 1 DELETE + 2 INSERTs = 3 calls to season_member_snapshots
    expect(memberInserts.length).toBe(3);
  });

  it("should compute correct ranks by total_tokens DESC", async () => {
    resolveAdmin.mockResolvedValueOnce(ADMIN);
    mockClient.firstOrNull.mockResolvedValueOnce(ENDED_SEASON);
    // Teams ordered by total_tokens DESC (the route's SQL has ORDER BY total_tokens DESC)
    mockClient.query.mockResolvedValueOnce({
      results: [
        {
          team_id: "team-a",
          total_tokens: 20000,
          input_tokens: 12000,
          output_tokens: 8000,
          cached_input_tokens: 5000,
        },
        {
          team_id: "team-b",
          total_tokens: 10000,
          input_tokens: 6000,
          output_tokens: 4000,
          cached_input_tokens: 2000,
        },
        {
          team_id: "team-c",
          total_tokens: 5000,
          input_tokens: 3000,
          output_tokens: 2000,
          cached_input_tokens: 1000,
        },
      ],
    });
    // No members (simplified)
    mockClient.query.mockResolvedValueOnce({ results: [] });
    // DELETEs + INSERTs
    mockClient.execute.mockResolvedValue(undefined);

    await POST(makeRequest(), { params: routeParams });

    // Verify team INSERT calls contain correct ranks
    const executeCalls = mockClient.execute.mock.calls;
    const teamInserts = executeCalls.filter((call) =>
      (call[0] as string).includes("INSERT INTO season_snapshots")
    );

    expect(teamInserts.length).toBe(3);
    // Rank is the 4th param (index 3) in the INSERT params array
    expect((teamInserts[0]![1] as unknown[])[3]).toBe(1); // team-a: rank 1
    expect((teamInserts[1]![1] as unknown[])[3]).toBe(2); // team-b: rank 2
    expect((teamInserts[2]![1] as unknown[])[3]).toBe(3); // team-c: rank 3
  });

  it("should be idempotent (re-run produces same result)", async () => {
    resolveAdmin.mockResolvedValueOnce(ADMIN);
    mockClient.firstOrNull.mockResolvedValueOnce(ENDED_SEASON);
    mockClient.query.mockResolvedValueOnce({
      results: [
        {
          team_id: "team-a",
          total_tokens: 15000,
          input_tokens: 10000,
          output_tokens: 5000,
          cached_input_tokens: 3000,
        },
      ],
    });
    mockClient.query.mockResolvedValueOnce({
      results: [
        {
          team_id: "team-a",
          user_id: "user-1",
          total_tokens: 15000,
          input_tokens: 10000,
          output_tokens: 5000,
          cached_input_tokens: 3000,
        },
      ],
    });
    mockClient.execute.mockResolvedValue(undefined);

    const res = await POST(makeRequest(), { params: routeParams });
    const data = await res.json();

    expect(res.status).toBe(201);

    // Verify DELETE is called before INSERT (idempotent cleanup)
    const executeCalls = mockClient.execute.mock.calls;
    const deleteIdx = executeCalls.findIndex((call) =>
      (call[0] as string).includes("DELETE FROM season_snapshots")
    );
    const insertIdx = executeCalls.findIndex((call) =>
      (call[0] as string).includes("INSERT INTO season_snapshots")
    );
    expect(deleteIdx).toBeLessThan(insertIdx);
    expect(deleteIdx).toBeGreaterThanOrEqual(0);

    // Also verify member snapshots are deleted before re-insert
    const memberDeleteIdx = executeCalls.findIndex((call) =>
      (call[0] as string).includes("DELETE FROM season_member_snapshots")
    );
    expect(memberDeleteIdx).toBeLessThan(insertIdx);
    expect(data.team_count).toBe(1);
    expect(data.member_count).toBe(1);
  });

  it("should reject non-ended season", async () => {
    resolveAdmin.mockResolvedValueOnce(ADMIN);
    mockClient.firstOrNull.mockResolvedValueOnce(ACTIVE_SEASON);

    const res = await POST(makeRequest(), { params: routeParams });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain("ended");
  });

  it("should reject non-admin users", async () => {
    resolveAdmin.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(), { params: routeParams });
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.error).toContain("Forbidden");
  });

  it("should return 404 for non-existent season", async () => {
    resolveAdmin.mockResolvedValueOnce(ADMIN);
    mockClient.firstOrNull.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(), { params: routeParams });
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.error).toContain("Season not found");
  });

  it("should handle no-such-table gracefully", async () => {
    resolveAdmin.mockResolvedValueOnce(ADMIN);
    mockClient.firstOrNull.mockRejectedValueOnce(
      new Error("no such table: seasons")
    );

    const res = await POST(makeRequest(), { params: routeParams });
    const data = await res.json();

    expect(res.status).toBe(503);
    expect(data.error).toContain("not yet migrated");
  });
});
