import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDbRead, createMockDbWrite, loadMockedAuthHelpers } from "./test-utils";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
  getDbWrite: vi.fn(),
}));

// Mock resolveUser
vi.mock("@/lib/auth-helpers", () => ({
  resolveUser: vi.fn(),
}));

import * as dbModule from "@/lib/db";

const { resolveUser } = await loadMockedAuthHelpers();

function makePostRequest(body: unknown): Request {
  return new Request("http://localhost:7020/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makePatchRequest(body: unknown): Request {
  return new Request("http://localhost:7020/api/projects/proj-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeDeleteRequest(): Request {
  return new Request("http://localhost:7020/api/projects/proj-1", {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// PATCH /api/projects/:id
// ---------------------------------------------------------------------------

describe("PATCH /api/projects/:id", () => {
  let PATCH: (
    req: Request,
    ctx: { params: Promise<{ id: string }> },
  ) => Promise<Response>;
  let mockDbRead: ReturnType<typeof createMockDbRead>;
  let mockDbWrite: ReturnType<typeof createMockDbWrite>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    mockDbWrite = createMockDbWrite();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as never);
    vi.mocked(dbModule.getDbWrite).mockResolvedValue(mockDbWrite as never);
    const mod = await import("@/app/api/projects/[id]/route");
    PATCH = mod.PATCH;
  });

  function callPatch(body: unknown) {
    return PATCH(makePatchRequest(body), {
      params: Promise.resolve({ id: "proj-1" }),
    });
  }

  describe("authentication", () => {
    it("should reject unauthenticated requests with 401", async () => {
      vi.mocked(resolveUser).mockResolvedValueOnce(null);

      const res = await callPatch({ name: "new-name" });

      expect(res.status).toBe(401);
    });
  });

  describe("project not found", () => {
    it("should return 404 when project does not exist", async () => {
      vi.mocked(resolveUser).mockResolvedValueOnce({
        userId: "u1",
        email: "test@example.com",
      });
      mockDbRead.getProjectById.mockResolvedValueOnce(null); // project lookup

      const res = await callPatch({ name: "new-name" });

      expect(res.status).toBe(404);
    });
  });

  describe("validation-only phase (no writes on failure)", () => {
    beforeEach(() => {
      vi.mocked(resolveUser).mockResolvedValue({
        userId: "u1",
        email: "test@example.com",
      });
    });

    it("should reject empty name", async () => {
      mockDbRead.getProjectById.mockResolvedValueOnce({
        id: "proj-1",
        name: "Old Name",
        created_at: "2026-01-01T00:00:00Z",
      }); // project exists

      const res = await callPatch({ name: "  " });

      expect(res.status).toBe(400);
      expect(mockDbWrite.execute).not.toHaveBeenCalled();
    });

    it("should reject name exceeding max length", async () => {
      mockDbRead.getProjectById.mockResolvedValueOnce({
        id: "proj-1",
        name: "Old Name",
        created_at: "2026-01-01T00:00:00Z",
      });

      const res = await callPatch({ name: "x".repeat(101) });

      expect(res.status).toBe(400);
      expect(mockDbWrite.execute).not.toHaveBeenCalled();
    });

    it("should reject duplicate name with 409", async () => {
      mockDbRead.getProjectById.mockResolvedValueOnce({
        id: "proj-1",
        name: "Old Name",
        created_at: "2026-01-01T00:00:00Z",
      }); // project exists
      mockDbRead.getProjectByNameExcluding.mockResolvedValueOnce({ id: "proj-2" }); // name already taken

      const res = await callPatch({ name: "Taken Name" });

      expect(res.status).toBe(409);
      expect(mockDbWrite.execute).not.toHaveBeenCalled();
    });

    it("should reject aliases referencing non-existent session data", async () => {
      mockDbRead.getProjectById.mockResolvedValueOnce({
        id: "proj-1",
        name: "Old Name",
        created_at: "2026-01-01T00:00:00Z",
      }); // project exists
      mockDbRead.sessionRecordExists.mockResolvedValueOnce(false); // alias session data not found

      const res = await callPatch({
        add_aliases: [{ source: "claude-code", project_ref: "abc123" }],
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.invalid_aliases).toHaveLength(1);
      expect(mockDbWrite.execute).not.toHaveBeenCalled();
    });

    it("should reject alias already assigned to another project", async () => {
      mockDbRead.getProjectById.mockResolvedValueOnce({
        id: "proj-1",
        name: "Old Name",
        created_at: "2026-01-01T00:00:00Z",
      }); // project exists
      mockDbRead.sessionRecordExists.mockResolvedValueOnce(true); // session data exists
      mockDbRead.getAliasOwner.mockResolvedValueOnce({ project_id: "proj-other" }); // alias taken by another

      const res = await callPatch({
        add_aliases: [{ source: "claude-code", project_ref: "abc123" }],
      });

      expect(res.status).toBe(409);
      expect(mockDbWrite.execute).not.toHaveBeenCalled();
    });

    it("should reject invalid source in add_aliases", async () => {
      mockDbRead.getProjectById.mockResolvedValueOnce({
        id: "proj-1",
        name: "Old Name",
        created_at: "2026-01-01T00:00:00Z",
      });

      const res = await callPatch({
        add_aliases: [{ source: "invalid-tool", project_ref: "abc" }],
      });

      expect(res.status).toBe(400);
      expect(mockDbWrite.execute).not.toHaveBeenCalled();
    });

    it("should reject reserved name 'Unassigned' (case-insensitive)", async () => {
      mockDbRead.getProjectById.mockResolvedValueOnce({
        id: "proj-1",
        name: "Old Name",
        created_at: "2026-01-01T00:00:00Z",
      }); // project exists

      const res = await callPatch({ name: "Unassigned" });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("reserved");
      expect(mockDbWrite.execute).not.toHaveBeenCalled();
    });

    it("should reject reserved name 'unassigned' (lowercase)", async () => {
      mockDbRead.getProjectById.mockResolvedValueOnce({
        id: "proj-1",
        name: "Old Name",
        created_at: "2026-01-01T00:00:00Z",
      });

      const res = await callPatch({ name: "unassigned" });

      expect(res.status).toBe(400);
      expect(mockDbWrite.execute).not.toHaveBeenCalled();
    });

    it("should reject invalid JSON body", async () => {
      const req = new Request("http://localhost:7020/api/projects/proj-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "not-json{{{",
      });
      const res = await PATCH(req, {
        params: Promise.resolve({ id: "proj-1" }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Invalid JSON");
    });

    it("should reject add_aliases that is not an array", async () => {
      mockDbRead.getProjectById.mockResolvedValueOnce({
        id: "proj-1",
        name: "Old Name",
        created_at: "2026-01-01T00:00:00Z",
      });

      const res = await callPatch({ add_aliases: "not-array" });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("must be an array");
      expect(mockDbWrite.execute).not.toHaveBeenCalled();
    });

    it("should reject add_aliases entry missing source/project_ref", async () => {
      mockDbRead.getProjectById.mockResolvedValueOnce({
        id: "proj-1",
        name: "Old Name",
        created_at: "2026-01-01T00:00:00Z",
      });

      const res = await callPatch({ add_aliases: [{ bad: true }] });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("source and project_ref");
      expect(mockDbWrite.execute).not.toHaveBeenCalled();
    });

    it("should reject add_aliases exceeding MAX_ALIASES", async () => {
      mockDbRead.getProjectById.mockResolvedValueOnce({
        id: "proj-1",
        name: "Old Name",
        created_at: "2026-01-01T00:00:00Z",
      });

      const tooMany = Array.from({ length: 51 }, (_, i) => ({
        source: "claude-code",
        project_ref: `ref-${i}`,
      }));
      const res = await callPatch({ add_aliases: tooMany });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Maximum");
      expect(mockDbWrite.execute).not.toHaveBeenCalled();
    });

    it("should reject remove_aliases exceeding MAX_ALIASES", async () => {
      mockDbRead.getProjectById.mockResolvedValueOnce({
        id: "proj-1",
        name: "Old Name",
        created_at: "2026-01-01T00:00:00Z",
      });

      const tooMany = Array.from({ length: 51 }, (_, i) => ({
        source: "claude-code",
        project_ref: `ref-${i}`,
      }));
      const res = await callPatch({ remove_aliases: tooMany });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Maximum");
      expect(mockDbWrite.execute).not.toHaveBeenCalled();
    });

    it("should reject add_tags that is not an array", async () => {
      mockDbRead.getProjectById.mockResolvedValueOnce({
        id: "proj-1",
        name: "Old Name",
        created_at: "2026-01-01T00:00:00Z",
      });

      const res = await callPatch({ add_tags: "not-array" });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("add_tags must be an array");
      expect(mockDbWrite.execute).not.toHaveBeenCalled();
    });

    it("should reject add_tags exceeding MAX_TAGS", async () => {
      mockDbRead.getProjectById.mockResolvedValueOnce({
        id: "proj-1",
        name: "Old Name",
        created_at: "2026-01-01T00:00:00Z",
      });

      const tooMany = Array.from({ length: 51 }, (_, i) => `tag-${i}`);
      const res = await callPatch({ add_tags: tooMany });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Maximum");
      expect(mockDbWrite.execute).not.toHaveBeenCalled();
    });

    it("should reject non-string tag in add_tags", async () => {
      mockDbRead.getProjectById.mockResolvedValueOnce({
        id: "proj-1",
        name: "Old Name",
        created_at: "2026-01-01T00:00:00Z",
      });

      const res = await callPatch({ add_tags: [123] });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("must be a string");
      expect(mockDbWrite.execute).not.toHaveBeenCalled();
    });

    it("should reject invalid tag format in add_tags", async () => {
      mockDbRead.getProjectById.mockResolvedValueOnce({
        id: "proj-1",
        name: "Old Name",
        created_at: "2026-01-01T00:00:00Z",
      });

      const res = await callPatch({ add_tags: ["INVALID TAG!"] });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Invalid tag");
      expect(mockDbWrite.execute).not.toHaveBeenCalled();
    });

    it("should reject remove_tags that is not an array", async () => {
      mockDbRead.getProjectById.mockResolvedValueOnce({
        id: "proj-1",
        name: "Old Name",
        created_at: "2026-01-01T00:00:00Z",
      });

      const res = await callPatch({ remove_tags: "not-array" });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("remove_tags must be an array");
      expect(mockDbWrite.execute).not.toHaveBeenCalled();
    });

    it("should reject remove_tags exceeding MAX_TAGS", async () => {
      mockDbRead.getProjectById.mockResolvedValueOnce({
        id: "proj-1",
        name: "Old Name",
        created_at: "2026-01-01T00:00:00Z",
      });

      const tooMany = Array.from({ length: 51 }, (_, i) => `tag-${i}`);
      const res = await callPatch({ remove_tags: tooMany });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Maximum");
      expect(mockDbWrite.execute).not.toHaveBeenCalled();
    });

    it("should reject non-string tag in remove_tags", async () => {
      mockDbRead.getProjectById.mockResolvedValueOnce({
        id: "proj-1",
        name: "Old Name",
        created_at: "2026-01-01T00:00:00Z",
      });

      const res = await callPatch({ remove_tags: [42] });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("must be a string");
      expect(mockDbWrite.execute).not.toHaveBeenCalled();
    });

    it("should reject remove_aliases with invalid format (not an array)", async () => {
      mockDbRead.getProjectById.mockResolvedValueOnce({
        id: "proj-1",
        name: "Old Name",
        created_at: "2026-01-01T00:00:00Z",
      });

      const res = await callPatch({ remove_aliases: "not-an-array" });

      expect(res.status).toBe(400);
      expect(mockDbWrite.execute).not.toHaveBeenCalled();
    });

    it("should reject remove_aliases not attached to this project", async () => {
      mockDbRead.getProjectById.mockResolvedValueOnce({
        id: "proj-1",
        name: "Old Name",
        created_at: "2026-01-01T00:00:00Z",
      }); // project exists
      mockDbRead.aliasAttachedToProject.mockResolvedValueOnce(false); // alias not found on this project

      const res = await callPatch({
        remove_aliases: [{ source: "claude-code", project_ref: "not-here" }],
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.not_found_aliases).toHaveLength(1);
      expect(body.not_found_aliases[0].project_ref).toBe("not-here");
      expect(mockDbWrite.execute).not.toHaveBeenCalled();
    });
  });

  describe("rollback on write failure", () => {
    beforeEach(() => {
      vi.mocked(resolveUser).mockResolvedValue({
        userId: "u1",
        email: "test@example.com",
      });
    });

    it("should roll back name rename when add_aliases write fails", async () => {
      // Phase 1: all validation passes
      mockDbRead.getProjectById.mockResolvedValueOnce({
        id: "proj-1",
        name: "Old Name",
        created_at: "2026-01-01T00:00:00Z",
      }); // project exists
      mockDbRead.getProjectByNameExcluding.mockResolvedValueOnce(null); // name not taken
      mockDbRead.sessionRecordExists.mockResolvedValueOnce(true); // session data exists for alias
      mockDbRead.getAliasOwner.mockResolvedValueOnce(null); // alias not taken by another

      // Phase 2: rename succeeds, alias insert fails
      mockDbWrite.execute
        .mockResolvedValueOnce({ meta: {} }) // UPDATE name succeeds
        .mockRejectedValueOnce(new Error("UNIQUE constraint failed")) // INSERT alias fails
        // Rollback calls:
        .mockResolvedValueOnce({ meta: {} }) // restore original name
        .mockResolvedValueOnce({ meta: {} }); // (no aliasesAdded to clean up — it failed before push)

      const res = await callPatch({
        name: "New Name",
        add_aliases: [{ source: "claude-code", project_ref: "abc123" }],
      });

      expect(res.status).toBe(500);

      // Verify rollback restored original name
      const rollbackCall = mockDbWrite.execute.mock.calls[2];
      expect(rollbackCall![0]).toContain("UPDATE projects SET name = ?");
      expect(rollbackCall![1]).toContain("Old Name");
    });

    it("should roll back added aliases when later remove_aliases write fails", async () => {
      mockDbRead.getProjectById.mockResolvedValueOnce({
        id: "proj-1",
        name: "Old Name",
        created_at: "2026-01-01T00:00:00Z",
      }); // project exists
      mockDbRead.sessionRecordExists.mockResolvedValueOnce(true); // session data exists for add alias
      mockDbRead.getAliasOwner.mockResolvedValueOnce(null); // alias not taken (truly new)
      mockDbRead.aliasAttachedToProject.mockResolvedValueOnce(true); // remove alias is attached to this project

      // Phase 2: add succeeds, remove fails
      mockDbWrite.execute
        .mockResolvedValueOnce({ meta: {} }) // INSERT alias succeeds
        .mockRejectedValueOnce(new Error("D1 error")) // DELETE alias fails
        // Rollback: delete added alias
        .mockResolvedValueOnce({ meta: {} });

      const res = await callPatch({
        add_aliases: [{ source: "claude-code", project_ref: "abc123" }],
        remove_aliases: [{ source: "opencode", project_ref: "def456" }],
      });

      expect(res.status).toBe(500);

      // Verify the added alias was cleaned up in rollback
      const rollbackCall = mockDbWrite.execute.mock.calls[2];
      expect(rollbackCall![0]).toContain(
        "DELETE FROM project_aliases",
      );
    });

    it("should NOT delete pre-existing alias during rollback when add_aliases includes it", async () => {
      // Scenario: alias already attached to this project, request "adds" it again,
      // then a later write fails. The pre-existing alias must survive rollback.
      mockDbRead.getProjectById.mockResolvedValueOnce({
        id: "proj-1",
        name: "Old Name",
        created_at: "2026-01-01T00:00:00Z",
      }); // project exists
      mockDbRead.sessionRecordExists.mockResolvedValueOnce(true); // session data exists for alias
      mockDbRead.getAliasOwner.mockResolvedValueOnce({ project_id: "proj-1" }); // alias already on this project (pre-existing)
      mockDbRead.aliasAttachedToProject.mockResolvedValueOnce(true); // remove alias is attached

      // Phase 2: no INSERT for pre-existing alias; remove fails
      mockDbWrite.execute
        .mockRejectedValueOnce(new Error("D1 error")); // DELETE remove_alias fails

      const res = await callPatch({
        add_aliases: [{ source: "claude-code", project_ref: "abc123" }],
        remove_aliases: [{ source: "opencode", project_ref: "def456" }],
      });

      expect(res.status).toBe(500);

      // No INSERT was attempted for the pre-existing alias, so rollback
      // must NOT issue a DELETE for it. Only the failed remove triggers rollback.
      // execute calls: 1 = failed DELETE for remove_alias
      // Rollback should NOT delete the pre-existing alias — verify no DELETE
      // for the pre-existing alias (claude-code, abc123)
      for (const call of mockDbWrite.execute.mock.calls) {
        const sql = call[0] as string;
        const params = call[1] as string[];
        if (sql.includes("DELETE FROM project_aliases") && params.includes("abc123")) {
          throw new Error("Rollback incorrectly deleted pre-existing alias");
        }
      }
    });

    it("should roll back tag additions when a later write fails", async () => {
      // Scenario: tags are added successfully, but the updated_at write fails.
      // The added tags should be rolled back.
      mockDbRead.getProjectById.mockResolvedValueOnce({
        id: "proj-1",
        name: "Old Name",
        created_at: "2026-01-01T00:00:00Z",
      }); // project exists
      mockDbRead.projectTagExists.mockResolvedValueOnce(false); // tag "frontend" does NOT exist → truly new

      // Phase 2: tag INSERT succeeds, but updated_at UPDATE fails
      mockDbWrite.execute
        .mockResolvedValueOnce({ meta: {} }) // INSERT tag "frontend" succeeds
        .mockRejectedValueOnce(new Error("D1 error")) // UPDATE updated_at fails
        // Rollback: delete added tag
        .mockResolvedValueOnce({ meta: {} });

      const res = await callPatch({
        add_tags: ["frontend"],
      });

      expect(res.status).toBe(500);

      // Verify rollback deleted the added tag
      const rollbackCalls = mockDbWrite.execute.mock.calls.slice(2); // skip write + failed write
      const deleteTagCall = rollbackCalls.find(
        (call) => (call[0] as string).includes("DELETE FROM project_tags"),
      );
      expect(deleteTagCall).toBeDefined();
      expect(deleteTagCall![1]).toContain("frontend");
    });

    it("should roll back tag removals when a later write fails", async () => {
      // Scenario: tags are removed successfully, but the updated_at write fails.
      // The removed tags should be re-inserted.
      mockDbRead.getProjectById.mockResolvedValueOnce({
        id: "proj-1",
        name: "Old Name",
        created_at: "2026-01-01T00:00:00Z",
      }); // project exists
      mockDbRead.projectTagExists.mockResolvedValueOnce(true); // tag "backend" exists → will be deleted

      // Phase 2: tag DELETE succeeds, but updated_at UPDATE fails
      mockDbWrite.execute
        .mockResolvedValueOnce({ meta: {} }) // DELETE tag "backend" succeeds
        .mockRejectedValueOnce(new Error("D1 error")) // UPDATE updated_at fails
        // Rollback: re-insert removed tag
        .mockResolvedValueOnce({ meta: {} });

      const res = await callPatch({
        remove_tags: ["backend"],
      });

      expect(res.status).toBe(500);

      // Verify rollback re-inserted the removed tag
      const rollbackCalls = mockDbWrite.execute.mock.calls.slice(2);
      const insertTagCall = rollbackCalls.find(
        (call) => (call[0] as string).includes("INSERT OR IGNORE INTO project_tags"),
      );
      expect(insertTagCall).toBeDefined();
      expect(insertTagCall![1]).toContain("backend");
    });

    it("should NOT delete pre-existing tag during rollback when add_tags includes it", async () => {
      // Bug scenario: add_tags includes a tag that already exists on this project.
      // If the INSERT OR IGNORE is tracked unconditionally, rollback would
      // erroneously DELETE this pre-existing tag, corrupting state.
      mockDbRead.getProjectById.mockResolvedValueOnce({
        id: "proj-1",
        name: "Old Name",
        created_at: "2026-01-01T00:00:00Z",
      }); // project exists
      mockDbRead.projectTagExists
        .mockResolvedValueOnce(true) // tag "existing-tag" already exists → skip INSERT
        .mockResolvedValueOnce(false); // tag "new-tag" does NOT exist → truly new

      // Phase 2: INSERT "new-tag" succeeds, updated_at fails
      mockDbWrite.execute
        .mockResolvedValueOnce({ meta: {} }) // INSERT tag "new-tag" succeeds
        .mockRejectedValueOnce(new Error("D1 error")) // UPDATE updated_at fails
        // Rollback: should only delete "new-tag", NOT "existing-tag"
        .mockResolvedValueOnce({ meta: {} });

      const res = await callPatch({
        add_tags: ["existing-tag", "new-tag"],
      });

      expect(res.status).toBe(500);

      // Verify only "new-tag" was rolled back, not "existing-tag"
      const rollbackCalls = mockDbWrite.execute.mock.calls.slice(2); // skip INSERT + failed UPDATE
      expect(rollbackCalls).toHaveLength(1);
      const deleteCall = rollbackCalls[0];
      expect(deleteCall![0]).toContain("DELETE FROM project_tags");
      expect(deleteCall![1]).toContain("new-tag");
      expect(deleteCall![1]).not.toContain("existing-tag");
    });

    it("should roll back by re-inserting removed aliases when later write fails", async () => {
      mockDbRead.getProjectById.mockResolvedValueOnce({
        id: "proj-1",
        name: "Old Name",
        created_at: "2026-01-01T00:00:00Z",
      });
      mockDbRead.aliasAttachedToProject.mockResolvedValueOnce(true); // alias attached

      // Phase 2: remove succeeds, updated_at fails
      mockDbWrite.execute
        .mockResolvedValueOnce({ meta: {} }) // DELETE alias succeeds
        .mockRejectedValueOnce(new Error("D1 error")) // UPDATE updated_at fails
        // Rollback: re-insert removed alias
        .mockResolvedValueOnce({ meta: {} });

      const res = await callPatch({
        remove_aliases: [{ source: "opencode", project_ref: "def456" }],
      });

      expect(res.status).toBe(500);

      // Verify rollback re-inserted the removed alias
      const rollbackCalls = mockDbWrite.execute.mock.calls.slice(2);
      const insertCall = rollbackCalls.find(
        (call) => (call[0] as string).includes("INSERT OR IGNORE INTO project_aliases"),
      );
      expect(insertCall).toBeDefined();
      expect(insertCall![1]).toContain("def456");
    });

    it("should log error when rollback itself fails", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      mockDbRead.getProjectById.mockResolvedValueOnce({
        id: "proj-1",
        name: "Old Name",
        created_at: "2026-01-01T00:00:00Z",
      });
      mockDbRead.getProjectByNameExcluding.mockResolvedValueOnce(null);

      // Phase 2: rename succeeds, updated_at fails, rollback also fails
      mockDbWrite.execute
        .mockResolvedValueOnce({ meta: {} }) // UPDATE name succeeds
        .mockRejectedValueOnce(new Error("D1 error")) // UPDATE updated_at fails
        .mockRejectedValueOnce(new Error("Rollback D1 error")); // rollback fails

      const res = await callPatch({ name: "New Name" });

      expect(res.status).toBe(500);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Rollback failed:",
        expect.any(Error),
      );

      consoleErrorSpy.mockRestore();
    });

    it("should NOT insert phantom tag during rollback when remove_tags includes non-existent tag", async () => {
      // Bug scenario: remove_tags includes a tag that doesn't actually exist.
      // If the DELETE is tracked unconditionally, rollback would
      // INSERT OR IGNORE this phantom tag, corrupting state.
      mockDbRead.getProjectById.mockResolvedValueOnce({
        id: "proj-1",
        name: "Old Name",
        created_at: "2026-01-01T00:00:00Z",
      }); // project exists
      mockDbRead.projectTagExists
        .mockResolvedValueOnce(true) // "real-tag" exists → will be deleted
        .mockResolvedValueOnce(false); // "phantom-tag" does NOT exist → skip DELETE

      // Phase 2: DELETE "real-tag" succeeds, updated_at fails
      mockDbWrite.execute
        .mockResolvedValueOnce({ meta: {} }) // DELETE tag "real-tag" succeeds
        .mockRejectedValueOnce(new Error("D1 error")) // UPDATE updated_at fails
        // Rollback: should only re-insert "real-tag", NOT "phantom-tag"
        .mockResolvedValueOnce({ meta: {} });

      const res = await callPatch({
        remove_tags: ["real-tag", "phantom-tag"],
      });

      expect(res.status).toBe(500);

      // Verify only "real-tag" was rolled back (re-inserted), not "phantom-tag"
      const rollbackCalls = mockDbWrite.execute.mock.calls.slice(2); // skip DELETE + failed UPDATE
      expect(rollbackCalls).toHaveLength(1);
      const insertCall = rollbackCalls[0];
      expect(insertCall![0]).toContain("INSERT OR IGNORE INTO project_tags");
      expect(insertCall![1]).toContain("real-tag");
      expect(insertCall![1]).not.toContain("phantom-tag");
    });
  });

  describe("successful update", () => {
    beforeEach(() => {
      vi.mocked(resolveUser).mockResolvedValue({
        userId: "u1",
        email: "test@example.com",
      });
    });

    it("should rename project and return updated data", async () => {
      mockDbRead.getProjectById
        .mockResolvedValueOnce({
          id: "proj-1",
          name: "Old Name",
          created_at: "2026-03-10T00:00:00Z",
        }) // project exists
        // Phase 2 reads:
        .mockResolvedValueOnce({
          id: "proj-1",
          name: "New Name",
          created_at: "2026-03-10T00:00:00Z",
        });
      mockDbRead.getProjectByNameExcluding.mockResolvedValueOnce(null); // name not taken

      mockDbWrite.execute.mockResolvedValue({ meta: {} });
      mockDbRead.query.mockResolvedValueOnce({ results: [], meta: {} }); // alias stats
      mockDbRead.getProjectTagList.mockResolvedValueOnce([]); // tags

      const res = await callPatch({ name: "New Name" });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe("New Name");
      expect(body.session_count).toBe(0);
      expect(body.total_messages).toBe(0);
      expect(body.total_duration).toBe(0);
      expect(body.models).toEqual([]);
    });

    it("should add alias and return session stats", async () => {
      mockDbRead.getProjectById
        .mockResolvedValueOnce({
          id: "proj-1",
          name: "My Project",
          created_at: "2026-03-10T00:00:00Z",
        }) // project exists
        // Phase 2 reads:
        .mockResolvedValueOnce({
          id: "proj-1",
          name: "My Project",
          created_at: "2026-03-10T00:00:00Z",
        });
      mockDbRead.sessionRecordExists.mockResolvedValueOnce(true); // session data exists
      mockDbRead.getAliasOwner.mockResolvedValueOnce(null); // alias not taken (truly new)

      mockDbWrite.execute.mockResolvedValue({ meta: {} });
      mockDbRead.query
        .mockResolvedValueOnce({
          results: [
            {
              source: "claude-code",
              project_ref: "abc123",
              session_count: 5,
              last_active: "2026-03-10T12:00:00Z",
              total_messages: 120,
              total_duration: 3600,
              models: "claude-4-opus,claude-4-sonnet",
            },
          ],
          meta: {},
        }) // alias stats
      mockDbRead.getProjectTagList.mockResolvedValueOnce([]); // tags

      const res = await callPatch({
        add_aliases: [{ source: "claude-code", project_ref: "abc123" }],
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.session_count).toBe(5);
      expect(body.last_active).toBe("2026-03-10T12:00:00Z");
      expect(body.total_messages).toBe(120);
      expect(body.total_duration).toBe(3600);
      expect(body.models).toEqual(["claude-4-opus", "claude-4-sonnet"]);
      expect(body.aliases).toEqual([
        { source: "claude-code", project_ref: "abc123", session_count: 5 },
      ]);
      expect(body.tags).toEqual([]);
    });

    it("should skip INSERT for alias already attached to this project", async () => {
      mockDbRead.getProjectById
        .mockResolvedValueOnce({
          id: "proj-1",
          name: "My Project",
          created_at: "2026-03-10T00:00:00Z",
        }) // project exists
        // Phase 2 reads:
        .mockResolvedValueOnce({
          id: "proj-1",
          name: "My Project",
          created_at: "2026-03-10T00:00:00Z",
        });
      mockDbRead.sessionRecordExists.mockResolvedValueOnce(true); // session data exists
      mockDbRead.getAliasOwner.mockResolvedValueOnce({ project_id: "proj-1" }); // alias already on this project

      mockDbWrite.execute.mockResolvedValue({ meta: {} });
      mockDbRead.query
        .mockResolvedValueOnce({
          results: [
            {
              source: "claude-code",
              project_ref: "abc123",
              session_count: 5,
              last_active: "2026-03-10T12:00:00Z",
              total_messages: 80,
              total_duration: 1800,
              models: "claude-4-opus",
            },
          ],
          meta: {},
        }) // alias stats
      mockDbRead.getProjectTagList.mockResolvedValueOnce([]); // tags

      const res = await callPatch({
        add_aliases: [{ source: "claude-code", project_ref: "abc123" }],
      });

      expect(res.status).toBe(200);
      // No INSERT should have been issued for the pre-existing alias.
      // Only the updated_at touch should fire.
      const insertCalls = mockDbWrite.execute.mock.calls.filter(
        (call) => (call[0] as string).includes("INSERT"),
      );
      expect(insertCalls).toHaveLength(0);
    });

    it("should successfully remove aliases", async () => {
      mockDbRead.getProjectById
        .mockResolvedValueOnce({
          id: "proj-1",
          name: "My Project",
          created_at: "2026-03-10T00:00:00Z",
        })
        .mockResolvedValueOnce({
          id: "proj-1",
          name: "My Project",
          created_at: "2026-03-10T00:00:00Z",
        });
      mockDbRead.aliasAttachedToProject.mockResolvedValueOnce(true);

      mockDbWrite.execute.mockResolvedValue({ meta: {} });
      mockDbRead.query.mockResolvedValueOnce({ results: [], meta: {} });
      mockDbRead.getProjectTagList.mockResolvedValueOnce([]);

      const res = await callPatch({
        remove_aliases: [{ source: "claude-code", project_ref: "abc123" }],
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.aliases).toEqual([]);
    });

    it("should return 404 when project not found after update", async () => {
      mockDbRead.getProjectById
        .mockResolvedValueOnce({
          id: "proj-1",
          name: "Old Name",
          created_at: "2026-03-10T00:00:00Z",
        })
        .mockResolvedValueOnce(null); // project gone after update
      mockDbRead.getProjectByNameExcluding.mockResolvedValueOnce(null);

      mockDbWrite.execute.mockResolvedValue({ meta: {} });

      const res = await callPatch({ name: "New Name" });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain("not found after update");
    });

    it("should deduplicate add_aliases by (source, project_ref)", async () => {
      mockDbRead.getProjectById
        .mockResolvedValueOnce({
          id: "proj-1",
          name: "My Project",
          created_at: "2026-03-10T00:00:00Z",
        }) // project exists
        // Phase 2 reads:
        .mockResolvedValueOnce({
          id: "proj-1",
          name: "My Project",
          created_at: "2026-03-10T00:00:00Z",
        });
      mockDbRead.sessionRecordExists.mockResolvedValueOnce(true); // session data exists (only checked once after dedup)
      mockDbRead.getAliasOwner.mockResolvedValueOnce(null); // alias not taken (truly new)

      mockDbWrite.execute.mockResolvedValue({ meta: {} });
      mockDbRead.query
        .mockResolvedValueOnce({
          results: [
            {
              source: "claude-code",
              project_ref: "abc123",
              session_count: 5,
              last_active: "2026-03-10T12:00:00Z",
              total_messages: 50,
              total_duration: 900,
              models: null,
            },
          ],
          meta: {},
        }) // alias stats
      mockDbRead.getProjectTagList.mockResolvedValueOnce([]); // tags

      const res = await callPatch({
        add_aliases: [
          { source: "claude-code", project_ref: "abc123" },
          { source: "claude-code", project_ref: "abc123" }, // duplicate
        ],
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.aliases).toHaveLength(1);
      // Only one INSERT should have been issued (not two)
      const insertCalls = mockDbWrite.execute.mock.calls.filter(
        (call) => (call[0] as string).includes("INSERT"),
      );
      expect(insertCalls).toHaveLength(1);
    });
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/projects/:id
// ---------------------------------------------------------------------------

describe("DELETE /api/projects/:id", () => {
  let DELETE: (
    req: Request,
    ctx: { params: Promise<{ id: string }> },
  ) => Promise<Response>;
  let mockDbRead: ReturnType<typeof createMockDbRead>;
  let mockDbWrite: ReturnType<typeof createMockDbWrite>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    mockDbWrite = createMockDbWrite();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as never);
    vi.mocked(dbModule.getDbWrite).mockResolvedValue(mockDbWrite as never);
    const mod = await import("@/app/api/projects/[id]/route");
    DELETE = mod.DELETE;
  });

  function callDelete() {
    return DELETE(makeDeleteRequest(), {
      params: Promise.resolve({ id: "proj-1" }),
    });
  }

  it("should reject unauthenticated requests", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce(null);
    const res = await callDelete();
    expect(res.status).toBe(401);
  });

  it("should return 404 for non-existent project", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });
    mockDbRead.projectExistsForUser.mockResolvedValueOnce(false);
    const res = await callDelete();
    expect(res.status).toBe(404);
  });

  it("should delete project and aliases", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });
    mockDbRead.projectExistsForUser.mockResolvedValueOnce(true);
    mockDbWrite.execute.mockResolvedValue({ meta: {} });

    const res = await callDelete();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockDbWrite.execute).toHaveBeenCalledTimes(3);
  });

  it("should return 500 when delete fails", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });
    mockDbRead.projectExistsForUser.mockResolvedValueOnce(true);
    mockDbWrite.execute.mockRejectedValueOnce(new Error("D1 error"));

    const res = await callDelete();

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("Failed to delete");
  });
});

// ---------------------------------------------------------------------------
// POST /api/projects
// ---------------------------------------------------------------------------

describe("POST /api/projects", () => {
  let POST: (req: Request) => Promise<Response>;
  let mockDbRead: ReturnType<typeof createMockDbRead>;
  let mockDbWrite: ReturnType<typeof createMockDbWrite>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    mockDbWrite = createMockDbWrite();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as never);
    vi.mocked(dbModule.getDbWrite).mockResolvedValue(mockDbWrite as never);
    const mod = await import("@/app/api/projects/route");
    POST = mod.POST;
  });

  describe("authentication", () => {
    it("should reject unauthenticated requests", async () => {
      vi.mocked(resolveUser).mockResolvedValueOnce(null);
      const res = await POST(makePostRequest({ name: "Test" }));
      expect(res.status).toBe(401);
    });
  });

  describe("validation", () => {
    beforeEach(() => {
      vi.mocked(resolveUser).mockResolvedValue({
        userId: "u1",
        email: "test@example.com",
      });
    });

    it("should reject missing name", async () => {
      const res = await POST(makePostRequest({}));
      expect(res.status).toBe(400);
      expect(mockDbWrite.execute).not.toHaveBeenCalled();
    });

    it("should reject empty name", async () => {
      const res = await POST(makePostRequest({ name: "  " }));
      expect(res.status).toBe(400);
    });

    it("should reject name exceeding max length", async () => {
      const res = await POST(makePostRequest({ name: "x".repeat(101) }));
      expect(res.status).toBe(400);
    });

    it("should reject reserved name 'Unassigned' (case-insensitive)", async () => {
      const res = await POST(makePostRequest({ name: "Unassigned" }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("reserved");
      expect(mockDbWrite.execute).not.toHaveBeenCalled();
    });

    it("should reject reserved name 'UNASSIGNED' (uppercase)", async () => {
      const res = await POST(makePostRequest({ name: "UNASSIGNED" }));
      expect(res.status).toBe(400);
      expect(mockDbWrite.execute).not.toHaveBeenCalled();
    });

    it("should reject invalid JSON body", async () => {
      const req = new Request("http://localhost:7020/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json{{{",
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Invalid JSON");
    });

    it("should reject aliases that is not an array", async () => {
      const res = await POST(
        makePostRequest({ name: "Test", aliases: "not-array" }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("aliases must be an array");
    });

    it("should reject aliases exceeding MAX_ALIASES", async () => {
      const tooMany = Array.from({ length: 51 }, (_, i) => ({
        source: "claude-code",
        project_ref: `ref-${i}`,
      }));
      const res = await POST(
        makePostRequest({ name: "Test", aliases: tooMany }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Maximum");
    });

    it("should reject alias entry missing source/project_ref", async () => {
      const res = await POST(
        makePostRequest({ name: "Test", aliases: [{ bad: true }] }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("source and project_ref");
    });

    it("should reject duplicate project name", async () => {
      mockDbRead.getProjectByName.mockResolvedValueOnce({ id: "existing" }); // name taken
      const res = await POST(makePostRequest({ name: "Taken" }));
      expect(res.status).toBe(409);
      expect(mockDbWrite.execute).not.toHaveBeenCalled();
    });

    it("should reject invalid source in aliases", async () => {
      const res = await POST(
        makePostRequest({
          name: "Test",
          aliases: [{ source: "invalid", project_ref: "abc" }],
        }),
      );
      expect(res.status).toBe(400);
    });

    it("should reject aliases with no matching session data", async () => {
      mockDbRead.getProjectByName.mockResolvedValueOnce(null); // name not taken
      mockDbRead.sessionRecordExists.mockResolvedValueOnce(false); // session data not found

      const res = await POST(
        makePostRequest({
          name: "Test",
          aliases: [{ source: "claude-code", project_ref: "abc123" }],
        }),
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.invalid_aliases).toHaveLength(1);
      expect(mockDbWrite.execute).not.toHaveBeenCalled();
    });

    it("should reject aliases already assigned to another project", async () => {
      mockDbRead.getProjectByName.mockResolvedValueOnce(null); // name not taken
      mockDbRead.sessionRecordExists.mockResolvedValueOnce(true); // session data exists
      mockDbRead.getAliasOwner.mockResolvedValueOnce({ project_id: "other-proj" }); // already assigned

      const res = await POST(
        makePostRequest({
          name: "Test",
          aliases: [{ source: "claude-code", project_ref: "abc123" }],
        }),
      );

      expect(res.status).toBe(409);
      expect(mockDbWrite.execute).not.toHaveBeenCalled();
    });

    it("should deduplicate aliases by (source, project_ref)", async () => {
      mockDbRead.getProjectByName.mockResolvedValueOnce(null); // name not taken
      mockDbRead.sessionRecordExists.mockResolvedValueOnce(true); // session data exists (only one — deduped)
      mockDbRead.getAliasOwner.mockResolvedValueOnce(null); // not assigned

      mockDbWrite.execute.mockResolvedValue({ meta: {} });
      mockDbRead.getProjectAliasStats.mockResolvedValueOnce([
        { source: "claude-code", project_ref: "abc123", project_id: "new-proj", session_count: 3, last_active: "2026-03-10T00:00:00Z", total_messages: 15, total_duration_seconds: 300, models: null, absolute_last_active: "2026-03-10T00:00:00Z" },
      ]);
      // Read back created_at
      mockDbRead.getProjectById.mockResolvedValueOnce({
        id: "new-proj",
        name: "Test",
        created_at: "2026-03-10 00:00:00",
      });

      const res = await POST(
        makePostRequest({
          name: "Test",
          aliases: [
            { source: "claude-code", project_ref: "abc123" },
            { source: "claude-code", project_ref: "abc123" }, // duplicate
          ],
        }),
      );

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.aliases).toHaveLength(1);
    });
  });

  describe("rollback on alias insert failure", () => {
    beforeEach(() => {
      vi.mocked(resolveUser).mockResolvedValue({
        userId: "u1",
        email: "test@example.com",
      });
    });

    it("should clean up project row when alias insert fails", async () => {
      // Validation passes
      mockDbRead.getProjectByName.mockResolvedValueOnce(null); // name not taken
      mockDbRead.sessionRecordExists.mockResolvedValueOnce(true); // session data exists
      mockDbRead.getAliasOwner.mockResolvedValueOnce(null); // not assigned

      // Phase 2: project insert succeeds, alias insert fails
      mockDbWrite.execute
        .mockResolvedValueOnce({ meta: {} }) // INSERT project succeeds
        .mockRejectedValueOnce(new Error("UNIQUE constraint")) // INSERT alias fails
        // Rollback:
        .mockResolvedValueOnce({ meta: {} }) // DELETE aliases
        .mockResolvedValueOnce({ meta: {} }); // DELETE project

      const res = await POST(
        makePostRequest({
          name: "Test",
          aliases: [{ source: "claude-code", project_ref: "abc123" }],
        }),
      );

      expect(res.status).toBe(500);

      // Verify rollback: DELETE aliases + DELETE project
      expect(mockDbWrite.execute).toHaveBeenCalledTimes(4);
      const call3 = mockDbWrite.execute.mock.calls[2];
      expect(call3![0]).toContain("DELETE FROM project_aliases");
      const call4 = mockDbWrite.execute.mock.calls[3];
      expect(call4![0]).toContain("DELETE FROM projects");
    });

    it("should log error when rollback itself fails", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      mockDbRead.getProjectByName.mockResolvedValueOnce(null);
      mockDbRead.sessionRecordExists.mockResolvedValueOnce(true);
      mockDbRead.getAliasOwner.mockResolvedValueOnce(null);

      mockDbWrite.execute
        .mockResolvedValueOnce({ meta: {} }) // INSERT project succeeds
        .mockRejectedValueOnce(new Error("UNIQUE constraint")) // INSERT alias fails
        .mockRejectedValueOnce(new Error("Rollback D1 error")); // rollback fails

      const res = await POST(
        makePostRequest({
          name: "Test",
          aliases: [{ source: "claude-code", project_ref: "abc123" }],
        }),
      );

      expect(res.status).toBe(500);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Rollback failed:",
        expect.any(Error),
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe("accurate response data", () => {
    beforeEach(() => {
      vi.mocked(resolveUser).mockResolvedValue({
        userId: "u1",
        email: "test@example.com",
      });
    });

    it("should return session_count: 0 and server created_at for project without aliases", async () => {
      mockDbRead.getProjectByName.mockResolvedValueOnce(null); // name not taken
      // Read back created_at
      mockDbRead.getProjectById.mockResolvedValueOnce({
        id: "new-proj",
        name: "Empty Project",
        created_at: "2026-03-10 12:00:00",
      });

      mockDbWrite.execute.mockResolvedValue({ meta: {} });

      const res = await POST(makePostRequest({ name: "Empty Project" }));

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.session_count).toBe(0);
      expect(body.last_active).toBeNull();
      expect(body.total_messages).toBe(0);
      expect(body.total_duration).toBe(0);
      expect(body.models).toEqual([]);
      // created_at should come from server, not fabricated ISO string
      expect(body.created_at).toBe("2026-03-10 12:00:00");
    });

    it("should return real session stats when aliases are provided", async () => {
      mockDbRead.getProjectByName.mockResolvedValueOnce(null); // name not taken
      mockDbRead.sessionRecordExists.mockResolvedValueOnce(true); // session data exists
      mockDbRead.getAliasOwner.mockResolvedValueOnce(null); // not assigned

      mockDbWrite.execute.mockResolvedValue({ meta: {} });

      // Stats query returns real data
      mockDbRead.getProjectAliasStats.mockResolvedValueOnce([
        { source: "claude-code", project_ref: "abc123", project_id: "new-proj", session_count: 42, last_active: "2026-03-10T18:30:00Z", total_messages: 350, total_duration_seconds: 7200, models: "claude-4-opus,gemini-2.5-pro", absolute_last_active: "2026-03-10T18:30:00Z" },
      ]);

      // Read back created_at
      mockDbRead.getProjectById.mockResolvedValueOnce({
        id: "new-proj",
        name: "Active Project",
        created_at: "2026-03-10 12:00:00",
      });

      const res = await POST(
        makePostRequest({
          name: "Active Project",
          aliases: [{ source: "claude-code", project_ref: "abc123" }],
        }),
      );

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.session_count).toBe(42);
      expect(body.last_active).toBe("2026-03-10T18:30:00Z");
      expect(body.total_messages).toBe(350);
      expect(body.total_duration).toBe(7200);
      expect(body.models).toEqual(["claude-4-opus", "gemini-2.5-pro"]);
      expect(body.created_at).toBe("2026-03-10 12:00:00");
    });
  });

  describe("successful creation", () => {
    beforeEach(() => {
      vi.mocked(resolveUser).mockResolvedValue({
        userId: "u1",
        email: "test@example.com",
      });
    });

    it("should create project without aliases", async () => {
      mockDbRead.getProjectByName.mockResolvedValueOnce(null); // name not taken
      mockDbRead.getProjectById.mockResolvedValueOnce({
        id: "new-proj",
        name: "New Project",
        created_at: "2026-03-10 12:00:00",
      });

      mockDbWrite.execute.mockResolvedValue({ meta: {} });

      const res = await POST(makePostRequest({ name: "New Project" }));

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.name).toBe("New Project");
      expect(body.aliases).toEqual([]);
      expect(body.id).toBeDefined();
    });

    it("should create project with aliases", async () => {
      mockDbRead.getProjectByName.mockResolvedValueOnce(null); // name not taken
      mockDbRead.sessionRecordExists.mockResolvedValueOnce(true); // session data exists
      mockDbRead.getAliasOwner.mockResolvedValueOnce(null); // not assigned
      mockDbRead.getProjectById.mockResolvedValueOnce({
        id: "new-proj",
        name: "With Aliases",
        created_at: "2026-03-10 12:00:00",
      }); // read back

      mockDbWrite.execute.mockResolvedValue({ meta: {} });
      mockDbRead.getProjectAliasStats.mockResolvedValueOnce([
        { source: "opencode", project_ref: "xyz789", project_id: "new-proj", session_count: 10, last_active: "2026-03-10T15:00:00Z", total_messages: 75, total_duration_seconds: 1500, models: "gemini-2.5-pro", absolute_last_active: "2026-03-10T15:00:00Z" },
      ]);

      const res = await POST(
        makePostRequest({
          name: "With Aliases",
          aliases: [{ source: "opencode", project_ref: "xyz789" }],
        }),
      );

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.aliases).toEqual([
        { source: "opencode", project_ref: "xyz789", session_count: 0 },
      ]);
      expect(body.session_count).toBe(10);
      expect(body.total_messages).toBe(75);
      expect(body.total_duration).toBe(1500);
      expect(body.models).toEqual(["gemini-2.5-pro"]);
    });

    it("should return 500 when project not found after creation", async () => {
      mockDbRead.getProjectByName.mockResolvedValueOnce(null);
      mockDbRead.getProjectById.mockResolvedValueOnce(null); // project gone after creation

      mockDbWrite.execute.mockResolvedValue({ meta: {} });

      const res = await POST(makePostRequest({ name: "Ghost Project" }));

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain("not found after creation");
    });
  });
});

// ---------------------------------------------------------------------------
// GET /api/projects
// ---------------------------------------------------------------------------

describe("GET /api/projects", () => {
  let GET: (req: Request) => Promise<Response>;
  let mockDbRead: ReturnType<typeof createMockDbRead>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as never);
    const mod = await import("@/app/api/projects/route");
    GET = mod.GET;
  });

  it("should reject unauthenticated requests", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce(null);
    const res = await GET(new Request("http://localhost:7020/api/projects"));
    expect(res.status).toBe(401);
  });

  it("should return projects with aliases and unassigned refs", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    // Mock RPC methods instead of raw query
    mockDbRead.listProjects.mockResolvedValueOnce([
      { id: "p1", name: "Project A", created_at: "2026-03-10T00:00:00Z" },
    ]);
    mockDbRead.listAliasesWithStats.mockResolvedValueOnce([
      {
        project_id: "p1",
        source: "claude-code",
        project_ref: "abc",
        session_count: 5,
        last_active: "2026-03-10T12:00:00Z",
        total_messages: 120,
        total_duration_seconds: 3600,
        models: "claude-4-opus,claude-4-sonnet",
        absolute_last_active: "2026-03-10T12:00:00Z",
      },
    ]);
    mockDbRead.listUnassignedRefs.mockResolvedValueOnce([
      {
        source: "opencode",
        project_ref: "unassigned-ref",
        session_count: 2,
        last_active: "2026-03-09T00:00:00Z",
        total_messages: 15,
        total_duration_seconds: 600,
        models: "gemini-2.5-pro",
      },
    ]);
    mockDbRead.listProjectTags.mockResolvedValueOnce([]);

    const res = await GET(new Request("http://localhost:7020/api/projects"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0].name).toBe("Project A");
    expect(body.projects[0].session_count).toBe(5);
    expect(body.projects[0].total_messages).toBe(120);
    expect(body.projects[0].total_duration).toBe(3600);
    expect(body.projects[0].models).toEqual(["claude-4-opus", "claude-4-sonnet"]);
    expect(body.projects[0].aliases).toEqual([
      { source: "claude-code", project_ref: "abc", session_count: 5 },
    ]);
    expect(body.projects[0].absolute_last_active).toBe("2026-03-10T12:00:00Z");
    expect(body.projects[0].tags).toEqual([]);
    expect(body.unassigned).toHaveLength(1);
    expect(body.unassigned[0].source).toBe("opencode");
    expect(body.unassigned[0].total_messages).toBe(15);
    expect(body.unassigned[0].total_duration).toBe(600);
    expect(body.unassigned[0].models).toEqual(["gemini-2.5-pro"]);
  });

  it("should return tags in stable alphabetical order", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    mockDbRead.listProjects.mockResolvedValueOnce([
      { id: "p1", name: "Project A", created_at: "2026-03-10T00:00:00Z" },
    ]);
    mockDbRead.listAliasesWithStats.mockResolvedValueOnce([]);
    mockDbRead.listUnassignedRefs.mockResolvedValueOnce([]);
    // Tags returned in alphabetical order by (project_id, tag) from RPC
    mockDbRead.listProjectTags.mockResolvedValueOnce([
      { project_id: "p1", tag: "backend" },
      { project_id: "p1", tag: "frontend" },
      { project_id: "p1", tag: "typescript" },
    ]);

    const res = await GET(new Request("http://localhost:7020/api/projects"));

    expect(res.status).toBe(200);
    const body = await res.json();
    // Tags must be in stable alphabetical order for consistent UI display
    expect(body.projects[0].tags).toEqual(["backend", "frontend", "typescript"]);
  });

  it("should handle empty state", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    mockDbRead.listProjects.mockResolvedValueOnce([]);
    mockDbRead.listAliasesWithStats.mockResolvedValueOnce([]);
    mockDbRead.listUnassignedRefs.mockResolvedValueOnce([]);
    mockDbRead.listProjectTags.mockResolvedValueOnce([]);

    const res = await GET(new Request("http://localhost:7020/api/projects"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projects).toEqual([]);
    expect(body.unassigned).toEqual([]);
  });

  it("should aggregate multiple aliases on the same project", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    mockDbRead.listProjects.mockResolvedValueOnce([
      { id: "p1", name: "Project A", created_at: "2026-03-10T00:00:00Z" },
    ]);
    mockDbRead.listAliasesWithStats.mockResolvedValueOnce([
      {
        project_id: "p1",
        source: "claude-code",
        project_ref: "abc",
        session_count: 5,
        last_active: "2026-03-09T12:00:00Z",
        total_messages: 100,
        total_duration_seconds: 3000,
        models: "claude-4-opus",
        absolute_last_active: "2026-03-09T12:00:00Z",
      },
      {
        project_id: "p1",
        source: "opencode",
        project_ref: "def",
        session_count: 3,
        last_active: "2026-03-10T12:00:00Z",
        total_messages: 50,
        total_duration_seconds: 1000,
        models: "gemini-2.5-pro",
        absolute_last_active: "2026-03-14T08:00:00Z",
      },
    ]);
    mockDbRead.listUnassignedRefs.mockResolvedValueOnce([]);
    mockDbRead.listProjectTags.mockResolvedValueOnce([]);

    const res = await GET(new Request("http://localhost:7020/api/projects"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projects[0].session_count).toBe(8);
    expect(body.projects[0].total_messages).toBe(150);
    expect(body.projects[0].total_duration).toBe(4000);
    expect(body.projects[0].last_active).toBe("2026-03-10T12:00:00Z");
    expect(body.projects[0].absolute_last_active).toBe("2026-03-14T08:00:00Z");
    expect(body.projects[0].aliases).toHaveLength(2);
  });

  it("should return 500 on D1 error", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    mockDbRead.listProjects.mockRejectedValueOnce(new Error("D1 down"));

    const res = await GET(new Request("http://localhost:7020/api/projects"));

    expect(res.status).toBe(500);
  });

  it("should pass date range to RPC methods when from/to provided", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    mockDbRead.listProjects.mockResolvedValueOnce([]);
    mockDbRead.listAliasesWithStats.mockResolvedValueOnce([]);
    mockDbRead.listUnassignedRefs.mockResolvedValueOnce([]);
    mockDbRead.listProjectTags.mockResolvedValueOnce([]);

    const res = await GET(
      new Request(
        "http://localhost:7020/api/projects?from=2026-03-01&to=2026-03-14",
      ),
    );

    expect(res.status).toBe(200);

    // Verify RPC was called with date params
    expect(mockDbRead.listAliasesWithStats).toHaveBeenCalledWith(
      "u1",
      "2026-03-01",
      "2026-03-14",
    );
    expect(mockDbRead.listUnassignedRefs).toHaveBeenCalledWith(
      "u1",
      "2026-03-01",
      "2026-03-14",
    );
  });

  it("should call RPC without date params when from/to absent", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    mockDbRead.listProjects.mockResolvedValueOnce([]);
    mockDbRead.listAliasesWithStats.mockResolvedValueOnce([]);
    mockDbRead.listUnassignedRefs.mockResolvedValueOnce([]);
    mockDbRead.listProjectTags.mockResolvedValueOnce([]);

    await GET(new Request("http://localhost:7020/api/projects"));

    // Verify RPC was called without date params
    expect(mockDbRead.listAliasesWithStats).toHaveBeenCalledWith(
      "u1",
      undefined,
      undefined,
    );
    expect(mockDbRead.listUnassignedRefs).toHaveBeenCalledWith(
      "u1",
      undefined,
      undefined,
    );
  });

  it("should default to tomorrow when only from param is provided", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    mockDbRead.listProjects.mockResolvedValueOnce([]);
    mockDbRead.listAliasesWithStats.mockResolvedValueOnce([]);
    mockDbRead.listUnassignedRefs.mockResolvedValueOnce([]);
    mockDbRead.listProjectTags.mockResolvedValueOnce([]);

    const res = await GET(
      new Request("http://localhost:7020/api/projects?from=2026-03-01"),
    );

    expect(res.status).toBe(200);

    // Verify RPC was called with from and defaulted to (tomorrow)
    const aliasCall = mockDbRead.listAliasesWithStats.mock.calls[0]!;
    expect(aliasCall[0]).toBe("u1");
    expect(aliasCall[1]).toBe("2026-03-01");
    expect(aliasCall[2]).toMatch(/^\d{4}-\d{2}-\d{2}$/); // defaulted to (tomorrow)
  });

  it("should return period-scoped stats with absolute_last_active when date range active", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    mockDbRead.listProjects.mockResolvedValueOnce([
      { id: "p1", name: "Project A", created_at: "2026-01-01T00:00:00Z" },
    ]);
    mockDbRead.listAliasesWithStats.mockResolvedValueOnce([
      {
        project_id: "p1",
        source: "claude-code",
        project_ref: "abc",
        session_count: 2, // period-scoped: only 2 of 5 sessions
        last_active: "2026-03-10T12:00:00Z",
        total_messages: 40,
        total_duration_seconds: 1200,
        models: "claude-4-opus",
        absolute_last_active: "2026-03-14T08:00:00Z", // all-time: different
      },
    ]);
    mockDbRead.listUnassignedRefs.mockResolvedValueOnce([]);
    mockDbRead.listProjectTags.mockResolvedValueOnce([]);

    const res = await GET(
      new Request(
        "http://localhost:7020/api/projects?from=2026-03-01&to=2026-03-14",
      ),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    const project = body.projects[0];
    // Period-scoped stats
    expect(project.session_count).toBe(2);
    expect(project.total_messages).toBe(40);
    expect(project.last_active).toBe("2026-03-10T12:00:00Z");
    // All-time absolute
    expect(project.absolute_last_active).toBe("2026-03-14T08:00:00Z");
    // Per-alias session_count exposed
    expect(project.aliases[0].session_count).toBe(2);
  });

  it("should return zero-stats project when no sessions in date range", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    mockDbRead.listProjects.mockResolvedValueOnce([
      { id: "p1", name: "Project A", created_at: "2026-01-01T00:00:00Z" },
    ]);
    mockDbRead.listAliasesWithStats.mockResolvedValueOnce([
      {
        project_id: "p1",
        source: "claude-code",
        project_ref: "abc",
        session_count: 0, // zero in this period
        last_active: null,
        total_messages: 0,
        total_duration_seconds: 0,
        models: null,
        absolute_last_active: "2026-02-15T10:00:00Z", // but had activity before
      },
    ]);
    mockDbRead.listUnassignedRefs.mockResolvedValueOnce([]);
    mockDbRead.listProjectTags.mockResolvedValueOnce([]);

    const res = await GET(
      new Request(
        "http://localhost:7020/api/projects?from=2026-03-01&to=2026-03-14",
      ),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    // Project still appears (LEFT JOIN preserves it)
    expect(body.projects).toHaveLength(1);
    const project = body.projects[0];
    expect(project.session_count).toBe(0);
    expect(project.last_active).toBeNull();
    expect(project.total_messages).toBe(0);
    // absolute_last_active retains all-time value
    expect(project.absolute_last_active).toBe("2026-02-15T10:00:00Z");
    // Alias also reports zero session_count
    expect(project.aliases[0].session_count).toBe(0);
  });
});
