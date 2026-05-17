import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleTeamsRpc,
  type GetTeamMembershipRequest,
  type ListUserTeamsRequest,
  type ListAllTeamsRequest,
  type CheckTeamSlugExistsRequest,
  type GetTeamByIdRequest,
  type GetTeamMembersRequest,
  type GetTeamSeasonRegistrationsRequest,
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
      expect(body).toEqual({ result: { role: "owner" } });
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
      expect(body).toEqual({ result: null });
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
      expect(body).toEqual({ result: mockTeams });
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
      expect(body).toEqual({ result: { exists: true } });
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
      expect(body).toEqual({ result: { exists: false } });
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
      expect(body).toEqual({ result: mockTeam });
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
      expect(body).toEqual({ result: null });
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
      expect(body).toEqual({ result: mockMembers });
    });
    it("re-throws when first attempt fails with a non-'no such column' error (err non-Error branch)", async () => {
      // Make .all reject with a non-Error value to exercise the `err instanceof Error` false branch.
      const failingAll = vi.fn().mockRejectedValue("unrelated DB failure (non-Error)");
      db.bind.mockReturnValue({ all: failingAll });
      const request: GetTeamMembersRequest = {
        method: "teams.getMembers",
        teamId: "t1",
      };
      await expect(handleTeamsRpc(request, db)).rejects.toBe(
        "unrelated DB failure (non-Error)",
      );
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
      expect(body).toEqual({ result: { count: 5 } });
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
      expect(body).toEqual({ result: { count: 0 } });
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
      expect(body).toEqual({ result: { logo_url: "https://example.com/logo.png" } });
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
      expect(body).toEqual({ result: { logo_url: null } });
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
      expect(body).toEqual({ result: { id: "t1", name: "Team 1", slug: "team-1" } });
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
      expect(body).toEqual({ result: null });
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
      expect(body).toEqual({ result: { exists: true } });
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
      expect(body).toEqual({ result: { exists: false } });
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
      expect(body).toEqual({ result: "10" });
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
      expect(body).toEqual({ result: null });
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
      expect(body).toEqual({ result: ["u1", "u2", "u3"] });
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
      expect(body).toEqual({ result: [] });
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
      expect(body).toEqual({ result: "u1" });
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
      expect(body).toEqual({ result: null });
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
      expect(body).toEqual({ result: { shared: true } });
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
      expect(body).toEqual({ result: { shared: false } });
    });
  });

  // -------------------------------------------------------------------------
  // teams.listAll
  // -------------------------------------------------------------------------

  describe("teams.listAll", () => {
    it("should return all teams ordered by created_at desc", async () => {
      const rows = [
        { id: "t1", name: "A", slug: "a", invite_code: "i1", created_by: "u1", created_at: "2026-01-02", logo_url: null, member_count: 3 },
        { id: "t2", name: "B", slug: "b", invite_code: "i2", created_by: "u2", created_at: "2026-01-01", logo_url: null, member_count: 1 },
      ];
      db.all.mockResolvedValue({ results: rows });
      const req: ListAllTeamsRequest = { method: "teams.listAll" };
      const res = await handleTeamsRpc(req, db);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ result: rows });
      // No bind args required
      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(sql).toContain("ORDER BY t.created_at DESC");
      expect(sql).toContain("member_count");
    });

    it("should return empty array when no teams", async () => {
      db.all.mockResolvedValue({ results: [] });
      const req: ListAllTeamsRequest = { method: "teams.listAll" };
      expect(await (await handleTeamsRpc(req, db)).json()).toEqual({ result: [] });
    });
  });

  // -------------------------------------------------------------------------
  // teams.getSeasonRegistrations
  // -------------------------------------------------------------------------

  describe("teams.getSeasonRegistrations", () => {
    it("should map rows to season_id strings", async () => {
      db.all.mockResolvedValue({
        results: [{ season_id: "s1" }, { season_id: "s2" }],
      });
      const req: GetTeamSeasonRegistrationsRequest = {
        method: "teams.getSeasonRegistrations",
        teamId: "t1",
      };
      const res = await handleTeamsRpc(req, db);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ result: ["s1", "s2"] });
      expect(db.bind).toHaveBeenCalledWith("t1");
    });

    it("should return [] when no registrations", async () => {
      db.all.mockResolvedValue({ results: [] });
      const req: GetTeamSeasonRegistrationsRequest = {
        method: "teams.getSeasonRegistrations",
        teamId: "t1",
      };
      expect(await (await handleTeamsRpc(req, db)).json()).toEqual({ result: [] });
    });

    it("should return 400 when teamId missing", async () => {
      const req = {
        method: "teams.getSeasonRegistrations",
        teamId: "",
      } as GetTeamSeasonRegistrationsRequest;
      expect((await handleTeamsRpc(req, db)).status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // teams.getById — schema fallback
  // -------------------------------------------------------------------------

  describe("teams.getById schema fallback", () => {
    it("should retry without auto_register_season on missing-column error", async () => {
      const fallbackRow = {
        id: "t1",
        name: "T",
        slug: "t",
        invite_code: "i",
        created_at: "2026-01-01",
        logo_url: null,
      };
      let call = 0;
      db.first.mockImplementation(async () => {
        call++;
        if (call === 1) {
          throw new Error("D1_ERROR: no such column: auto_register_season");
        }
        return fallbackRow;
      });
      const req: GetTeamByIdRequest = { method: "teams.getById", teamId: "t1" };
      const res = await handleTeamsRpc(req, db);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        result: { ...fallbackRow, auto_register_season: null },
      });
      expect(call).toBe(2);
    });

    it("should return null result when fallback also returns null", async () => {
      let call = 0;
      db.first.mockImplementation(async () => {
        call++;
        if (call === 1) {
          throw new Error("no such column: auto_register_season");
        }
        return null;
      });
      const req: GetTeamByIdRequest = { method: "teams.getById", teamId: "t1" };
      const res = await handleTeamsRpc(req, db);
      expect(await res.json()).toEqual({ result: null });
    });

    it("should rethrow unrelated errors", async () => {
      db.first.mockRejectedValue(new Error("some other db error"));
      const req: GetTeamByIdRequest = { method: "teams.getById", teamId: "t1" };
      await expect(handleTeamsRpc(req, db)).rejects.toThrow("some other db error");
    });

    it("should rethrow non-Error rejections", async () => {
      db.first.mockRejectedValue("string error");
      const req: GetTeamByIdRequest = { method: "teams.getById", teamId: "t1" };
      await expect(handleTeamsRpc(req, db)).rejects.toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // teams.getMembers — schema fallback
  // -------------------------------------------------------------------------

  describe("teams.getMembers schema fallback", () => {
    it("should retry without nickname/slug when missing-column error", async () => {
      const fallbackRows = [
        { user_id: "u1", name: "Alice", image: null, role: "owner", joined_at: "2026-01-01" },
      ];
      let call = 0;
      db.all.mockImplementation(async () => {
        call++;
        if (call === 1) {
          throw new Error("no such column: u.nickname");
        }
        return { results: fallbackRows };
      });
      const req: GetTeamMembersRequest = { method: "teams.getMembers", teamId: "t1" };
      const res = await handleTeamsRpc(req, db);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { result: Array<Record<string, unknown>> };
      expect(body.result[0]).toMatchObject({
        user_id: "u1",
        nickname: null,
        slug: null,
      });
      expect(call).toBe(2);
    });

    it("should rethrow when error is unrelated to columns", async () => {
      db.all.mockRejectedValue(new Error("connection lost"));
      const req: GetTeamMembersRequest = { method: "teams.getMembers", teamId: "t1" };
      await expect(handleTeamsRpc(req, db)).rejects.toThrow("connection lost");
    });
  });

  // -------------------------------------------------------------------------
  // 400 validation paths for handlers that require ids
  // -------------------------------------------------------------------------

  describe("400 validation", () => {
    it("teams.getById 400 when teamId missing", async () => {
      expect(
        (await handleTeamsRpc({ method: "teams.getById", teamId: "" } as GetTeamByIdRequest, db)).status,
      ).toBe(400);
    });
    it("teams.getMembers 400 when teamId missing", async () => {
      expect(
        (await handleTeamsRpc({ method: "teams.getMembers", teamId: "" } as GetTeamMembersRequest, db)).status,
      ).toBe(400);
    });
    it("teams.countMembers 400 when teamId missing", async () => {
      expect(
        (await handleTeamsRpc({ method: "teams.countMembers", teamId: "" } as CountTeamMembersRequest, db)).status,
      ).toBe(400);
    });
    it("teams.getLogoUrl 400 when teamId missing", async () => {
      expect(
        (await handleTeamsRpc({ method: "teams.getLogoUrl", teamId: "" } as GetTeamLogoUrlRequest, db)).status,
      ).toBe(400);
    });
    it("teams.getMemberUserIds 400 when teamId missing", async () => {
      expect(
        (await handleTeamsRpc({ method: "teams.getMemberUserIds", teamId: "" } as GetTeamMemberUserIdsRequest, db)).status,
      ).toBe(400);
    });
    it("teams.getOwner 400 when teamId missing", async () => {
      expect(
        (await handleTeamsRpc({ method: "teams.getOwner", teamId: "" } as GetTeamOwnerRequest, db)).status,
      ).toBe(400);
    });
    it("teams.findByInviteCode 400 when missing", async () => {
      expect(
        (await handleTeamsRpc({ method: "teams.findByInviteCode", inviteCode: "" } as FindTeamByInviteCodeRequest, db)).status,
      ).toBe(400);
    });
    it("teams.checkSlugExists 400 when missing", async () => {
      expect(
        (await handleTeamsRpc({ method: "teams.checkSlugExists", slug: "" } as CheckTeamSlugExistsRequest, db)).status,
      ).toBe(400);
    });
    it("teams.membershipExists 400 when teamId missing", async () => {
      expect(
        (await handleTeamsRpc({ method: "teams.membershipExists", teamId: "", userId: "u" } as CheckTeamMembershipExistsRequest, db)).status,
      ).toBe(400);
    });
    it("teams.membershipExists 400 when userId missing", async () => {
      expect(
        (await handleTeamsRpc({ method: "teams.membershipExists", teamId: "t", userId: "" } as CheckTeamMembershipExistsRequest, db)).status,
      ).toBe(400);
    });
    it("teams.getAppSetting 400 when key missing", async () => {
      expect(
        (await handleTeamsRpc({ method: "teams.getAppSetting", key: "" } as GetAppSettingRequest, db)).status,
      ).toBe(400);
    });
    it("teams.getMembership 400 when teamId missing", async () => {
      expect(
        (await handleTeamsRpc({ method: "teams.getMembership", teamId: "", userId: "u" } as GetTeamMembershipRequest, db)).status,
      ).toBe(400);
    });
    it("teams.listForUser 400 when userId missing", async () => {
      expect(
        (await handleTeamsRpc({ method: "teams.listForUser", userId: "" } as ListUserTeamsRequest, db)).status,
      ).toBe(400);
    });
    it("teams.usersShareTeam 400 when either userId missing", async () => {
      expect(
        (await handleTeamsRpc({ method: "teams.usersShareTeam", userId1: "", userId2: "b" } as CheckUsersShareTeamRequest, db)).status,
      ).toBe(400);
      expect(
        (await handleTeamsRpc({ method: "teams.usersShareTeam", userId1: "a", userId2: "" } as CheckUsersShareTeamRequest, db)).status,
      ).toBe(400);
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
