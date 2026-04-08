import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleTeamsRpc,
  type GetTeamMembershipRequest,
  type ListUserTeamsRequest,
  type CheckTeamSlugExistsRequest,
  type GetTeamByIdRequest,
  type GetTeamMembersRequest,
  type CountTeamMembersRequest,
  type GetTeamLogoUrlRequest,
  type FindTeamByInviteCodeRequest,
  type CheckTeamMembershipExistsRequest,
  type GetAppSettingRequest,
  type GetTeamMemberUserIdsRequest,
  type GetTeamOwnerRequest,
  type CheckUsersShareTeamRequest,
} from "./teams";
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

describe("teams RPC handlers", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  // -------------------------------------------------------------------------
  // teams.getMembership
  // -------------------------------------------------------------------------

  describe("teams.getMembership", () => {
    it("should return role when member exists", async () => {
      db.first.mockResolvedValue({ role: "owner" });

      const request: GetTeamMembershipRequest = {
        method: "teams.getMembership",
        teamId: "t1",
        userId: "u1",
      };
      const response = await handleTeamsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: { role: "owner" } });
    });

    it("should return null when not a member", async () => {
      db.first.mockResolvedValue(null);

      const request: GetTeamMembershipRequest = {
        method: "teams.getMembership",
        teamId: "t1",
        userId: "u1",
      };
      const response = await handleTeamsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: null });
    });

    it("should return 400 when params missing", async () => {
      const request = {
        method: "teams.getMembership",
        teamId: "",
        userId: "u1",
      } as GetTeamMembershipRequest;
      const response = await handleTeamsRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // teams.listForUser
  // -------------------------------------------------------------------------

  describe("teams.listForUser", () => {
    it("should return list of teams for user", async () => {
      const mockTeams = [
        {
          id: "t1",
          name: "Team 1",
          slug: "team-1",
          invite_code: "ABC123",
          created_by: "u1",
          created_at: "2026-01-01T00:00:00Z",
          logo_url: null,
          member_count: 3,
        },
      ];
      db.all.mockResolvedValue({ results: mockTeams });

      const request: ListUserTeamsRequest = {
        method: "teams.listForUser",
        userId: "u1",
      };
      const response = await handleTeamsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: mockTeams });
    });

    it("should return 400 when userId is missing", async () => {
      const request = {
        method: "teams.listForUser",
        userId: "",
      } as ListUserTeamsRequest;
      const response = await handleTeamsRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // teams.checkSlugExists
  // -------------------------------------------------------------------------

  describe("teams.checkSlugExists", () => {
    it("should return exists: true when slug exists", async () => {
      db.first.mockResolvedValue({ id: "t1" });

      const request: CheckTeamSlugExistsRequest = {
        method: "teams.checkSlugExists",
        slug: "existing-team",
      };
      const response = await handleTeamsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: { exists: true } });
    });

    it("should return exists: false when slug not found", async () => {
      db.first.mockResolvedValue(null);

      const request: CheckTeamSlugExistsRequest = {
        method: "teams.checkSlugExists",
        slug: "new-team",
      };
      const response = await handleTeamsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: { exists: false } });
    });
  });

  // -------------------------------------------------------------------------
  // teams.getById
  // -------------------------------------------------------------------------

  describe("teams.getById", () => {
    it("should return team details", async () => {
      const mockTeam = {
        id: "t1",
        name: "Team 1",
        slug: "team-1",
        invite_code: "ABC123",
        created_at: "2026-01-01T00:00:00Z",
        logo_url: null,
        auto_register_season: 1,
      };
      db.first.mockResolvedValue(mockTeam);

      const request: GetTeamByIdRequest = {
        method: "teams.getById",
        teamId: "t1",
      };
      const response = await handleTeamsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: mockTeam });
    });

    it("should return null when team not found", async () => {
      db.first.mockResolvedValue(null);

      const request: GetTeamByIdRequest = {
        method: "teams.getById",
        teamId: "nonexistent",
      };
      const response = await handleTeamsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: null });
    });
  });

  // -------------------------------------------------------------------------
  // teams.getMembers
  // -------------------------------------------------------------------------

  describe("teams.getMembers", () => {
    it("should return team members", async () => {
      const mockMembers = [
        {
          user_id: "u1",
          name: "User 1",
          nickname: "User One",
          slug: "user-1",
          image: null,
          role: "owner",
          joined_at: "2026-01-01T00:00:00Z",
        },
        {
          user_id: "u2",
          name: "User 2",
          nickname: null,
          slug: "user-2",
          image: "https://example.com/avatar.jpg",
          role: "member",
          joined_at: "2026-01-02T00:00:00Z",
        },
      ];
      db.all.mockResolvedValue({ results: mockMembers });

      const request: GetTeamMembersRequest = {
        method: "teams.getMembers",
        teamId: "t1",
      };
      const response = await handleTeamsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: mockMembers });
    });
  });

  // -------------------------------------------------------------------------
  // teams.countMembers
  // -------------------------------------------------------------------------

  describe("teams.countMembers", () => {
    it("should return member count", async () => {
      db.first.mockResolvedValue({ cnt: 5 });

      const request: CountTeamMembersRequest = {
        method: "teams.countMembers",
        teamId: "t1",
      };
      const response = await handleTeamsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: { count: 5 } });
    });

    it("should return 0 when no result", async () => {
      db.first.mockResolvedValue(null);

      const request: CountTeamMembersRequest = {
        method: "teams.countMembers",
        teamId: "t1",
      };
      const response = await handleTeamsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: { count: 0 } });
    });
  });

  // -------------------------------------------------------------------------
  // teams.getLogoUrl
  // -------------------------------------------------------------------------

  describe("teams.getLogoUrl", () => {
    it("should return logo URL", async () => {
      db.first.mockResolvedValue({ logo_url: "https://example.com/logo.png" });

      const request: GetTeamLogoUrlRequest = {
        method: "teams.getLogoUrl",
        teamId: "t1",
      };
      const response = await handleTeamsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: { logo_url: "https://example.com/logo.png" } });
    });

    it("should return null logo when not set", async () => {
      db.first.mockResolvedValue({ logo_url: null });

      const request: GetTeamLogoUrlRequest = {
        method: "teams.getLogoUrl",
        teamId: "t1",
      };
      const response = await handleTeamsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: { logo_url: null } });
    });
  });

  // -------------------------------------------------------------------------
  // teams.findByInviteCode
  // -------------------------------------------------------------------------

  describe("teams.findByInviteCode", () => {
    it("should return team when invite code is valid", async () => {
      db.first.mockResolvedValue({ id: "t1", name: "Team 1", slug: "team-1" });

      const request: FindTeamByInviteCodeRequest = {
        method: "teams.findByInviteCode",
        inviteCode: "ABC123",
      };
      const response = await handleTeamsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: { id: "t1", name: "Team 1", slug: "team-1" } });
    });

    it("should return null when invite code not found", async () => {
      db.first.mockResolvedValue(null);

      const request: FindTeamByInviteCodeRequest = {
        method: "teams.findByInviteCode",
        inviteCode: "INVALID",
      };
      const response = await handleTeamsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: null });
    });
  });

  // -------------------------------------------------------------------------
  // teams.membershipExists
  // -------------------------------------------------------------------------

  describe("teams.membershipExists", () => {
    it("should return exists: true when membership exists", async () => {
      db.first.mockResolvedValue({ id: "m1" });

      const request: CheckTeamMembershipExistsRequest = {
        method: "teams.membershipExists",
        teamId: "t1",
        userId: "u1",
      };
      const response = await handleTeamsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: { exists: true } });
    });

    it("should return exists: false when not a member", async () => {
      db.first.mockResolvedValue(null);

      const request: CheckTeamMembershipExistsRequest = {
        method: "teams.membershipExists",
        teamId: "t1",
        userId: "u1",
      };
      const response = await handleTeamsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: { exists: false } });
    });
  });

  // -------------------------------------------------------------------------
  // teams.getAppSetting
  // -------------------------------------------------------------------------

  describe("teams.getAppSetting", () => {
    it("should return setting value", async () => {
      db.first.mockResolvedValue({ value: "10" });

      const request: GetAppSettingRequest = {
        method: "teams.getAppSetting",
        key: "max_team_members",
      };
      const response = await handleTeamsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: "10" });
    });

    it("should return null when setting not found", async () => {
      db.first.mockResolvedValue(null);

      const request: GetAppSettingRequest = {
        method: "teams.getAppSetting",
        key: "nonexistent",
      };
      const response = await handleTeamsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: null });
    });
  });

  // -------------------------------------------------------------------------
  // teams.getMemberUserIds
  // -------------------------------------------------------------------------

  describe("teams.getMemberUserIds", () => {
    it("should return list of user IDs", async () => {
      db.all.mockResolvedValue({
        results: [{ user_id: "u1" }, { user_id: "u2" }, { user_id: "u3" }],
      });

      const request: GetTeamMemberUserIdsRequest = {
        method: "teams.getMemberUserIds",
        teamId: "t1",
      };
      const response = await handleTeamsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: ["u1", "u2", "u3"] });
    });

    it("should return empty array when no members", async () => {
      db.all.mockResolvedValue({ results: [] });

      const request: GetTeamMemberUserIdsRequest = {
        method: "teams.getMemberUserIds",
        teamId: "t1",
      };
      const response = await handleTeamsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: [] });
    });
  });

  // -------------------------------------------------------------------------
  // teams.getOwner
  // -------------------------------------------------------------------------

  describe("teams.getOwner", () => {
    it("should return owner user ID", async () => {
      db.first.mockResolvedValue({ user_id: "u1" });

      const request: GetTeamOwnerRequest = {
        method: "teams.getOwner",
        teamId: "t1",
      };
      const response = await handleTeamsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: "u1" });
    });

    it("should return null when no owner (edge case)", async () => {
      db.first.mockResolvedValue(null);

      const request: GetTeamOwnerRequest = {
        method: "teams.getOwner",
        teamId: "t1",
      };
      const response = await handleTeamsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: null });
    });
  });

  // -------------------------------------------------------------------------
  // teams.usersShareTeam
  // -------------------------------------------------------------------------

  describe("teams.usersShareTeam", () => {
    it("should return shared: true when users share a team", async () => {
      db.first.mockResolvedValue({ team_id: "t1" });

      const request: CheckUsersShareTeamRequest = {
        method: "teams.usersShareTeam",
        userId1: "u1",
        userId2: "u2",
      };
      const response = await handleTeamsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: { shared: true } });
    });

    it("should return shared: false when users don't share a team", async () => {
      db.first.mockResolvedValue(null);

      const request: CheckUsersShareTeamRequest = {
        method: "teams.usersShareTeam",
        userId1: "u1",
        userId2: "u2",
      };
      const response = await handleTeamsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: { shared: false } });
    });
  });

  // -------------------------------------------------------------------------
  // Unknown method
  // -------------------------------------------------------------------------

  describe("unknown method", () => {
    it("should return 400 for unknown method", async () => {
      const request = { method: "teams.unknown" } as unknown as GetTeamMembershipRequest;
      const response = await handleTeamsRpc(request, db);

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toContain("Unknown teams method");
    });
  });
});
