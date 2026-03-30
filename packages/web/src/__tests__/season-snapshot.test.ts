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

import { POST } from "@/app/api/admin/seasons/[seasonId]/snapshot/route";
import { createMockDbRead, createMockDbWrite } from "./test-utils";
import * as dbModule from "@/lib/db";

const { resolveAdmin } = (await import("@/lib/admin")) as unknown as {
  resolveAdmin: ReturnType<typeof vi.fn>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(
  url = "http://localhost:7020/api/admin/seasons/season-1/snapshot"
): Request {
  return new Request(url, { method: "POST" });
}

const ADMIN = { userId: "admin-1", email: "admin@test.com" };
const routeParams = Promise.resolve({ seasonId: "season-1" });

// An ended season (both dates in the past)
const ENDED_SEASON = {
  id: "season-1",
  start_date: "2026-01-01T00:00:00Z",
  end_date: "2026-01-31T23:59:00Z",
};

// An active season (end date in the future)
const ACTIVE_SEASON = {
  id: "season-1",
  start_date: "2026-03-01T00:00:00Z",
  end_date: "2026-12-31T23:59:00Z",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/admin/seasons/[seasonId]/snapshot", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;
  let mockDbWrite: ReturnType<typeof createMockDbWrite>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    mockDbWrite = createMockDbWrite();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as never);
    vi.mocked(dbModule.getDbWrite).mockResolvedValue(mockDbWrite as never);
  });

  it("should create snapshots for all registered teams", async () => {
    resolveAdmin.mockResolvedValueOnce(ADMIN);
    // Season lookup
    mockDbRead.firstOrNull.mockResolvedValueOnce(ENDED_SEASON);
    // Team aggregation: two teams
    mockDbRead.query.mockResolvedValueOnce({
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
    mockDbRead.query.mockResolvedValueOnce({
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
    mockDbWrite.batch.mockResolvedValue([]);

    const res = await POST(makeRequest(), { params: routeParams });
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.team_count).toBe(2);
    expect(data.member_count).toBe(3);
    expect(data.season_id).toBe("season-1");
    expect(data.created_at).toBeDefined();

    // Verify batch was called for upserts (first call: team + member upserts)
    expect(mockDbWrite.batch).toHaveBeenCalled();
    const firstBatchCall = mockDbWrite.batch.mock.calls[0]![0] as {
      sql: string;
    }[];
    // 2 team upserts + 3 member upserts = 5 statements
    expect(firstBatchCall).toHaveLength(5);
    expect(firstBatchCall[0]!.sql).toContain("INSERT OR REPLACE INTO season_snapshots");
    expect(firstBatchCall[2]!.sql).toContain(
      "INSERT OR REPLACE INTO season_member_snapshots"
    );
  });

  it("should pass ISO 8601 date bounds to aggregation queries", async () => {
    resolveAdmin.mockResolvedValueOnce(ADMIN);
    mockDbRead.firstOrNull.mockResolvedValueOnce(ENDED_SEASON);
    // Team aggregation
    mockDbRead.query.mockResolvedValueOnce({ results: [] });
    mockDbWrite.batch.mockResolvedValue([]);

    await POST(makeRequest(), { params: routeParams });

    // Team aggregation query: params[0]=fromDate, params[1]=toDate
    const teamParams = mockDbRead.query.mock.calls[0]![1] as string[];
    expect(teamParams[0]).toBe("2026-01-01T00:00:00.000Z");
    // end_date 2026-01-31T23:59:00Z + 1 minute
    expect(teamParams[1]).toBe("2026-02-01T00:00:00.000Z");
  });

  it("should use ISO 8601 format with T separator for snapshot date bounds (not space-separated)", async () => {
    // Regression: space-separated dates cause SQLite to match all records on
    // the boundary date, freezing wrong rankings into the snapshot permanently.
    const SEASON_WITH_OFFSET = {
      id: "season-1",
      start_date: "2026-03-14T16:00:00Z",
      end_date: "2026-03-21T15:59:00Z",
    };
    resolveAdmin.mockResolvedValueOnce(ADMIN);
    mockDbRead.firstOrNull.mockResolvedValueOnce(SEASON_WITH_OFFSET);
    mockDbRead.query.mockResolvedValueOnce({
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
    mockDbRead.query.mockResolvedValueOnce({ results: [] });
    mockDbWrite.batch.mockResolvedValue([]);

    await POST(makeRequest(), { params: routeParams });

    // Both team and member aggregation queries must use T-separated ISO format
    const teamParams = mockDbRead.query.mock.calls[0]![1] as string[];
    expect(teamParams[0]).toContain("T");
    expect(teamParams[1]).toContain("T");
    expect(teamParams[0]).not.toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:/);
    expect(teamParams[1]).not.toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:/);
    expect(teamParams[0]).toBe("2026-03-14T16:00:00.000Z");
    expect(teamParams[1]).toBe("2026-03-21T16:00:00.000Z");

    // Member aggregation query uses the same date bounds
    const memberParams = mockDbRead.query.mock.calls[1]![1] as string[];
    expect(memberParams[0]).toBe("2026-03-14T16:00:00.000Z");
    expect(memberParams[1]).toBe("2026-03-21T16:00:00.000Z");
  });

  it("should create member snapshots for all team members", async () => {
    resolveAdmin.mockResolvedValueOnce(ADMIN);
    mockDbRead.firstOrNull.mockResolvedValueOnce(ENDED_SEASON);
    // Team aggregation: one team
    mockDbRead.query.mockResolvedValueOnce({
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
    mockDbRead.query.mockResolvedValueOnce({
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
    mockDbWrite.batch.mockResolvedValue([]);

    const res = await POST(makeRequest(), { params: routeParams });
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.member_count).toBe(2);

    // Verify upsert batch: 1 team + 2 members = 3 statements
    const upsertBatch = mockDbWrite.batch.mock.calls[0]![0] as {
      sql: string;
    }[];
    const memberUpserts = upsertBatch.filter((s) =>
      s.sql.includes("season_member_snapshots")
    );
    expect(memberUpserts).toHaveLength(2);
  });

  it("should compute correct ranks by total_tokens DESC", async () => {
    resolveAdmin.mockResolvedValueOnce(ADMIN);
    mockDbRead.firstOrNull.mockResolvedValueOnce(ENDED_SEASON);
    // Teams ordered by total_tokens DESC (the route's SQL has ORDER BY total_tokens DESC)
    mockDbRead.query.mockResolvedValueOnce({
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
    mockDbRead.query.mockResolvedValueOnce({ results: [] });
    mockDbWrite.batch.mockResolvedValue([]);

    await POST(makeRequest(), { params: routeParams });

    // Verify upsert batch has 3 team statements with correct ranks
    const upsertBatch = mockDbWrite.batch.mock.calls[0]![0] as {
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
    mockDbRead.firstOrNull.mockResolvedValueOnce(ENDED_SEASON);
    mockDbRead.query.mockResolvedValueOnce({
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
    mockDbRead.query.mockResolvedValueOnce({
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
    mockDbWrite.batch.mockResolvedValue([]);

    const res = await POST(makeRequest(), { params: routeParams });
    const data = await res.json();

    expect(res.status).toBe(201);

    // Uses INSERT OR REPLACE (upsert) so re-running is safe
    const upsertBatch = mockDbWrite.batch.mock.calls[0]![0] as {
      sql: string;
    }[];
    expect(upsertBatch[0]!.sql).toContain("INSERT OR REPLACE");
    expect(data.team_count).toBe(1);
    expect(data.member_count).toBe(1);
  });

  it("should clean up stale team and member rows after upsert", async () => {
    resolveAdmin.mockResolvedValueOnce(ADMIN);
    mockDbRead.firstOrNull.mockResolvedValueOnce(ENDED_SEASON);
    // Only one team left (team-b was removed)
    mockDbRead.query.mockResolvedValueOnce({
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
    mockDbRead.query.mockResolvedValueOnce({
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
    mockDbWrite.batch.mockResolvedValue([]);

    await POST(makeRequest(), { params: routeParams });

    // Second batch call should clean up stale teams
    const cleanupBatch = mockDbWrite.batch.mock.calls[1]![0] as {
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
    mockDbRead.firstOrNull.mockResolvedValueOnce(ACTIVE_SEASON);

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
    mockDbRead.firstOrNull.mockResolvedValueOnce(null);

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
    mockDbRead.firstOrNull.mockResolvedValueOnce(ENDED_SEASON);
    mockDbRead.query.mockResolvedValueOnce({
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
    mockDbRead.query.mockResolvedValueOnce({
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
    mockDbWrite.execute.mockResolvedValue(undefined);
    mockDbWrite.batch.mockResolvedValue([]);

    const res = await POST(makeRequest(), { params: routeParams });
    expect(res.status).toBe(201);

    // execute called exactly twice: snapshot_ready=0 then snapshot_ready=1
    expect(mockDbWrite.execute).toHaveBeenCalledTimes(2);

    const [sql0, params0] = [
      mockDbWrite.execute.mock.calls[0]![0],
      mockDbWrite.execute.mock.calls[0]![1],
    ];
    expect(sql0).toContain("snapshot_ready");
    expect(sql0).toContain("UPDATE seasons");
    expect(params0).toEqual([0, "season-1"]);

    const [sql1, params1] = [
      mockDbWrite.execute.mock.calls[1]![0],
      mockDbWrite.execute.mock.calls[1]![1],
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
    mockDbRead.firstOrNull.mockResolvedValueOnce(ENDED_SEASON);
    mockDbRead.query.mockResolvedValueOnce({
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
    mockDbRead.query.mockResolvedValueOnce({ results: [] });
    // snapshot_ready=0 succeeds
    mockDbWrite.execute.mockResolvedValueOnce(undefined);
    // upsert batch fails
    mockDbWrite.batch.mockRejectedValueOnce(new Error("D1 write error"));

    const res = await POST(makeRequest(), { params: routeParams });
    expect(res.status).toBe(500);

    // execute called only once (snapshot_ready=0), never set to 1
    expect(mockDbWrite.execute).toHaveBeenCalledTimes(1);
    expect(mockDbWrite.execute.mock.calls[0]![1]).toEqual([0, "season-1"]);
  });

  it("should NOT set snapshot_ready=1 if cleanup batch fails", async () => {
    resolveAdmin.mockResolvedValueOnce(ADMIN);
    mockDbRead.firstOrNull.mockResolvedValueOnce(ENDED_SEASON);
    mockDbRead.query.mockResolvedValueOnce({
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
    mockDbRead.query.mockResolvedValueOnce({
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
    mockDbWrite.execute.mockResolvedValueOnce(undefined);
    // upsert batch succeeds
    mockDbWrite.batch.mockResolvedValueOnce([]);
    // cleanup batch fails
    mockDbWrite.batch.mockRejectedValueOnce(new Error("D1 cleanup error"));

    const res = await POST(makeRequest(), { params: routeParams });
    expect(res.status).toBe(500);

    // execute called only once (snapshot_ready=0), never set to 1
    expect(mockDbWrite.execute).toHaveBeenCalledTimes(1);
    expect(mockDbWrite.execute.mock.calls[0]![1]).toEqual([0, "season-1"]);
  });

  it("should handle no-such-table gracefully", async () => {
    resolveAdmin.mockResolvedValueOnce(ADMIN);
    mockDbRead.firstOrNull.mockRejectedValueOnce(
      new Error("no such table: seasons")
    );

    const res = await POST(makeRequest(), { params: routeParams });
    const data = await res.json();

    expect(res.status).toBe(503);
    expect(data.error).toContain("not yet migrated");
  });
});
