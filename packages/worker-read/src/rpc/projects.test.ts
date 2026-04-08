import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleProjectsRpc,
  type ListProjectsRequest,
  type ListAliasesWithStatsRequest,
  type ListUnassignedRefsRequest,
  type ListProjectTagsRequest,
  type GetProjectByNameRequest,
  type GetProjectByIdRequest,
  type SessionRecordExistsRequest,
  type GetAliasOwnerRequest,
  type AliasAttachedToProjectRequest,
  type ProjectTagExistsRequest,
  type GetProjectAliasStatsRequest,
  type GetProjectTagListRequest,
  type GetProjectTimelineRequest,
  type GetProjectByNameExcludingRequest,
  type ProjectExistsForUserRequest,
} from "./projects";
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

describe("projects RPC handlers", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  // -------------------------------------------------------------------------
  // projects.list
  // -------------------------------------------------------------------------

  describe("projects.list", () => {
    it("should return list of projects", async () => {
      const mockProjects = [
        { id: "p1", name: "Project 1", created_at: "2026-01-01T00:00:00Z" },
        { id: "p2", name: "Project 2", created_at: "2026-01-02T00:00:00Z" },
      ];
      db.all.mockResolvedValue({ results: mockProjects });

      const request: ListProjectsRequest = {
        method: "projects.list",
        userId: "u1",
      };
      const response = await handleProjectsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: mockProjects });
    });

    it("should return 400 when userId is missing", async () => {
      const request = { method: "projects.list", userId: "" } as ListProjectsRequest;
      const response = await handleProjectsRpc(request, db);

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toContain("userId");
    });
  });

  // -------------------------------------------------------------------------
  // projects.listAliasesWithStats
  // -------------------------------------------------------------------------

  describe("projects.listAliasesWithStats", () => {
    it("should return aliases with stats (all time)", async () => {
      const mockAliases = [
        {
          source: "claude",
          project_ref: "/path/to/project",
          project_id: "p1",
          session_count: 10,
          last_active: "2026-01-15T10:00:00Z",
          total_duration_seconds: 3600,
        },
      ];
      db.all.mockResolvedValue({ results: mockAliases });

      const request: ListAliasesWithStatsRequest = {
        method: "projects.listAliasesWithStats",
        userId: "u1",
      };
      const response = await handleProjectsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: mockAliases });
    });

    it("should return aliases with date range filter", async () => {
      db.all.mockResolvedValue({ results: [] });

      const request: ListAliasesWithStatsRequest = {
        method: "projects.listAliasesWithStats",
        userId: "u1",
        from: "2026-01-01T00:00:00Z",
        to: "2026-02-01T00:00:00Z",
      };
      const response = await handleProjectsRpc(request, db);

      expect(response.status).toBe(200);
      expect(db.bind).toHaveBeenCalledWith("u1", "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z");
    });

    it("should return 400 when userId is missing", async () => {
      const request = {
        method: "projects.listAliasesWithStats",
        userId: "",
      } as ListAliasesWithStatsRequest;
      const response = await handleProjectsRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // projects.listUnassignedRefs
  // -------------------------------------------------------------------------

  describe("projects.listUnassignedRefs", () => {
    it("should return unassigned refs", async () => {
      const mockRefs = [
        {
          source: "claude",
          project_ref: "/unassigned/path",
          session_count: 5,
          last_active: "2026-01-10T10:00:00Z",
          total_duration_seconds: 1800,
        },
      ];
      db.all.mockResolvedValue({ results: mockRefs });

      const request: ListUnassignedRefsRequest = {
        method: "projects.listUnassignedRefs",
        userId: "u1",
      };
      const response = await handleProjectsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: mockRefs });
    });

    it("should return 400 when userId is missing", async () => {
      const request = {
        method: "projects.listUnassignedRefs",
        userId: "",
      } as ListUnassignedRefsRequest;
      const response = await handleProjectsRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // projects.listTags
  // -------------------------------------------------------------------------

  describe("projects.listTags", () => {
    it("should return all project tags for user", async () => {
      const mockTags = [
        { project_id: "p1", tag: "frontend" },
        { project_id: "p1", tag: "react" },
        { project_id: "p2", tag: "backend" },
      ];
      db.all.mockResolvedValue({ results: mockTags });

      const request: ListProjectTagsRequest = {
        method: "projects.listTags",
        userId: "u1",
      };
      const response = await handleProjectsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: mockTags });
    });

    it("should return 400 when userId is missing", async () => {
      const request = { method: "projects.listTags", userId: "" } as ListProjectTagsRequest;
      const response = await handleProjectsRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // projects.getByName
  // -------------------------------------------------------------------------

  describe("projects.getByName", () => {
    it("should return project id when found", async () => {
      db.first.mockResolvedValue({ id: "p1" });

      const request: GetProjectByNameRequest = {
        method: "projects.getByName",
        userId: "u1",
        name: "My Project",
      };
      const response = await handleProjectsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: { id: "p1" } });
    });

    it("should return null when not found", async () => {
      db.first.mockResolvedValue(null);

      const request: GetProjectByNameRequest = {
        method: "projects.getByName",
        userId: "u1",
        name: "Nonexistent",
      };
      const response = await handleProjectsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: null });
    });

    it("should return 400 when params missing", async () => {
      const request = {
        method: "projects.getByName",
        userId: "u1",
        name: "",
      } as GetProjectByNameRequest;
      const response = await handleProjectsRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // projects.getById
  // -------------------------------------------------------------------------

  describe("projects.getById", () => {
    it("should return project when found", async () => {
      const mockProject = {
        id: "p1",
        name: "My Project",
        created_at: "2026-01-01T00:00:00Z",
      };
      db.first.mockResolvedValue(mockProject);

      const request: GetProjectByIdRequest = {
        method: "projects.getById",
        userId: "u1",
        projectId: "p1",
      };
      const response = await handleProjectsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: mockProject });
    });

    it("should return null when not found", async () => {
      db.first.mockResolvedValue(null);

      const request: GetProjectByIdRequest = {
        method: "projects.getById",
        userId: "u1",
        projectId: "nonexistent",
      };
      const response = await handleProjectsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: null });
    });

    it("should return 400 when params missing", async () => {
      const request = {
        method: "projects.getById",
        userId: "",
        projectId: "p1",
      } as GetProjectByIdRequest;
      const response = await handleProjectsRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // projects.sessionRecordExists
  // -------------------------------------------------------------------------

  describe("projects.sessionRecordExists", () => {
    it("should return exists: true when record exists", async () => {
      db.first.mockResolvedValue({ "1": 1 });

      const request: SessionRecordExistsRequest = {
        method: "projects.sessionRecordExists",
        userId: "u1",
        source: "claude",
        projectRef: "/path/to/project",
      };
      const response = await handleProjectsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: { exists: true } });
    });

    it("should return exists: false when not found", async () => {
      db.first.mockResolvedValue(null);

      const request: SessionRecordExistsRequest = {
        method: "projects.sessionRecordExists",
        userId: "u1",
        source: "claude",
        projectRef: "/nonexistent",
      };
      const response = await handleProjectsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: { exists: false } });
    });

    it("should return 400 when params missing", async () => {
      const request = {
        method: "projects.sessionRecordExists",
        userId: "u1",
        source: "",
        projectRef: "/path",
      } as SessionRecordExistsRequest;
      const response = await handleProjectsRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // projects.getAliasOwner
  // -------------------------------------------------------------------------

  describe("projects.getAliasOwner", () => {
    it("should return project_id when alias exists", async () => {
      db.first.mockResolvedValue({ project_id: "p1" });

      const request: GetAliasOwnerRequest = {
        method: "projects.getAliasOwner",
        userId: "u1",
        source: "claude",
        projectRef: "/path/to/project",
      };
      const response = await handleProjectsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: { project_id: "p1" } });
    });

    it("should return null when alias not found", async () => {
      db.first.mockResolvedValue(null);

      const request: GetAliasOwnerRequest = {
        method: "projects.getAliasOwner",
        userId: "u1",
        source: "claude",
        projectRef: "/unassigned",
      };
      const response = await handleProjectsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: null });
    });
  });

  // -------------------------------------------------------------------------
  // projects.aliasAttachedToProject
  // -------------------------------------------------------------------------

  describe("projects.aliasAttachedToProject", () => {
    it("should return attached: true when alias belongs to project", async () => {
      db.first.mockResolvedValue({ project_id: "p1" });

      const request: AliasAttachedToProjectRequest = {
        method: "projects.aliasAttachedToProject",
        userId: "u1",
        projectId: "p1",
        source: "claude",
        projectRef: "/path/to/project",
      };
      const response = await handleProjectsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: { attached: true } });
    });

    it("should return attached: false when alias not attached", async () => {
      db.first.mockResolvedValue(null);

      const request: AliasAttachedToProjectRequest = {
        method: "projects.aliasAttachedToProject",
        userId: "u1",
        projectId: "p1",
        source: "claude",
        projectRef: "/different/path",
      };
      const response = await handleProjectsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: { attached: false } });
    });
  });

  // -------------------------------------------------------------------------
  // projects.tagExists
  // -------------------------------------------------------------------------

  describe("projects.tagExists", () => {
    it("should return exists: true when tag exists", async () => {
      db.first.mockResolvedValue({ tag: "frontend" });

      const request: ProjectTagExistsRequest = {
        method: "projects.tagExists",
        userId: "u1",
        projectId: "p1",
        tag: "frontend",
      };
      const response = await handleProjectsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: { exists: true } });
    });

    it("should return exists: false when tag not found", async () => {
      db.first.mockResolvedValue(null);

      const request: ProjectTagExistsRequest = {
        method: "projects.tagExists",
        userId: "u1",
        projectId: "p1",
        tag: "nonexistent",
      };
      const response = await handleProjectsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: { exists: false } });
    });
  });

  // -------------------------------------------------------------------------
  // projects.getAliasStats
  // -------------------------------------------------------------------------

  describe("projects.getAliasStats", () => {
    it("should return alias stats for project", async () => {
      const mockStats = [
        {
          source: "claude",
          project_ref: "/path1",
          project_id: "p1",
          session_count: 5,
          last_active: "2026-01-15T10:00:00Z",
          total_duration_seconds: 1800,
        },
        {
          source: "copilot",
          project_ref: "/path2",
          project_id: "p1",
          session_count: 3,
          last_active: "2026-01-14T10:00:00Z",
          total_duration_seconds: 900,
        },
      ];
      db.all.mockResolvedValue({ results: mockStats });

      const request: GetProjectAliasStatsRequest = {
        method: "projects.getAliasStats",
        projectId: "p1",
      };
      const response = await handleProjectsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: mockStats });
    });

    it("should return 400 when projectId is missing", async () => {
      const request = {
        method: "projects.getAliasStats",
        projectId: "",
      } as GetProjectAliasStatsRequest;
      const response = await handleProjectsRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // projects.getTagList
  // -------------------------------------------------------------------------

  describe("projects.getTagList", () => {
    it("should return tag list for project", async () => {
      db.all.mockResolvedValue({
        results: [{ tag: "backend" }, { tag: "frontend" }, { tag: "react" }],
      });

      const request: GetProjectTagListRequest = {
        method: "projects.getTagList",
        userId: "u1",
        projectId: "p1",
      };
      const response = await handleProjectsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: ["backend", "frontend", "react"] });
    });

    it("should return empty array when no tags", async () => {
      db.all.mockResolvedValue({ results: [] });

      const request: GetProjectTagListRequest = {
        method: "projects.getTagList",
        userId: "u1",
        projectId: "p1",
      };
      const response = await handleProjectsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: [] });
    });
  });

  // -------------------------------------------------------------------------
  // projects.getTimeline
  // -------------------------------------------------------------------------

  describe("projects.getTimeline", () => {
    it("should return timeline data", async () => {
      const mockTimeline = [
        { project_id: "p1", day: "2026-01-15", session_count: 3 },
        { project_id: "p1", day: "2026-01-16", session_count: 5 },
        { project_id: "p2", day: "2026-01-15", session_count: 2 },
      ];
      db.all.mockResolvedValue({ results: mockTimeline });

      const request: GetProjectTimelineRequest = {
        method: "projects.getTimeline",
        userId: "u1",
        from: "2026-01-01T00:00:00Z",
        to: "2026-02-01T00:00:00Z",
      };
      const response = await handleProjectsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: mockTimeline });
    });

    it("should return 400 when params missing", async () => {
      const request = {
        method: "projects.getTimeline",
        userId: "u1",
        from: "",
        to: "2026-02-01T00:00:00Z",
      } as GetProjectTimelineRequest;
      const response = await handleProjectsRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // projects.getByNameExcluding
  // -------------------------------------------------------------------------

  describe("projects.getByNameExcluding", () => {
    it("should return project when found (excluding specified id)", async () => {
      db.first.mockResolvedValue({ id: "p2" });

      const request: GetProjectByNameExcludingRequest = {
        method: "projects.getByNameExcluding",
        userId: "u1",
        name: "My Project",
        excludeId: "p1",
      };
      const response = await handleProjectsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: { id: "p2" } });
    });

    it("should return null when no other project with same name", async () => {
      db.first.mockResolvedValue(null);

      const request: GetProjectByNameExcludingRequest = {
        method: "projects.getByNameExcluding",
        userId: "u1",
        name: "Unique Name",
        excludeId: "p1",
      };
      const response = await handleProjectsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: null });
    });
  });

  // -------------------------------------------------------------------------
  // projects.existsForUser
  // -------------------------------------------------------------------------

  describe("projects.existsForUser", () => {
    it("should return exists: true when project belongs to user", async () => {
      db.first.mockResolvedValue({ id: "p1" });

      const request: ProjectExistsForUserRequest = {
        method: "projects.existsForUser",
        userId: "u1",
        projectId: "p1",
      };
      const response = await handleProjectsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: { exists: true } });
    });

    it("should return exists: false when project not owned", async () => {
      db.first.mockResolvedValue(null);

      const request: ProjectExistsForUserRequest = {
        method: "projects.existsForUser",
        userId: "u1",
        projectId: "other-project",
      };
      const response = await handleProjectsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: { exists: false } });
    });
  });

  // -------------------------------------------------------------------------
  // Unknown method
  // -------------------------------------------------------------------------

  describe("unknown method", () => {
    it("should return 400 for unknown method", async () => {
      const request = { method: "projects.unknown" } as unknown as ListProjectsRequest;
      const response = await handleProjectsRpc(request, db);

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toContain("Unknown projects method");
    });
  });
});
