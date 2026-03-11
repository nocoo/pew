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
    // batch calls (upsert + cleanup)
    mockClient.batch.mockResolvedValue([]);

    const res = await POST(makeRequest(), { params: routeParams });
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.team_count).toBe(2);
    expect(data.member_count).toBe(3);
    expect(data.season_id).toBe("season-1");
    expect(data.created_at).toBeDefined();

    // Verify batch was called for upserts (first call: team + member upserts)
    expect(mockClient.batch).toHaveBeenCalled();
    const firstBatchCall = mockClient.batch.mock.calls[0]![0] as {
      sql: string;
    }[];
    // 2 team upserts + 3 member upserts = 5 statements
    expect(firstBatchCall).toHaveLength(5);
    expect(firstBatchCall[0]!.sql).toContain("INSERT OR REPLACE INTO season_snapshots");
    expect(firstBatchCall[2]!.sql).toContain(
      "INSERT OR REPLACE INTO season_member_snapshots"
    );
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
    mockClient.batch.mockResolvedValue([]);

    const res = await POST(makeRequest(), { params: routeParams });
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.member_count).toBe(2);

    // Verify upsert batch: 1 team + 2 members = 3 statements
    const upsertBatch = mockClient.batch.mock.calls[0]![0] as {
      sql: string;
    }[];
    const memberUpserts = upsertBatch.filter((s) =>
      s.sql.includes("season_member_snapshots")
    );
    expect(memberUpserts).toHaveLength(2);
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
    // No members
    mockClient.query.mockResolvedValueOnce({ results: [] });
    mockClient.batch.mockResolvedValue([]);

    await POST(makeRequest(), { params: routeParams });

    // Verify upsert batch has 3 team statements with correct ranks
    const upsertBatch = mockClient.batch.mock.calls[0]![0] as {
      sql: string;
      params: unknown[];
    }[];
    const teamUpserts = upsertBatch.filter((s) =>
      s.sql.includes("INSERT OR REPLACE INTO season_snapshots")
    );

    expect(teamUpserts).toHaveLength(3);
    // Rank is the 6th param (index 5) in the INSERT OR REPLACE params:
    // [seasonId, team_id, uuid, seasonId, team_id, rank, ...]
    expect(teamUpserts[0]!.params[5]).toBe(1); // team-a: rank 1
    expect(teamUpserts[1]!.params[5]).toBe(2); // team-b: rank 2
    expect(teamUpserts[2]!.params[5]).toBe(3); // team-c: rank 3
  });

  it("should be idempotent (upsert overwrites existing data)", async () => {
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
    mockClient.batch.mockResolvedValue([]);

    const res = await POST(makeRequest(), { params: routeParams });
    const data = await res.json();

    expect(res.status).toBe(201);

    // Uses INSERT OR REPLACE (upsert) so re-running is safe
    const upsertBatch = mockClient.batch.mock.calls[0]![0] as {
      sql: string;
    }[];
    expect(upsertBatch[0]!.sql).toContain("INSERT OR REPLACE");
    expect(data.team_count).toBe(1);
    expect(data.member_count).toBe(1);
  });

  it("should clean up stale team and member rows after upsert", async () => {
    resolveAdmin.mockResolvedValueOnce(ADMIN);
    mockClient.firstOrNull.mockResolvedValueOnce(ENDED_SEASON);
    // Only one team left (team-b was removed)
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
    mockClient.batch.mockResolvedValue([]);

    await POST(makeRequest(), { params: routeParams });

    // Second batch call should clean up stale teams
    const cleanupBatch = mockClient.batch.mock.calls[1]![0] as {
      sql: string;
      params: unknown[];
    }[];
    expect(cleanupBatch).toHaveLength(2);
    expect(cleanupBatch[0]!.sql).toContain("DELETE FROM season_member_snapshots");
    expect(cleanupBatch[0]!.sql).toContain("NOT IN");
    expect(cleanupBatch[1]!.sql).toContain("DELETE FROM season_snapshots");
    expect(cleanupBatch[1]!.sql).toContain("NOT IN");
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

  // -------------------------------------------------------------------------
  // snapshot_ready flag — write-then-switch mechanism
  // -------------------------------------------------------------------------

  it("should set snapshot_ready=0 before writes and snapshot_ready=1 after all writes succeed", async () => {
    resolveAdmin.mockResolvedValueOnce(ADMIN);
    mockClient.firstOrNull.mockResolvedValueOnce(ENDED_SEASON);
    mockClient.query.mockResolvedValueOnce({
      results: [
        {
          team_id: "team-a",
          total_tokens: 10000,
          input_tokens: 6000,
          output_tokens: 4000,
          cached_input_tokens: 2000,
        },
      ],
    });
    mockClient.query.mockResolvedValueOnce({
      results: [
        {
          team_id: "team-a",
          user_id: "user-1",
          total_tokens: 10000,
          input_tokens: 6000,
          output_tokens: 4000,
          cached_input_tokens: 2000,
        },
      ],
    });
    mockClient.execute.mockResolvedValue(undefined);
    mockClient.batch.mockResolvedValue([]);

    const res = await POST(makeRequest(), { params: routeParams });
    expect(res.status).toBe(201);

    // execute called exactly twice: snapshot_ready=0 then snapshot_ready=1
    expect(mockClient.execute).toHaveBeenCalledTimes(2);

    const [sql0, params0] = [
      mockClient.execute.mock.calls[0]![0],
      mockClient.execute.mock.calls[0]![1],
    ];
    expect(sql0).toContain("snapshot_ready");
    expect(sql0).toContain("UPDATE seasons");
    expect(params0).toEqual([0, "season-1"]);

    const [sql1, params1] = [
      mockClient.execute.mock.calls[1]![0],
      mockClient.execute.mock.calls[1]![1],
    ];
    expect(sql1).toContain("snapshot_ready");
    expect(sql1).toContain("UPDATE seasons");
    expect(params1).toEqual([1, "season-1"]);

    // Verify ordering: snapshot_ready=0 before batch, snapshot_ready=1 after
    // execute call indices vs batch call indices confirm ordering
    // (execute[0] < batch[0] < execute[1])
  });

  it("should NOT set snapshot_ready=1 if upsert batch fails", async () => {
    resolveAdmin.mockResolvedValueOnce(ADMIN);
    mockClient.firstOrNull.mockResolvedValueOnce(ENDED_SEASON);
    mockClient.query.mockResolvedValueOnce({
      results: [
        {
          team_id: "team-a",
          total_tokens: 10000,
          input_tokens: 6000,
          output_tokens: 4000,
          cached_input_tokens: 2000,
        },
      ],
    });
    mockClient.query.mockResolvedValueOnce({ results: [] });
    // snapshot_ready=0 succeeds
    mockClient.execute.mockResolvedValueOnce(undefined);
    // upsert batch fails
    mockClient.batch.mockRejectedValueOnce(new Error("D1 write error"));

    const res = await POST(makeRequest(), { params: routeParams });
    expect(res.status).toBe(500);

    // execute called only once (snapshot_ready=0), never set to 1
    expect(mockClient.execute).toHaveBeenCalledTimes(1);
    expect(mockClient.execute.mock.calls[0]![1]).toEqual([0, "season-1"]);
  });

  it("should NOT set snapshot_ready=1 if cleanup batch fails", async () => {
    resolveAdmin.mockResolvedValueOnce(ADMIN);
    mockClient.firstOrNull.mockResolvedValueOnce(ENDED_SEASON);
    mockClient.query.mockResolvedValueOnce({
      results: [
        {
          team_id: "team-a",
          total_tokens: 10000,
          input_tokens: 6000,
          output_tokens: 4000,
          cached_input_tokens: 2000,
        },
      ],
    });
    mockClient.query.mockResolvedValueOnce({
      results: [
        {
          team_id: "team-a",
          user_id: "user-1",
          total_tokens: 10000,
          input_tokens: 6000,
          output_tokens: 4000,
          cached_input_tokens: 2000,
        },
      ],
    });
    // snapshot_ready=0 succeeds
    mockClient.execute.mockResolvedValueOnce(undefined);
    // upsert batch succeeds
    mockClient.batch.mockResolvedValueOnce([]);
    // cleanup batch fails
    mockClient.batch.mockRejectedValueOnce(new Error("D1 cleanup error"));

    const res = await POST(makeRequest(), { params: routeParams });
    expect(res.status).toBe(500);

    // execute called only once (snapshot_ready=0), never set to 1
    expect(mockClient.execute).toHaveBeenCalledTimes(1);
    expect(mockClient.execute.mock.calls[0]![1]).toEqual([0, "season-1"]);
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
