import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleBadgesRpc,
  deriveAssignmentStatus,
  type ListBadgesRequest,
  type GetBadgeRequest,
  type GetActiveBadgesForUserRequest,
  type GetActiveBadgesForUsersRequest,
  type ListAssignmentsRequest,
  type GetAssignmentRequest,
  type CheckNonRevokedAssignmentRequest,
} from "./badges";
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

describe("badges RPC handlers", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  // -------------------------------------------------------------------------
  // deriveAssignmentStatus
  // -------------------------------------------------------------------------

  describe("deriveAssignmentStatus", () => {
    const now = new Date("2026-04-12T12:00:00Z");

    it("should return active when not revoked and not expired", () => {
      const status = deriveAssignmentStatus(null, "2026-04-15T12:00:00Z", now);
      expect(status).toBe("active");
    });

    it("should return expired when not revoked but past expires_at", () => {
      const status = deriveAssignmentStatus(null, "2026-04-10T12:00:00Z", now);
      expect(status).toBe("expired");
    });

    it("should return revoked_early when revoked_at <= expires_at", () => {
      const status = deriveAssignmentStatus(
        "2026-04-08T12:00:00Z", // revoked
        "2026-04-15T12:00:00Z", // expires
        now,
      );
      expect(status).toBe("revoked_early");
    });

    it("should return revoked_post_expiry when revoked_at > expires_at", () => {
      const status = deriveAssignmentStatus(
        "2026-04-16T12:00:00Z", // revoked after expiry
        "2026-04-15T12:00:00Z", // expired
        now,
      );
      expect(status).toBe("revoked_post_expiry");
    });
  });

  // -------------------------------------------------------------------------
  // badges.list
  // -------------------------------------------------------------------------

  describe("badges.list", () => {
    it("should return active badges by default", async () => {
      const mockBadges = [
        { id: "b1", text: "MVP", icon: "shield", is_archived: 0 },
        { id: "b2", text: "S1", icon: "star", is_archived: 0 },
      ];
      db.all.mockResolvedValue({ results: mockBadges });

      const request: ListBadgesRequest = {
        method: "badges.list",
      };
      const response = await handleBadgesRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: { badges: mockBadges } });
      expect(db.prepare).toHaveBeenCalledWith(
        expect.stringContaining("WHERE is_archived = 0"),
      );
    });

    it("should include archived badges when requested", async () => {
      const mockBadges = [
        { id: "b1", text: "MVP", is_archived: 0 },
        { id: "b2", text: "OLD", is_archived: 1 },
      ];
      db.all.mockResolvedValue({ results: mockBadges });

      const request: ListBadgesRequest = {
        method: "badges.list",
        includeArchived: true,
      };
      const response = await handleBadgesRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: { badges: mockBadges } });
      expect(db.prepare).toHaveBeenCalledWith(
        expect.not.stringContaining("WHERE"),
      );
    });
  });

  // -------------------------------------------------------------------------
  // badges.get
  // -------------------------------------------------------------------------

  describe("badges.get", () => {
    it("should return badge by ID", async () => {
      const mockBadge = {
        id: "b1",
        text: "MVP",
        icon: "shield",
        color_bg: "#3B82F6",
        color_text: "#FFFFFF",
      };
      db.first.mockResolvedValue(mockBadge);

      const request: GetBadgeRequest = {
        method: "badges.get",
        badgeId: "b1",
      };
      const response = await handleBadgesRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: { badge: mockBadge } });
    });

    it("should return 404 when badge not found", async () => {
      db.first.mockResolvedValue(null);

      const request: GetBadgeRequest = {
        method: "badges.get",
        badgeId: "nonexistent",
      };
      const response = await handleBadgesRpc(request, db);

      expect(response.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // badges.getActiveForUser
  // -------------------------------------------------------------------------

  describe("badges.getActiveForUser", () => {
    it("should return active badges for user", async () => {
      const mockBadges = [
        {
          id: "a1",
          text: "MVP",
          icon: "shield",
          color_bg: "#3B82F6",
          color_text: "#FFFFFF",
          assigned_at: "2026-04-10T00:00:00Z",
          expires_at: "2026-04-17T00:00:00Z",
        },
      ];
      db.all.mockResolvedValue({ results: mockBadges });

      const request: GetActiveBadgesForUserRequest = {
        method: "badges.getActiveForUser",
        userId: "u1",
      };
      const response = await handleBadgesRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: { badges: mockBadges } });
    });

    it("should return empty array when no active badges", async () => {
      db.all.mockResolvedValue({ results: [] });

      const request: GetActiveBadgesForUserRequest = {
        method: "badges.getActiveForUser",
        userId: "u1",
      };
      const response = await handleBadgesRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: { badges: [] } });
    });
  });

  // -------------------------------------------------------------------------
  // badges.getActiveForUsers
  // -------------------------------------------------------------------------

  describe("badges.getActiveForUsers", () => {
    it("should return badges grouped by user", async () => {
      const mockBadges = [
        {
          user_id: "u1",
          id: "a1",
          text: "MVP",
          icon: "shield",
          color_bg: "#3B82F6",
          color_text: "#FFFFFF",
          assigned_at: "2026-04-10T00:00:00Z",
          expires_at: "2026-04-17T00:00:00Z",
        },
        {
          user_id: "u2",
          id: "a2",
          text: "S1",
          icon: "star",
          color_bg: "#EAB308",
          color_text: "#1F2937",
          assigned_at: "2026-04-08T00:00:00Z",
          expires_at: "2026-04-15T00:00:00Z",
        },
      ];
      db.all.mockResolvedValue({ results: mockBadges });

      const request: GetActiveBadgesForUsersRequest = {
        method: "badges.getActiveForUsers",
        userIds: ["u1", "u2"],
      };
      const response = await handleBadgesRpc(request, db);
      const body = (await response.json()) as { result: { badges: Record<string, unknown[]> } };

      expect(response.status).toBe(200);
      expect(body.result.badges).toHaveProperty("u1");
      expect(body.result.badges).toHaveProperty("u2");
      expect(body.result.badges.u1).toHaveLength(1);
      expect(body.result.badges.u2).toHaveLength(1);
    });

    it("should return empty object for empty userIds", async () => {
      const request: GetActiveBadgesForUsersRequest = {
        method: "badges.getActiveForUsers",
        userIds: [],
      };
      const response = await handleBadgesRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: { badges: {} } });
    });
  });

  // -------------------------------------------------------------------------
  // badges.listAssignments
  // -------------------------------------------------------------------------

  describe("badges.listAssignments", () => {
    it("should list all assignments with derived status", async () => {
      const mockAssignments = [
        {
          id: "a1",
          badge_id: "b1",
          user_id: "u1",
          expires_at: "2027-04-20T00:00:00Z",
          revoked_at: null,
          assigned_at: "2026-04-10T00:00:00Z",
          user_name: "Test User",
        },
      ];
      db.all.mockResolvedValue({ results: mockAssignments });

      const request: ListAssignmentsRequest = {
        method: "badges.listAssignments",
        limit: 50,
        offset: 0,
      };
      const response = await handleBadgesRpc(request, db);
      const body = (await response.json()) as { result: { assignments: Array<{ status: string }> } };

      expect(response.status).toBe(200);
      expect(body.result.assignments).toHaveLength(1);
      expect(body.result.assignments[0].status).toBe("active");
    });

    it("should filter by status", async () => {
      db.all.mockResolvedValue({ results: [] });

      const request: ListAssignmentsRequest = {
        method: "badges.listAssignments",
        status: "active",
        limit: 50,
        offset: 0,
      };
      await handleBadgesRpc(request, db);

      expect(db.prepare).toHaveBeenCalledWith(
        expect.stringContaining("revoked_at IS NULL AND ba.expires_at >"),
      );
    });

    it("should filter revoked (revoked_early only)", async () => {
      db.all.mockResolvedValue({ results: [] });

      const request: ListAssignmentsRequest = {
        method: "badges.listAssignments",
        status: "revoked",
        limit: 50,
        offset: 0,
      };
      await handleBadgesRpc(request, db);

      expect(db.prepare).toHaveBeenCalledWith(
        expect.stringContaining("revoked_at IS NOT NULL AND ba.revoked_at <= ba.expires_at"),
      );
    });

    it("should filter cleared (revoked_post_expiry only)", async () => {
      db.all.mockResolvedValue({ results: [] });

      const request: ListAssignmentsRequest = {
        method: "badges.listAssignments",
        status: "cleared",
        limit: 50,
        offset: 0,
      };
      await handleBadgesRpc(request, db);

      expect(db.prepare).toHaveBeenCalledWith(
        expect.stringContaining("revoked_at IS NOT NULL AND ba.revoked_at > ba.expires_at"),
      );
    });
  });

  // -------------------------------------------------------------------------
  // badges.getAssignment
  // -------------------------------------------------------------------------

  describe("badges.getAssignment", () => {
    it("should return assignment with derived status", async () => {
      const mockAssignment = {
        id: "a1",
        badge_id: "b1",
        user_id: "u1",
        expires_at: "2027-04-20T00:00:00Z",
        revoked_at: null,
        assigned_at: "2026-04-10T00:00:00Z",
        user_name: "Test User",
      };
      db.first.mockResolvedValue(mockAssignment);

      const request: GetAssignmentRequest = {
        method: "badges.getAssignment",
        assignmentId: "a1",
      };
      const response = await handleBadgesRpc(request, db);
      const body = (await response.json()) as { result: { assignment: { status: string } } };

      expect(response.status).toBe(200);
      expect(body.result.assignment.status).toBe("active");
    });

    it("should return 404 when assignment not found", async () => {
      db.first.mockResolvedValue(null);

      const request: GetAssignmentRequest = {
        method: "badges.getAssignment",
        assignmentId: "nonexistent",
      };
      const response = await handleBadgesRpc(request, db);

      expect(response.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // badges.checkNonRevokedAssignment
  // -------------------------------------------------------------------------

  describe("badges.checkNonRevokedAssignment", () => {
    it("should return exists=false when no non-revoked assignment", async () => {
      db.first.mockResolvedValue(null);

      const request: CheckNonRevokedAssignmentRequest = {
        method: "badges.checkNonRevokedAssignment",
        badgeId: "b1",
        userId: "u1",
      };
      const response = await handleBadgesRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: { exists: false } });
    });

    it("should return exists=true with isActive=true for active assignment", async () => {
      db.first.mockResolvedValue({
        id: "a1",
        expires_at: "2099-04-20T00:00:00Z", // Far future
        revoked_at: null,
      });

      const request: CheckNonRevokedAssignmentRequest = {
        method: "badges.checkNonRevokedAssignment",
        badgeId: "b1",
        userId: "u1",
      };
      const response = await handleBadgesRpc(request, db);
      const body = (await response.json()) as { result: { exists: boolean; isActive: boolean; assignmentId: string } };

      expect(response.status).toBe(200);
      expect(body.result.exists).toBe(true);
      expect(body.result.isActive).toBe(true);
      expect(body.result.assignmentId).toBe("a1");
    });

    it("should return exists=true with isActive=false for expired assignment", async () => {
      db.first.mockResolvedValue({
        id: "a1",
        expires_at: "2020-04-20T00:00:00Z", // Past
        revoked_at: null,
      });

      const request: CheckNonRevokedAssignmentRequest = {
        method: "badges.checkNonRevokedAssignment",
        badgeId: "b1",
        userId: "u1",
      };
      const response = await handleBadgesRpc(request, db);
      const body = (await response.json()) as { result: { exists: boolean; isActive: boolean } };

      expect(response.status).toBe(200);
      expect(body.result.exists).toBe(true);
      expect(body.result.isActive).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Unknown method
  // -------------------------------------------------------------------------

  describe("unknown method", () => {
    it("should return 400 for unknown method", async () => {
      const request = {
        method: "badges.unknown",
      } as unknown as ListBadgesRequest;
      const response = await handleBadgesRpc(request, db);

      expect(response.status).toBe(400);
    });
  });
});
