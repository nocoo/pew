import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/d1", () => ({
  getD1Client: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  resolveUser: vi.fn(),
}));

vi.mock("@/auth", () => ({
  shouldUseSecureCookies: vi.fn(() => false),
}));

import { POST, DELETE } from "@/app/api/seasons/[seasonId]/register/route";
import * as d1Module from "@/lib/d1";

const { resolveUser } = (await import("@/lib/auth-helpers")) as unknown as {
  resolveUser: ReturnType<typeof vi.fn>;
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
  method: string,
  url = "http://localhost:7030/api/seasons/season-1/register",
  body?: unknown
): Request {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return new Request(url, init);
}

const USER = { userId: "user-1", email: "user@test.com" };
const regParams = Promise.resolve({ seasonId: "season-1" });

// ---------------------------------------------------------------------------
// POST /api/seasons/[seasonId]/register
// ---------------------------------------------------------------------------

describe("POST /api/seasons/[seasonId]/register", () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    vi.mocked(d1Module.getD1Client).mockReturnValue(
      mockClient as unknown as d1Module.D1Client
    );
  });

  it("should register team when user is owner and season is upcoming", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    // Season upcoming
    mockClient.firstOrNull
      .mockResolvedValueOnce({ id: "season-1", start_date: "2099-01-01", end_date: "2099-12-31" })
      // User is team owner
      .mockResolvedValueOnce({ role: "owner" })
      // No existing registration
      .mockResolvedValueOnce(null)
      // Pre-validation: no member conflict
      .mockResolvedValueOnce(null);
    // Fetch current team members
    mockClient.query.mockResolvedValueOnce({
      results: [{ user_id: "user-1" }, { user_id: "user-2" }],
    });
    // Batch write succeeds
    mockClient.batch.mockResolvedValueOnce(undefined);

    const res = await POST(makeRequest("POST", undefined, { team_id: "team-1" }), {
      params: regParams,
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.season_id).toBe("season-1");
    expect(json.team_id).toBe("team-1");

    // Verify frozen roster: fetch members then batch write
    expect(mockClient.query).toHaveBeenCalledWith(
      "SELECT user_id FROM team_members WHERE team_id = ?",
      ["team-1"]
    );
    expect(mockClient.batch).toHaveBeenCalledTimes(1);
    const batchStatements = mockClient.batch.mock.calls[0]![0] as Array<{ sql: string; params: unknown[] }>;
    // 1 season_teams INSERT + 2 season_team_members INSERTs
    expect(batchStatements).toHaveLength(3);
    expect(batchStatements[0]!.sql).toContain("season_teams");
    expect(batchStatements[1]!.sql).toContain("season_team_members");
    expect(batchStatements[2]!.sql).toContain("season_team_members");
  });

  it("should reject when a member is already registered on another team", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockClient.firstOrNull
      .mockResolvedValueOnce({ id: "season-1", start_date: "2099-01-01", end_date: "2099-12-31" })
      .mockResolvedValueOnce({ role: "owner" })
      .mockResolvedValueOnce(null)
      // Pre-validation: user-2 is already on another team
      .mockResolvedValueOnce({ user_id: "user-2" });
    mockClient.query.mockResolvedValueOnce({
      results: [{ user_id: "user-1" }, { user_id: "user-2" }],
    });

    const res = await POST(makeRequest("POST", undefined, { team_id: "team-1" }), {
      params: regParams,
    });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain("already registered");
    // No batch write should have happened
    expect(mockClient.batch).not.toHaveBeenCalled();
  });

  it("should reject when season is active", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockClient.firstOrNull.mockResolvedValueOnce({
      id: "season-1",
      start_date: "2020-01-01",
      end_date: "2099-12-31",
    });

    const res = await POST(makeRequest("POST", undefined, { team_id: "team-1" }), {
      params: regParams,
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("upcoming");
  });

  it("should reject when season is ended", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockClient.firstOrNull.mockResolvedValueOnce({
      id: "season-1",
      start_date: "2020-01-01",
      end_date: "2020-12-31",
    });

    const res = await POST(makeRequest("POST", undefined, { team_id: "team-1" }), {
      params: regParams,
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("upcoming");
  });

  it("should reject when user is not team owner", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockClient.firstOrNull
      .mockResolvedValueOnce({ id: "season-1", start_date: "2099-01-01", end_date: "2099-12-31" })
      .mockResolvedValueOnce({ role: "member" });

    const res = await POST(makeRequest("POST", undefined, { team_id: "team-1" }), {
      params: regParams,
    });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("owners");
  });

  it("should reject when team is already registered", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockClient.firstOrNull
      .mockResolvedValueOnce({ id: "season-1", start_date: "2099-01-01", end_date: "2099-12-31" })
      .mockResolvedValueOnce({ role: "owner" })
      .mockResolvedValueOnce({ id: "existing-reg" });

    const res = await POST(makeRequest("POST", undefined, { team_id: "team-1" }), {
      params: regParams,
    });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain("already registered");
  });

  it("should reject when season does not exist", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockClient.firstOrNull.mockResolvedValueOnce(null);

    const res = await POST(makeRequest("POST", undefined, { team_id: "team-1" }), {
      params: regParams,
    });
    expect(res.status).toBe(404);
  });

  it("should reject unauthenticated requests", async () => {
    resolveUser.mockResolvedValueOnce(null);

    const res = await POST(makeRequest("POST", undefined, { team_id: "team-1" }), {
      params: regParams,
    });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/seasons/[seasonId]/register
// ---------------------------------------------------------------------------

describe("DELETE /api/seasons/[seasonId]/register", () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    vi.mocked(d1Module.getD1Client).mockReturnValue(
      mockClient as unknown as d1Module.D1Client
    );
  });

  it("should withdraw team from upcoming season", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockClient.firstOrNull
      .mockResolvedValueOnce({ id: "season-1", start_date: "2099-01-01", end_date: "2099-12-31" })
      .mockResolvedValueOnce({ role: "owner" })
      .mockResolvedValueOnce({ id: "reg-1" });
    // DELETE season_team_members + DELETE season_teams
    mockClient.execute
      .mockResolvedValueOnce({ changes: 2, duration: 0.01 })
      .mockResolvedValueOnce({ changes: 1, duration: 0.01 });

    const res = await DELETE(makeRequest("DELETE", undefined, { team_id: "team-1" }), {
      params: regParams,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.deleted).toBe(true);

    // Verify both deletes happened
    expect(mockClient.execute).toHaveBeenCalledTimes(2);
    expect(mockClient.execute.mock.calls[0]![0]).toContain("season_team_members");
    expect(mockClient.execute.mock.calls[1]![0]).toContain("season_teams");
  });

  it("should reject withdrawal from active season", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockClient.firstOrNull.mockResolvedValueOnce({
      id: "season-1",
      start_date: "2020-01-01",
      end_date: "2099-12-31",
    });

    const res = await DELETE(makeRequest("DELETE", undefined, { team_id: "team-1" }), {
      params: regParams,
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("upcoming");
  });

  it("should reject when user is not team owner", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockClient.firstOrNull
      .mockResolvedValueOnce({ id: "season-1", start_date: "2099-01-01", end_date: "2099-12-31" })
      .mockResolvedValueOnce({ role: "member" });

    const res = await DELETE(makeRequest("DELETE", undefined, { team_id: "team-1" }), {
      params: regParams,
    });
    expect(res.status).toBe(403);
  });

  it("should reject when registration does not exist", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockClient.firstOrNull
      .mockResolvedValueOnce({ id: "season-1", start_date: "2099-01-01", end_date: "2099-12-31" })
      .mockResolvedValueOnce({ role: "owner" })
      .mockResolvedValueOnce(null);

    const res = await DELETE(makeRequest("DELETE", undefined, { team_id: "team-1" }), {
      params: regParams,
    });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toContain("not registered");
  });
});
