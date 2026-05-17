import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleShowcasesRpc,
  type GetShowcaseByIdRequest,
  type GetShowcaseBySlugRequest,
  type GetShowcaseOwnerRequest,
  type CheckShowcaseExistsRequest,
  type CheckExistsByRepoKeyRequest,
  type CheckUpvoteExistsRequest,
  type GetUpvoteCountRequest,
  type ListShowcasesRequest,
  type CountShowcasesRequest,
} from "./showcases";
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

describe("showcases RPC handlers", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  // -------------------------------------------------------------------------
  // showcases.getById
  // -------------------------------------------------------------------------

  describe("showcases.getById", () => {
    it("should return showcase by ID", async () => {
      const mockShowcase = {
        id: "s1",
        user_id: "u1",
        title: "Test Showcase",
        description: "Test description",
        github_url: "https://github.com/test/repo",
        is_public: 1,
        upvote_count: 10,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        owner_name: "Test User",
        owner_slug: "test-user",
        owner_image: null,
      };
      db.first.mockResolvedValue(mockShowcase);

      const request: GetShowcaseByIdRequest = {
        method: "showcases.getById",
        showcaseId: "s1",
      };
      const response = await handleShowcasesRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: mockShowcase });
    });

    it("should return 400 when showcaseId missing", async () => {
      const request = {
        method: "showcases.getById",
        showcaseId: "",
      } as GetShowcaseByIdRequest;
      const response = await handleShowcasesRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // showcases.getBySlug
  // -------------------------------------------------------------------------

  describe("showcases.getBySlug", () => {
    it("should return showcase by slug", async () => {
      const mockShowcase = { id: "s1", title: "Test" };
      db.first.mockResolvedValue(mockShowcase);

      const request: GetShowcaseBySlugRequest = {
        method: "showcases.getBySlug",
        slug: "test-showcase",
      };
      const response = await handleShowcasesRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: mockShowcase });
    });

    it("should return 400 when slug missing", async () => {
      const request = {
        method: "showcases.getBySlug",
        slug: "",
      } as GetShowcaseBySlugRequest;
      const response = await handleShowcasesRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // showcases.getOwner
  // -------------------------------------------------------------------------

  describe("showcases.getOwner", () => {
    it("should return showcase owner info", async () => {
      db.first.mockResolvedValue({ id: "s1", user_id: "u1" });

      const request: GetShowcaseOwnerRequest = {
        method: "showcases.getOwner",
        showcaseId: "s1",
      };
      const response = await handleShowcasesRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: { id: "s1", user_id: "u1" } });
    });

    it("should return 400 when showcaseId missing", async () => {
      const request = {
        method: "showcases.getOwner",
        showcaseId: "",
      } as GetShowcaseOwnerRequest;
      const response = await handleShowcasesRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // showcases.checkExists
  // -------------------------------------------------------------------------

  describe("showcases.checkExists", () => {
    it("should return exists: true when showcase exists", async () => {
      db.first.mockResolvedValue({ id: "s1" });

      const request: CheckShowcaseExistsRequest = {
        method: "showcases.checkExists",
        userId: "u1",
        githubUrl: "https://github.com/test/repo",
      };
      const response = await handleShowcasesRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: { exists: true, id: "s1" } });
    });

    it("should return exists: false when not found", async () => {
      db.first.mockResolvedValue(null);

      const request: CheckShowcaseExistsRequest = {
        method: "showcases.checkExists",
        userId: "u1",
        githubUrl: "https://github.com/test/repo",
      };
      const response = await handleShowcasesRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: { exists: false, id: undefined } });
    });

    it("should return 400 when params missing", async () => {
      const request = {
        method: "showcases.checkExists",
        userId: "",
        githubUrl: "https://github.com/test/repo",
      } as CheckShowcaseExistsRequest;
      const response = await handleShowcasesRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // showcases.checkExistsByRepoKey
  // -------------------------------------------------------------------------

  describe("showcases.checkExistsByRepoKey", () => {
    it("should return exists: true when showcase exists", async () => {
      db.first.mockResolvedValue({ id: "s1" });

      const request: CheckExistsByRepoKeyRequest = {
        method: "showcases.checkExistsByRepoKey",
        repoKey: "owner/repo",
      };
      const response = await handleShowcasesRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: { exists: true, id: "s1" } });
    });

    it("should return exists: false when not found", async () => {
      db.first.mockResolvedValue(null);

      const request: CheckExistsByRepoKeyRequest = {
        method: "showcases.checkExistsByRepoKey",
        repoKey: "owner/repo",
      };
      const response = await handleShowcasesRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: { exists: false, id: undefined } });
    });

    it("should return 400 when repoKey missing", async () => {
      const request = {
        method: "showcases.checkExistsByRepoKey",
        repoKey: "",
      } as CheckExistsByRepoKeyRequest;
      const response = await handleShowcasesRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // showcases.checkUpvote
  // -------------------------------------------------------------------------

  describe("showcases.checkUpvote", () => {
    it("should return exists: true when upvote exists", async () => {
      db.first.mockResolvedValue({ id: 1 });

      const request: CheckUpvoteExistsRequest = {
        method: "showcases.checkUpvote",
        showcaseId: "s1",
        visitorId: "v1",
      };
      const response = await handleShowcasesRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: { exists: true } });
    });

    it("should return exists: false when no upvote", async () => {
      db.first.mockResolvedValue(null);

      const request: CheckUpvoteExistsRequest = {
        method: "showcases.checkUpvote",
        showcaseId: "s1",
        visitorId: "v1",
      };
      const response = await handleShowcasesRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: { exists: false } });
    });

    it("should return 400 when params missing", async () => {
      const request = {
        method: "showcases.checkUpvote",
        showcaseId: "s1",
        visitorId: "",
      } as CheckUpvoteExistsRequest;
      const response = await handleShowcasesRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // showcases.getUpvoteCount
  // -------------------------------------------------------------------------

  describe("showcases.getUpvoteCount", () => {
    it("should return upvote count", async () => {
      db.first.mockResolvedValue({ count: 42 });

      const request: GetUpvoteCountRequest = {
        method: "showcases.getUpvoteCount",
        showcaseId: "s1",
      };
      const response = await handleShowcasesRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: 42 });
    });

    it("should return 0 when null result", async () => {
      db.first.mockResolvedValue(null);

      const request: GetUpvoteCountRequest = {
        method: "showcases.getUpvoteCount",
        showcaseId: "s1",
      };
      const response = await handleShowcasesRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: 0 });
    });

    it("should return 400 when showcaseId missing", async () => {
      const request = {
        method: "showcases.getUpvoteCount",
        showcaseId: "",
      } as GetUpvoteCountRequest;
      const response = await handleShowcasesRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // showcases.list
  // -------------------------------------------------------------------------

  describe("showcases.list", () => {
    it("should return list of showcases", async () => {
      const mockShowcases = [{ id: "s1", title: "Test 1" }, { id: "s2", title: "Test 2" }];
      db.all.mockResolvedValue({ results: mockShowcases });

      const request: ListShowcasesRequest = {
        method: "showcases.list",
        publicOnly: true,
        limit: 10,
        offset: 0,
      };
      const response = await handleShowcasesRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: mockShowcases });
    });

    it("should filter by userId when provided", async () => {
      db.all.mockResolvedValue({ results: [] });

      const request: ListShowcasesRequest = {
        method: "showcases.list",
        userId: "u1",
        limit: 10,
        offset: 0,
      };
      await handleShowcasesRpc(request, db);

      expect(db.bind).toHaveBeenCalled();
    });

    it("includes has_upvoted column when currentUserId is provided", async () => {
      db.all.mockResolvedValue({ results: [] });
      const request: ListShowcasesRequest = {
        method: "showcases.list",
        currentUserId: "viewer-1",
        publicOnly: true,
        limit: 5,
        offset: 0,
      };
      await handleShowcasesRpc(request, db);
      const sql = db.prepare.mock.calls.at(-1)?.[0] as string;
      expect(sql).toContain("has_upvoted");
      // currentUserId is the first bound param.
      const bindArgs = db.bind.mock.calls.at(-1) as unknown[];
      expect(bindArgs[0]).toBe("viewer-1");
    });

    it("orders by upvote_count when orderBy is set", async () => {
      db.all.mockResolvedValue({ results: [] });
      const request: ListShowcasesRequest = {
        method: "showcases.list",
        publicOnly: true,
        orderBy: "upvote_count",
        limit: 5,
        offset: 0,
      };
      await handleShowcasesRpc(request, db);
      const sql = db.prepare.mock.calls.at(-1)?.[0] as string;
      expect(sql).toContain("ORDER BY upvote_count DESC");
    });
  });

  // -------------------------------------------------------------------------
  // showcases.count
  // -------------------------------------------------------------------------

  describe("showcases.count", () => {
    it("should return total count", async () => {
      db.first.mockResolvedValue({ count: 100 });

      const request: CountShowcasesRequest = {
        method: "showcases.count",
        publicOnly: true,
      };
      const response = await handleShowcasesRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: 100 });
    });

    it("should return 0 when null result", async () => {
      db.first.mockResolvedValue(null);

      const request: CountShowcasesRequest = {
        method: "showcases.count",
      };
      const response = await handleShowcasesRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: 0 });
    });

    it("filters by userId in count query", async () => {
      db.first.mockResolvedValue({ count: 7 });
      const request: CountShowcasesRequest = {
        method: "showcases.count",
        userId: "u1",
      };
      const response = await handleShowcasesRpc(request, db);
      const body = (await response.json()) as { result: number };
      expect(body.result).toBe(7);
      const sql = db.prepare.mock.calls.at(-1)?.[0] as string;
      expect(sql).toContain("WHERE user_id = ?");
      const bindArgs = db.bind.mock.calls.at(-1) as unknown[];
      expect(bindArgs[0]).toBe("u1");
    });
  });

  // -------------------------------------------------------------------------
  // Unknown method
  // -------------------------------------------------------------------------

  describe("unknown method", () => {
    it("should return 400 for unknown method", async () => {
      const request = { method: "showcases.unknown" } as unknown as GetShowcaseByIdRequest;
      const response = await handleShowcasesRpc(request, db);

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toContain("Unknown showcases method");
    });
  });
});
