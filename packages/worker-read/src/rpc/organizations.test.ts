import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleOrganizationsRpc,
  type ListOrganizationsRequest,
  type ListOrganizationsWithCountRequest,
  type ListUserOrganizationsRequest,
  type GetOrganizationByIdRequest,
  type GetOrganizationBySlugRequest,
  type CheckOrgMembershipRequest,
  type ListOrgMembersRequest,
  type ListOrgMembersAdminRequest,
  type CountOrgMembersRequest,
} from "./organizations";
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

describe("organizations RPC handlers", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  // -------------------------------------------------------------------------
  // organizations.list
  // -------------------------------------------------------------------------

  describe("organizations.list", () => {
    it("should return list of organizations", async () => {
      const mockOrgs = [
        { id: "o1", name: "Org 1", slug: "org-1", created_at: "2026-01-01T00:00:00Z" },
        { id: "o2", name: "Org 2", slug: "org-2", created_at: "2026-02-01T00:00:00Z" },
      ];
      db.all.mockResolvedValue({ results: mockOrgs });

      const request: ListOrganizationsRequest = { method: "organizations.list" };
      const response = await handleOrganizationsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: mockOrgs });
    });
  });

  // -------------------------------------------------------------------------
  // organizations.listForUser
  // -------------------------------------------------------------------------

  describe("organizations.listForUser", () => {
    it("should return user's organizations", async () => {
      const mockOrgs = [
        { id: "o1", name: "Org 1", slug: "org-1", created_at: "2026-01-01T00:00:00Z" },
      ];
      db.all.mockResolvedValue({ results: mockOrgs });

      const request: ListUserOrganizationsRequest = {
        method: "organizations.listForUser",
        userId: "u1",
      };
      const response = await handleOrganizationsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: mockOrgs });
    });

    it("should return 400 when userId missing", async () => {
      const request = {
        method: "organizations.listForUser",
        userId: "",
      } as ListUserOrganizationsRequest;
      const response = await handleOrganizationsRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // organizations.getById
  // -------------------------------------------------------------------------

  describe("organizations.getById", () => {
    it("should return organization by ID", async () => {
      const mockOrg = {
        id: "o1",
        name: "Org 1",
        slug: "org-1",
        created_at: "2026-01-01T00:00:00Z",
      };
      db.first.mockResolvedValue(mockOrg);

      const request: GetOrganizationByIdRequest = {
        method: "organizations.getById",
        orgId: "o1",
      };
      const response = await handleOrganizationsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: mockOrg });
    });

    it("should return null when not found", async () => {
      db.first.mockResolvedValue(null);

      const request: GetOrganizationByIdRequest = {
        method: "organizations.getById",
        orgId: "nonexistent",
      };
      const response = await handleOrganizationsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: null });
    });

    it("should return 400 when orgId missing", async () => {
      const request = {
        method: "organizations.getById",
        orgId: "",
      } as GetOrganizationByIdRequest;
      const response = await handleOrganizationsRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // organizations.getBySlug
  // -------------------------------------------------------------------------

  describe("organizations.getBySlug", () => {
    it("should return organization by slug", async () => {
      const mockOrg = {
        id: "o1",
        name: "Org 1",
        slug: "org-1",
        logo_url: null,
        created_by: "u1",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      };
      db.first.mockResolvedValue(mockOrg);

      const request: GetOrganizationBySlugRequest = {
        method: "organizations.getBySlug",
        slug: "org-1",
      };
      const response = await handleOrganizationsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: mockOrg });
    });

    it("should return null when not found", async () => {
      db.first.mockResolvedValue(null);

      const request: GetOrganizationBySlugRequest = {
        method: "organizations.getBySlug",
        slug: "nonexistent",
      };
      const response = await handleOrganizationsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: null });
    });

    it("should return 400 when slug missing", async () => {
      const request = {
        method: "organizations.getBySlug",
        slug: "",
      } as GetOrganizationBySlugRequest;
      const response = await handleOrganizationsRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // organizations.checkMembership
  // -------------------------------------------------------------------------

  describe("organizations.checkMembership", () => {
    it("should return exists: true when member", async () => {
      db.first.mockResolvedValue({ id: "m1" });

      const request: CheckOrgMembershipRequest = {
        method: "organizations.checkMembership",
        orgId: "o1",
        userId: "u1",
      };
      const response = await handleOrganizationsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: { exists: true } });
    });

    it("should return exists: false when not a member", async () => {
      db.first.mockResolvedValue(null);

      const request: CheckOrgMembershipRequest = {
        method: "organizations.checkMembership",
        orgId: "o1",
        userId: "u1",
      };
      const response = await handleOrganizationsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: { exists: false } });
    });

    it("should return 400 when params missing", async () => {
      const request = {
        method: "organizations.checkMembership",
        orgId: "",
        userId: "u1",
      } as CheckOrgMembershipRequest;
      const response = await handleOrganizationsRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // organizations.listMembers
  // -------------------------------------------------------------------------

  describe("organizations.listMembers", () => {
    it("should return organization members", async () => {
      const mockMembers = [
        {
          user_id: "u1",
          name: "User 1",
          image: null,
          slug: "user-1",
          joined_at: "2026-01-01T00:00:00Z",
        },
        {
          user_id: "u2",
          name: "User 2",
          image: null,
          slug: "user-2",
          joined_at: "2026-02-01T00:00:00Z",
        },
      ];
      db.all.mockResolvedValue({ results: mockMembers });

      const request: ListOrgMembersRequest = {
        method: "organizations.listMembers",
        orgId: "o1",
      };
      const response = await handleOrganizationsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: mockMembers });
    });

    it("should return 400 when orgId missing", async () => {
      const request = {
        method: "organizations.listMembers",
        orgId: "",
      } as ListOrgMembersRequest;
      const response = await handleOrganizationsRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // organizations.listWithCount
  // -------------------------------------------------------------------------

  describe("organizations.listWithCount", () => {
    it("should return orgs with member_count", async () => {
      const rows = [
        {
          id: "o1",
          name: "A",
          slug: "a",
          logo_url: null,
          created_by: "u1",
          created_at: "",
          updated_at: "",
          member_count: 4,
        },
        {
          id: "o2",
          name: "B",
          slug: "b",
          logo_url: null,
          created_by: "u2",
          created_at: "",
          updated_at: "",
          member_count: 0,
        },
      ];
      db.all.mockResolvedValue({ results: rows });
      const req: ListOrganizationsWithCountRequest = { method: "organizations.listWithCount" };
      const res = await handleOrganizationsRpc(req, db);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ result: rows });
      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(sql).toContain("COUNT(om.id)");
      expect(sql).toContain("LEFT JOIN organization_members");
    });

    it("should return [] when no orgs", async () => {
      db.all.mockResolvedValue({ results: [] });
      const req: ListOrganizationsWithCountRequest = { method: "organizations.listWithCount" };
      expect(await (await handleOrganizationsRpc(req, db)).json()).toEqual({ result: [] });
    });
  });

  // -------------------------------------------------------------------------
  // organizations.getById
  // -------------------------------------------------------------------------

  describe("organizations.getById", () => {
    it("should return org row", async () => {
      const row = {
        id: "o1",
        name: "A",
        slug: "a",
        logo_url: null,
        created_by: "u1",
        created_at: "",
        updated_at: "",
      };
      db.first.mockResolvedValue(row);
      const req: GetOrganizationByIdRequest = { method: "organizations.getById", orgId: "o1" };
      const res = await handleOrganizationsRpc(req, db);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ result: row });
      expect(db.bind).toHaveBeenCalledWith("o1");
    });

    it("should return null when not found", async () => {
      db.first.mockResolvedValue(null);
      const req: GetOrganizationByIdRequest = { method: "organizations.getById", orgId: "x" };
      expect(await (await handleOrganizationsRpc(req, db)).json()).toEqual({ result: null });
    });

    it("should return 400 when orgId missing", async () => {
      const req = { method: "organizations.getById", orgId: "" } as GetOrganizationByIdRequest;
      expect((await handleOrganizationsRpc(req, db)).status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // organizations.getBySlug
  // -------------------------------------------------------------------------

  describe("organizations.getBySlug", () => {
    it("should return org row by slug", async () => {
      const row = {
        id: "o1",
        name: "A",
        slug: "a",
        logo_url: null,
        created_by: "u1",
        created_at: "",
        updated_at: "",
      };
      db.first.mockResolvedValue(row);
      const req: GetOrganizationBySlugRequest = { method: "organizations.getBySlug", slug: "a" };
      const res = await handleOrganizationsRpc(req, db);
      expect(await res.json()).toEqual({ result: row });
      expect(db.bind).toHaveBeenCalledWith("a");
    });

    it("should return null when slug not found", async () => {
      db.first.mockResolvedValue(null);
      const req: GetOrganizationBySlugRequest = { method: "organizations.getBySlug", slug: "x" };
      expect(await (await handleOrganizationsRpc(req, db)).json()).toEqual({ result: null });
    });

    it("should return 400 when slug missing", async () => {
      const req = { method: "organizations.getBySlug", slug: "" } as GetOrganizationBySlugRequest;
      expect((await handleOrganizationsRpc(req, db)).status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // organizations.checkMembership
  // -------------------------------------------------------------------------

  describe("organizations.checkMembership", () => {
    it("exists:true when row found", async () => {
      db.first.mockResolvedValue({ id: "m1" });
      const req: CheckOrgMembershipRequest = {
        method: "organizations.checkMembership",
        orgId: "o1",
        userId: "u1",
      };
      expect(await (await handleOrganizationsRpc(req, db)).json()).toEqual({
        result: { exists: true },
      });
      expect(db.bind).toHaveBeenCalledWith("o1", "u1");
    });

    it("exists:false when no row", async () => {
      db.first.mockResolvedValue(null);
      const req: CheckOrgMembershipRequest = {
        method: "organizations.checkMembership",
        orgId: "o1",
        userId: "u1",
      };
      expect(await (await handleOrganizationsRpc(req, db)).json()).toEqual({
        result: { exists: false },
      });
    });

    it("400 when orgId missing", async () => {
      const req = {
        method: "organizations.checkMembership",
        orgId: "",
        userId: "u",
      } as CheckOrgMembershipRequest;
      expect((await handleOrganizationsRpc(req, db)).status).toBe(400);
    });

    it("400 when userId missing", async () => {
      const req = {
        method: "organizations.checkMembership",
        orgId: "o",
        userId: "",
      } as CheckOrgMembershipRequest;
      expect((await handleOrganizationsRpc(req, db)).status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // organizations.listMembersAdmin
  // -------------------------------------------------------------------------

  describe("organizations.listMembersAdmin", () => {
    it("should return admin member rows incl email", async () => {
      const rows = [
        { user_id: "u1", name: "A", email: "a@x", image: null, slug: "a", joined_at: "" },
      ];
      db.all.mockResolvedValue({ results: rows });
      const req: ListOrgMembersAdminRequest = {
        method: "organizations.listMembersAdmin",
        orgId: "o1",
      };
      const res = await handleOrganizationsRpc(req, db);
      expect(await res.json()).toEqual({ result: rows });
      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(sql).toContain("u.email");
    });

    it("400 when orgId missing", async () => {
      const req = {
        method: "organizations.listMembersAdmin",
        orgId: "",
      } as ListOrgMembersAdminRequest;
      expect((await handleOrganizationsRpc(req, db)).status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // organizations.countMembers
  // -------------------------------------------------------------------------

  describe("organizations.countMembers", () => {
    it("should return numeric count", async () => {
      db.first.mockResolvedValue({ count: 7 });
      const req: CountOrgMembersRequest = {
        method: "organizations.countMembers",
        orgId: "o1",
      };
      expect(await (await handleOrganizationsRpc(req, db)).json()).toEqual({ result: 7 });
    });

    it("should return 0 when row null", async () => {
      db.first.mockResolvedValue(null);
      const req: CountOrgMembersRequest = {
        method: "organizations.countMembers",
        orgId: "o1",
      };
      expect(await (await handleOrganizationsRpc(req, db)).json()).toEqual({ result: 0 });
    });

    it("400 when orgId missing", async () => {
      const req = { method: "organizations.countMembers", orgId: "" } as CountOrgMembersRequest;
      expect((await handleOrganizationsRpc(req, db)).status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // organizations.listForUser — 400 path
  // -------------------------------------------------------------------------

  describe("organizations.listForUser 400", () => {
    it("400 when userId missing", async () => {
      const req = {
        method: "organizations.listForUser",
        userId: "",
      } as ListUserOrganizationsRequest;
      expect((await handleOrganizationsRpc(req, db)).status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // Unknown method
  // -------------------------------------------------------------------------

  describe("unknown method", () => {
    it("should return 400 for unknown method", async () => {
      const request = { method: "organizations.unknown" } as unknown as ListOrganizationsRequest;
      const response = await handleOrganizationsRpc(request, db);

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toContain("Unknown organizations method");
    });
  });
});
