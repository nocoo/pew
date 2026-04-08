import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleSeasonsRpc,
  type ListSeasonsRequest,
  type GetSeasonByIdRequest,
  type GetSeasonBySlugRequest,
  type GetSeasonRegistrationRequest,
  type CheckSeasonMemberConflictRequest,
  type GetSeasonSnapshotsRequest,
  type GetSeasonMemberSnapshotsRequest,
  type GetSeasonTeamTokensRequest,
  type GetSeasonMemberTokensRequest,
  type GetSeasonTeamSessionStatsRequest,
  type GetSeasonMemberSessionStatsRequest,
  type GetSeasonTeamMembersRequest,
} from "./seasons";
import type { D1Database } from "@cloudflare/workers-types";

// ---------------------------------------------------------------------------
// Mock D1Database
// ---------------------------------------------------------------------------

function createMockDb() {
  return {
    prepare: vi.fn().mockReturnThis(),
    bind: vi.fn().mockReturnThis(),
    first: vi.fn(),
    all: vi.fn(),
  } as unknown as D1Database & {
    prepare: ReturnType<typeof vi.fn>;
    bind: ReturnType<typeof vi.fn>;
    first: ReturnType<typeof vi.fn>;
    all: ReturnType<typeof vi.fn>;
  };
}

describe("seasons RPC handlers", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  // -------------------------------------------------------------------------
  // seasons.list
  // -------------------------------------------------------------------------

  describe("seasons.list", () => {
    it("should return list of seasons", async () => {
      const mockSeasons = [
        {
          id: "s1",
          name: "Season 1",
          slug: "season-1",
          start_date: "2026-01-01T00:00:00Z",
          end_date: "2026-03-31T23:59:00Z",
          created_at: "2025-12-01T00:00:00Z",
          team_count: 5,
          has_snapshot: 0,
          allow_late_registration: 0,
          allow_late_withdrawal: 1,
        },
      ];
      db.all.mockResolvedValue({ results: mockSeasons });

      const request: ListSeasonsRequest = { method: "seasons.list" };
      const response = await handleSeasonsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: mockSeasons });
    });
  });

  // -------------------------------------------------------------------------
  // seasons.getById
  // -------------------------------------------------------------------------

  describe("seasons.getById", () => {
    it("should return season details by ID", async () => {
      const mockSeason = {
        id: "s1",
        name: "Season 1",
        slug: "season-1",
        start_date: "2026-01-01T00:00:00Z",
        end_date: "2026-03-31T23:59:00Z",
        snapshot_ready: 1,
        allow_late_registration: 0,
        allow_late_withdrawal: 0,
      };
      db.first.mockResolvedValue(mockSeason);

      const request: GetSeasonByIdRequest = {
        method: "seasons.getById",
        seasonId: "s1",
      };
      const response = await handleSeasonsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: mockSeason });
    });

    it("should return null when season not found", async () => {
      db.first.mockResolvedValue(null);

      const request: GetSeasonByIdRequest = {
        method: "seasons.getById",
        seasonId: "nonexistent",
      };
      const response = await handleSeasonsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: null });
    });

    it("should return 400 when seasonId missing", async () => {
      const request = {
        method: "seasons.getById",
        seasonId: "",
      } as GetSeasonByIdRequest;
      const response = await handleSeasonsRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // seasons.getBySlug
  // -------------------------------------------------------------------------

  describe("seasons.getBySlug", () => {
    it("should return season details by slug", async () => {
      const mockSeason = {
        id: "s1",
        name: "Season 1",
        slug: "season-1",
        start_date: "2026-01-01T00:00:00Z",
        end_date: "2026-03-31T23:59:00Z",
        snapshot_ready: 0,
        allow_late_registration: 1,
        allow_late_withdrawal: 1,
      };
      db.first.mockResolvedValue(mockSeason);

      const request: GetSeasonBySlugRequest = {
        method: "seasons.getBySlug",
        slug: "season-1",
      };
      const response = await handleSeasonsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: mockSeason });
    });

    it("should return 400 when slug missing", async () => {
      const request = {
        method: "seasons.getBySlug",
        slug: "",
      } as GetSeasonBySlugRequest;
      const response = await handleSeasonsRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // seasons.getRegistration
  // -------------------------------------------------------------------------

  describe("seasons.getRegistration", () => {
    it("should return registration when exists", async () => {
      const mockRegistration = {
        id: "r1",
        season_id: "s1",
        team_id: "t1",
        registered_by: "u1",
        created_at: "2026-01-01T00:00:00Z",
      };
      db.first.mockResolvedValue(mockRegistration);

      const request: GetSeasonRegistrationRequest = {
        method: "seasons.getRegistration",
        seasonId: "s1",
        teamId: "t1",
      };
      const response = await handleSeasonsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: mockRegistration });
    });

    it("should return null when not registered", async () => {
      db.first.mockResolvedValue(null);

      const request: GetSeasonRegistrationRequest = {
        method: "seasons.getRegistration",
        seasonId: "s1",
        teamId: "t1",
      };
      const response = await handleSeasonsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: null });
    });

    it("should return 400 when params missing", async () => {
      const request = {
        method: "seasons.getRegistration",
        seasonId: "",
        teamId: "t1",
      } as GetSeasonRegistrationRequest;
      const response = await handleSeasonsRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // seasons.checkMemberConflict
  // -------------------------------------------------------------------------

  describe("seasons.checkMemberConflict", () => {
    it("should return conflicting user when exists", async () => {
      db.first.mockResolvedValue({ user_id: "u2" });

      const request: CheckSeasonMemberConflictRequest = {
        method: "seasons.checkMemberConflict",
        seasonId: "s1",
        userIds: ["u1", "u2", "u3"],
      };
      const response = await handleSeasonsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: { user_id: "u2" } });
    });

    it("should return null when no conflict", async () => {
      db.first.mockResolvedValue(null);

      const request: CheckSeasonMemberConflictRequest = {
        method: "seasons.checkMemberConflict",
        seasonId: "s1",
        userIds: ["u1"],
      };
      const response = await handleSeasonsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: null });
    });

    it("should return 400 when params missing", async () => {
      const request = {
        method: "seasons.checkMemberConflict",
        seasonId: "s1",
        userIds: [],
      } as CheckSeasonMemberConflictRequest;
      const response = await handleSeasonsRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // seasons.getSnapshots
  // -------------------------------------------------------------------------

  describe("seasons.getSnapshots", () => {
    it("should return snapshots", async () => {
      const mockSnapshots = [
        {
          team_id: "t1",
          team_name: "Team 1",
          team_slug: "team-1",
          team_logo_url: null,
          rank: 1,
          total_tokens: 1000000,
          input_tokens: 600000,
          output_tokens: 400000,
          cached_input_tokens: 100000,
        },
      ];
      db.all.mockResolvedValue({ results: mockSnapshots });

      const request: GetSeasonSnapshotsRequest = {
        method: "seasons.getSnapshots",
        seasonId: "s1",
      };
      const response = await handleSeasonsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: mockSnapshots });
    });

    it("should return 400 when seasonId missing", async () => {
      const request = {
        method: "seasons.getSnapshots",
        seasonId: "",
      } as GetSeasonSnapshotsRequest;
      const response = await handleSeasonsRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // seasons.getMemberSnapshots
  // -------------------------------------------------------------------------

  describe("seasons.getMemberSnapshots", () => {
    it("should return member snapshots", async () => {
      const mockSnapshots = [
        {
          team_id: "t1",
          user_id: "u1",
          slug: "user-1",
          name: "User 1",
          nickname: null,
          image: null,
          is_public: 1,
          total_tokens: 500000,
          input_tokens: 300000,
          output_tokens: 200000,
          cached_input_tokens: 50000,
        },
      ];
      db.all.mockResolvedValue({ results: mockSnapshots });

      const request: GetSeasonMemberSnapshotsRequest = {
        method: "seasons.getMemberSnapshots",
        seasonId: "s1",
      };
      const response = await handleSeasonsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: mockSnapshots });
    });

    it("should return 400 when seasonId missing", async () => {
      const request = {
        method: "seasons.getMemberSnapshots",
        seasonId: "",
      } as GetSeasonMemberSnapshotsRequest;
      const response = await handleSeasonsRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // seasons.getTeamTokens
  // -------------------------------------------------------------------------

  describe("seasons.getTeamTokens", () => {
    it("should return team tokens", async () => {
      const mockTokens = [
        {
          team_id: "t1",
          team_name: "Team 1",
          team_slug: "team-1",
          team_logo_url: null,
          total_tokens: 1000000,
          input_tokens: 600000,
          output_tokens: 400000,
          cached_input_tokens: 100000,
        },
      ];
      db.all.mockResolvedValue({ results: mockTokens });

      const request: GetSeasonTeamTokensRequest = {
        method: "seasons.getTeamTokens",
        seasonId: "s1",
        fromDate: "2026-01-01T00:00:00.000Z",
        toDate: "2026-04-01T00:00:00.000Z",
      };
      const response = await handleSeasonsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: mockTokens });
    });

    it("should return 400 when params missing", async () => {
      const request = {
        method: "seasons.getTeamTokens",
        seasonId: "s1",
        fromDate: "",
        toDate: "2026-04-01T00:00:00.000Z",
      } as GetSeasonTeamTokensRequest;
      const response = await handleSeasonsRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // seasons.getMemberTokens
  // -------------------------------------------------------------------------

  describe("seasons.getMemberTokens", () => {
    it("should return member tokens", async () => {
      const mockTokens = [
        {
          team_id: "t1",
          user_id: "u1",
          slug: "user-1",
          name: "User 1",
          nickname: null,
          image: null,
          is_public: 1,
          total_tokens: 500000,
          input_tokens: 300000,
          output_tokens: 200000,
          cached_input_tokens: 50000,
        },
      ];
      db.all.mockResolvedValue({ results: mockTokens });

      const request: GetSeasonMemberTokensRequest = {
        method: "seasons.getMemberTokens",
        seasonId: "s1",
        teamIds: ["t1"],
        fromDate: "2026-01-01T00:00:00.000Z",
        toDate: "2026-04-01T00:00:00.000Z",
      };
      const response = await handleSeasonsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: mockTokens });
    });

    it("should return 400 when params missing", async () => {
      const request = {
        method: "seasons.getMemberTokens",
        seasonId: "s1",
        teamIds: [],
        fromDate: "2026-01-01T00:00:00.000Z",
        toDate: "2026-04-01T00:00:00.000Z",
      } as GetSeasonMemberTokensRequest;
      const response = await handleSeasonsRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // seasons.getTeamSessionStats
  // -------------------------------------------------------------------------

  describe("seasons.getTeamSessionStats", () => {
    it("should return team session stats", async () => {
      const mockStats = [
        {
          team_id: "t1",
          session_count: 100,
          total_duration_seconds: 36000,
        },
      ];
      db.all.mockResolvedValue({ results: mockStats });

      const request: GetSeasonTeamSessionStatsRequest = {
        method: "seasons.getTeamSessionStats",
        seasonId: "s1",
        teamIds: ["t1"],
        fromDate: "2026-01-01T00:00:00.000Z",
        toDate: "2026-04-01T00:00:00.000Z",
      };
      const response = await handleSeasonsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: mockStats });
    });

    it("should return 400 when params missing", async () => {
      const request = {
        method: "seasons.getTeamSessionStats",
        seasonId: "s1",
        teamIds: [],
        fromDate: "2026-01-01T00:00:00.000Z",
        toDate: "2026-04-01T00:00:00.000Z",
      } as GetSeasonTeamSessionStatsRequest;
      const response = await handleSeasonsRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // seasons.getMemberSessionStats
  // -------------------------------------------------------------------------

  describe("seasons.getMemberSessionStats", () => {
    it("should return member session stats", async () => {
      const mockStats = [
        {
          team_id: "t1",
          user_id: "u1",
          session_count: 50,
          total_duration_seconds: 18000,
        },
      ];
      db.all.mockResolvedValue({ results: mockStats });

      const request: GetSeasonMemberSessionStatsRequest = {
        method: "seasons.getMemberSessionStats",
        seasonId: "s1",
        teamIds: ["t1"],
        fromDate: "2026-01-01T00:00:00.000Z",
        toDate: "2026-04-01T00:00:00.000Z",
      };
      const response = await handleSeasonsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: mockStats });
    });

    it("should return 400 when params missing", async () => {
      const request = {
        method: "seasons.getMemberSessionStats",
        seasonId: "s1",
        teamIds: [],
        fromDate: "2026-01-01T00:00:00.000Z",
        toDate: "2026-04-01T00:00:00.000Z",
      } as GetSeasonMemberSessionStatsRequest;
      const response = await handleSeasonsRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // seasons.getTeamMembers
  // -------------------------------------------------------------------------

  describe("seasons.getTeamMembers", () => {
    it("should return team member user IDs", async () => {
      db.all.mockResolvedValue({
        results: [{ user_id: "u1" }, { user_id: "u2" }],
      });

      const request: GetSeasonTeamMembersRequest = {
        method: "seasons.getTeamMembers",
        teamId: "t1",
      };
      const response = await handleSeasonsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: ["u1", "u2"] });
    });

    it("should return 400 when teamId missing", async () => {
      const request = {
        method: "seasons.getTeamMembers",
        teamId: "",
      } as GetSeasonTeamMembersRequest;
      const response = await handleSeasonsRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // Unknown method
  // -------------------------------------------------------------------------

  describe("unknown method", () => {
    it("should return 400 for unknown method", async () => {
      const request = { method: "seasons.unknown" } as unknown as ListSeasonsRequest;
      const response = await handleSeasonsRpc(request, db);

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toContain("Unknown seasons method");
    });
  });
});
