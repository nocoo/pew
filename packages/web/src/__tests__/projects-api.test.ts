import { describe, it, expect, vi, beforeEach } from "vitest";
import * as d1Module from "@/lib/d1";

// Mock D1
vi.mock("@/lib/d1", async (importOriginal) => {
  const original = await importOriginal<typeof d1Module>();
  return {
    ...original,
    getD1Client: vi.fn(),
  };
});

// Mock resolveUser
vi.mock("@/lib/auth-helpers", () => ({
  resolveUser: vi.fn(),
}));

const { resolveUser } = (await import("@/lib/auth-helpers")) as unknown as {
  resolveUser: ReturnType<typeof vi.fn>;
};

function createMockClient() {
  return {
    query: vi.fn(),
    execute: vi.fn(),
    batch: vi.fn(),
    firstOrNull: vi.fn(),
  };
}

function makePostRequest(body: unknown): Request {
  return new Request("http://localhost:7030/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makePatchRequest(body: unknown): Request {
  return new Request("http://localhost:7030/api/projects/proj-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeDeleteRequest(): Request {
  return new Request("http://localhost:7030/api/projects/proj-1", {
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
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    vi.mocked(d1Module.getD1Client).mockReturnValue(
      mockClient as unknown as d1Module.D1Client,
    );
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
      mockClient.firstOrNull.mockResolvedValueOnce(null); // project lookup

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
      mockClient.firstOrNull.mockResolvedValueOnce({
        id: "proj-1",
        name: "Old Name",
      }); // project exists

      const res = await callPatch({ name: "  " });

      expect(res.status).toBe(400);
      expect(mockClient.execute).not.toHaveBeenCalled();
    });

    it("should reject name exceeding max length", async () => {
      mockClient.firstOrNull.mockResolvedValueOnce({
        id: "proj-1",
        name: "Old Name",
      });

      const res = await callPatch({ name: "x".repeat(101) });

      expect(res.status).toBe(400);
      expect(mockClient.execute).not.toHaveBeenCalled();
    });

    it("should reject duplicate name with 409", async () => {
      mockClient.firstOrNull
        .mockResolvedValueOnce({ id: "proj-1", name: "Old Name" }) // project exists
        .mockResolvedValueOnce({ id: "proj-2" }); // name already taken

      const res = await callPatch({ name: "Taken Name" });

      expect(res.status).toBe(409);
      expect(mockClient.execute).not.toHaveBeenCalled();
    });

    it("should reject aliases referencing non-existent session data", async () => {
      mockClient.firstOrNull
        .mockResolvedValueOnce({ id: "proj-1", name: "Old Name" }) // project exists
        .mockResolvedValueOnce(null); // alias session data not found

      const res = await callPatch({
        add_aliases: [{ source: "claude-code", project_ref: "abc123" }],
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.invalid_aliases).toHaveLength(1);
      expect(mockClient.execute).not.toHaveBeenCalled();
    });

    it("should reject alias already assigned to another project", async () => {
      mockClient.firstOrNull
        .mockResolvedValueOnce({ id: "proj-1", name: "Old Name" }) // project exists
        .mockResolvedValueOnce({ "1": 1 }) // session data exists
        .mockResolvedValueOnce({ project_id: "proj-other" }); // alias taken by another

      const res = await callPatch({
        add_aliases: [{ source: "claude-code", project_ref: "abc123" }],
      });

      expect(res.status).toBe(409);
      expect(mockClient.execute).not.toHaveBeenCalled();
    });

    it("should reject invalid source in add_aliases", async () => {
      mockClient.firstOrNull.mockResolvedValueOnce({
        id: "proj-1",
        name: "Old Name",
      });

      const res = await callPatch({
        add_aliases: [{ source: "invalid-tool", project_ref: "abc" }],
      });

      expect(res.status).toBe(400);
      expect(mockClient.execute).not.toHaveBeenCalled();
    });

    it("should reject reserved name 'Unassigned' (case-insensitive)", async () => {
      mockClient.firstOrNull.mockResolvedValueOnce({
        id: "proj-1",
        name: "Old Name",
      }); // project exists

      const res = await callPatch({ name: "Unassigned" });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("reserved");
      expect(mockClient.execute).not.toHaveBeenCalled();
    });

    it("should reject reserved name 'unassigned' (lowercase)", async () => {
      mockClient.firstOrNull.mockResolvedValueOnce({
        id: "proj-1",
        name: "Old Name",
      });

      const res = await callPatch({ name: "unassigned" });

      expect(res.status).toBe(400);
      expect(mockClient.execute).not.toHaveBeenCalled();
    });

    it("should reject remove_aliases not attached to this project", async () => {
      mockClient.firstOrNull
        .mockResolvedValueOnce({ id: "proj-1", name: "Old Name" }) // project exists
        .mockResolvedValueOnce(null); // alias not found on this project

      const res = await callPatch({
        remove_aliases: [{ source: "claude-code", project_ref: "not-here" }],
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.not_found_aliases).toHaveLength(1);
      expect(body.not_found_aliases[0].project_ref).toBe("not-here");
      expect(mockClient.execute).not.toHaveBeenCalled();
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
      mockClient.firstOrNull
        .mockResolvedValueOnce({ id: "proj-1", name: "Old Name" }) // project exists
        .mockResolvedValueOnce(null) // name not taken
        .mockResolvedValueOnce({ "1": 1 }) // session data exists for alias
        .mockResolvedValueOnce(null); // alias not taken by another

      // Phase 2: rename succeeds, alias insert fails
      mockClient.execute
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
      const rollbackCall = mockClient.execute.mock.calls[2];
      expect(rollbackCall![0]).toContain("UPDATE projects SET name = ?");
      expect(rollbackCall![1]).toContain("Old Name");
    });

    it("should roll back added aliases when later remove_aliases write fails", async () => {
      mockClient.firstOrNull
        .mockResolvedValueOnce({ id: "proj-1", name: "Old Name" }) // project exists
        .mockResolvedValueOnce({ "1": 1 }) // session data exists for add alias
        .mockResolvedValueOnce(null) // alias not taken (truly new)
        .mockResolvedValueOnce({ project_id: "proj-1" }); // remove alias is attached to this project

      // Phase 2: add succeeds, remove fails
      mockClient.execute
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
      const rollbackCall = mockClient.execute.mock.calls[2];
      expect(rollbackCall![0]).toContain(
        "DELETE FROM project_aliases",
      );
    });

    it("should NOT delete pre-existing alias during rollback when add_aliases includes it", async () => {
      // Scenario: alias already attached to this project, request "adds" it again,
      // then a later write fails. The pre-existing alias must survive rollback.
      mockClient.firstOrNull
        .mockResolvedValueOnce({ id: "proj-1", name: "Old Name" }) // project exists
        .mockResolvedValueOnce({ "1": 1 }) // session data exists for alias
        .mockResolvedValueOnce({ project_id: "proj-1" }) // alias already on this project (pre-existing)
        .mockResolvedValueOnce({ project_id: "proj-1" }); // remove alias is attached

      // Phase 2: no INSERT for pre-existing alias; remove fails
      mockClient.execute
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
      for (const call of mockClient.execute.mock.calls) {
        const sql = call[0] as string;
        const params = call[1] as string[];
        if (sql.includes("DELETE FROM project_aliases") && params.includes("abc123")) {
          throw new Error("Rollback incorrectly deleted pre-existing alias");
        }
      }
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
      mockClient.firstOrNull
        .mockResolvedValueOnce({ id: "proj-1", name: "Old Name" }) // project exists
        .mockResolvedValueOnce(null) // name not taken
        // Phase 2 reads:
        .mockResolvedValueOnce({
          id: "proj-1",
          name: "New Name",
          created_at: "2026-03-10T00:00:00Z",
        });

      mockClient.execute.mockResolvedValue({ meta: {} });
      mockClient.query
        .mockResolvedValueOnce({ results: [], meta: {} }) // alias stats
        .mockResolvedValueOnce({ results: [], meta: {} }); // tags

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
      mockClient.firstOrNull
        .mockResolvedValueOnce({ id: "proj-1", name: "My Project" }) // project exists
        .mockResolvedValueOnce({ "1": 1 }) // session data exists
        .mockResolvedValueOnce(null) // alias not taken (truly new)
        // Phase 2 reads:
        .mockResolvedValueOnce({
          id: "proj-1",
          name: "My Project",
          created_at: "2026-03-10T00:00:00Z",
        });

      mockClient.execute.mockResolvedValue({ meta: {} });
      mockClient.query
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
        .mockResolvedValueOnce({ results: [], meta: {} }); // tags

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
        { source: "claude-code", project_ref: "abc123" },
      ]);
      expect(body.tags).toEqual([]);
    });

    it("should skip INSERT for alias already attached to this project", async () => {
      mockClient.firstOrNull
        .mockResolvedValueOnce({ id: "proj-1", name: "My Project" }) // project exists
        .mockResolvedValueOnce({ "1": 1 }) // session data exists
        .mockResolvedValueOnce({ project_id: "proj-1" }) // alias already on this project
        // Phase 2 reads:
        .mockResolvedValueOnce({
          id: "proj-1",
          name: "My Project",
          created_at: "2026-03-10T00:00:00Z",
        });

      mockClient.execute.mockResolvedValue({ meta: {} });
      mockClient.query
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
        .mockResolvedValueOnce({ results: [], meta: {} }); // tags

      const res = await callPatch({
        add_aliases: [{ source: "claude-code", project_ref: "abc123" }],
      });

      expect(res.status).toBe(200);
      // No INSERT should have been issued for the pre-existing alias.
      // Only the updated_at touch should fire.
      const insertCalls = mockClient.execute.mock.calls.filter(
        (call) => (call[0] as string).includes("INSERT"),
      );
      expect(insertCalls).toHaveLength(0);
    });

    it("should deduplicate add_aliases by (source, project_ref)", async () => {
      mockClient.firstOrNull
        .mockResolvedValueOnce({ id: "proj-1", name: "My Project" }) // project exists
        .mockResolvedValueOnce({ "1": 1 }) // session data exists (only checked once after dedup)
        .mockResolvedValueOnce(null) // alias not taken (truly new)
        // Phase 2 reads:
        .mockResolvedValueOnce({
          id: "proj-1",
          name: "My Project",
          created_at: "2026-03-10T00:00:00Z",
        });

      mockClient.execute.mockResolvedValue({ meta: {} });
      mockClient.query
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
        .mockResolvedValueOnce({ results: [], meta: {} }); // tags

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
      const insertCalls = mockClient.execute.mock.calls.filter(
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
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    vi.mocked(d1Module.getD1Client).mockReturnValue(
      mockClient as unknown as d1Module.D1Client,
    );
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
    mockClient.firstOrNull.mockResolvedValueOnce(null);
    const res = await callDelete();
    expect(res.status).toBe(404);
  });

  it("should delete project and aliases", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });
    mockClient.firstOrNull.mockResolvedValueOnce({ id: "proj-1" });
    mockClient.execute.mockResolvedValue({ meta: {} });

    const res = await callDelete();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockClient.execute).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// POST /api/projects
// ---------------------------------------------------------------------------

describe("POST /api/projects", () => {
  let POST: (req: Request) => Promise<Response>;
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    vi.mocked(d1Module.getD1Client).mockReturnValue(
      mockClient as unknown as d1Module.D1Client,
    );
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
      expect(mockClient.execute).not.toHaveBeenCalled();
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
      expect(mockClient.execute).not.toHaveBeenCalled();
    });

    it("should reject reserved name 'UNASSIGNED' (uppercase)", async () => {
      const res = await POST(makePostRequest({ name: "UNASSIGNED" }));
      expect(res.status).toBe(400);
      expect(mockClient.execute).not.toHaveBeenCalled();
    });

    it("should reject duplicate project name", async () => {
      mockClient.firstOrNull.mockResolvedValueOnce({ id: "existing" }); // name taken
      const res = await POST(makePostRequest({ name: "Taken" }));
      expect(res.status).toBe(409);
      expect(mockClient.execute).not.toHaveBeenCalled();
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
      mockClient.firstOrNull
        .mockResolvedValueOnce(null) // name not taken
        .mockResolvedValueOnce(null); // session data not found

      const res = await POST(
        makePostRequest({
          name: "Test",
          aliases: [{ source: "claude-code", project_ref: "abc123" }],
        }),
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.invalid_aliases).toHaveLength(1);
      expect(mockClient.execute).not.toHaveBeenCalled();
    });

    it("should reject aliases already assigned to another project", async () => {
      mockClient.firstOrNull
        .mockResolvedValueOnce(null) // name not taken
        .mockResolvedValueOnce({ "1": 1 }) // session data exists
        .mockResolvedValueOnce({ project_id: "other-proj" }); // already assigned

      const res = await POST(
        makePostRequest({
          name: "Test",
          aliases: [{ source: "claude-code", project_ref: "abc123" }],
        }),
      );

      expect(res.status).toBe(409);
      expect(mockClient.execute).not.toHaveBeenCalled();
    });

    it("should deduplicate aliases by (source, project_ref)", async () => {
      mockClient.firstOrNull
        .mockResolvedValueOnce(null) // name not taken
        .mockResolvedValueOnce({ "1": 1 }) // session data exists (only one — deduped)
        .mockResolvedValueOnce(null); // not assigned

      mockClient.execute.mockResolvedValue({ meta: {} });
      mockClient.query.mockResolvedValueOnce({
        results: [{ session_count: 3, last_active: "2026-03-10T00:00:00Z", total_messages: 15, total_duration: 300, models: null }],
        meta: {},
      });
      // Read back created_at
      mockClient.firstOrNull.mockResolvedValueOnce({
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
      mockClient.firstOrNull
        .mockResolvedValueOnce(null) // name not taken
        .mockResolvedValueOnce({ "1": 1 }) // session data exists
        .mockResolvedValueOnce(null); // not assigned

      // Phase 2: project insert succeeds, alias insert fails
      mockClient.execute
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
      expect(mockClient.execute).toHaveBeenCalledTimes(4);
      const call3 = mockClient.execute.mock.calls[2];
      expect(call3![0]).toContain("DELETE FROM project_aliases");
      const call4 = mockClient.execute.mock.calls[3];
      expect(call4![0]).toContain("DELETE FROM projects");
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
      mockClient.firstOrNull
        .mockResolvedValueOnce(null) // name not taken
        // Read back created_at
        .mockResolvedValueOnce({ created_at: "2026-03-10 12:00:00" });

      mockClient.execute.mockResolvedValue({ meta: {} });

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
      mockClient.firstOrNull
        .mockResolvedValueOnce(null) // name not taken
        .mockResolvedValueOnce({ "1": 1 }) // session data exists
        .mockResolvedValueOnce(null); // not assigned

      mockClient.execute.mockResolvedValue({ meta: {} });

      // Stats query returns real data
      mockClient.query.mockResolvedValueOnce({
        results: [
          { session_count: 42, last_active: "2026-03-10T18:30:00Z", total_messages: 350, total_duration: 7200, models: "claude-4-opus,gemini-2.5-pro" },
        ],
        meta: {},
      });

      // Read back created_at
      mockClient.firstOrNull.mockResolvedValueOnce({
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
      mockClient.firstOrNull
        .mockResolvedValueOnce(null) // name not taken
        .mockResolvedValueOnce({ created_at: "2026-03-10 12:00:00" });

      mockClient.execute.mockResolvedValue({ meta: {} });

      const res = await POST(makePostRequest({ name: "New Project" }));

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.name).toBe("New Project");
      expect(body.aliases).toEqual([]);
      expect(body.id).toBeDefined();
    });

    it("should create project with aliases", async () => {
      mockClient.firstOrNull
        .mockResolvedValueOnce(null) // name not taken
        .mockResolvedValueOnce({ "1": 1 }) // session data exists
        .mockResolvedValueOnce(null) // not assigned
        .mockResolvedValueOnce({ created_at: "2026-03-10 12:00:00" }); // read back

      mockClient.execute.mockResolvedValue({ meta: {} });
      mockClient.query.mockResolvedValueOnce({
        results: [{ session_count: 10, last_active: "2026-03-10T15:00:00Z", total_messages: 75, total_duration: 1500, models: "gemini-2.5-pro" }],
        meta: {},
      });

      const res = await POST(
        makePostRequest({
          name: "With Aliases",
          aliases: [{ source: "opencode", project_ref: "xyz789" }],
        }),
      );

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.aliases).toEqual([
        { source: "opencode", project_ref: "xyz789" },
      ]);
      expect(body.session_count).toBe(10);
      expect(body.total_messages).toBe(75);
      expect(body.total_duration).toBe(1500);
      expect(body.models).toEqual(["gemini-2.5-pro"]);
    });
  });
});

// ---------------------------------------------------------------------------
// GET /api/projects
// ---------------------------------------------------------------------------

describe("GET /api/projects", () => {
  let GET: (req: Request) => Promise<Response>;
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    vi.mocked(d1Module.getD1Client).mockReturnValue(
      mockClient as unknown as d1Module.D1Client,
    );
    const mod = await import("@/app/api/projects/route");
    GET = mod.GET;
  });

  it("should reject unauthenticated requests", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce(null);
    const res = await GET(new Request("http://localhost:7030/api/projects"));
    expect(res.status).toBe(401);
  });

  it("should return projects with aliases and unassigned refs", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    mockClient.query
      .mockResolvedValueOnce({
        results: [
          { id: "p1", name: "Project A", created_at: "2026-03-10T00:00:00Z" },
        ],
        meta: {},
      }) // Query 1: projects
      .mockResolvedValueOnce({
        results: [
          {
            project_id: "p1",
            source: "claude-code",
            project_ref: "abc",
            session_count: 5,
            last_active: "2026-03-10T12:00:00Z",
            total_messages: 120,
            total_duration: 3600,
            models: "claude-4-opus,claude-4-sonnet",
          },
        ],
        meta: {},
      }) // Query 2: aliases
      .mockResolvedValueOnce({
        results: [
          {
            source: "opencode",
            project_ref: "unassigned-ref",
            session_count: 2,
            last_active: "2026-03-09T00:00:00Z",
            total_messages: 15,
            total_duration: 600,
            models: "gemini-2.5-pro",
          },
        ],
        meta: {},
      }) // Query 3: unassigned
      .mockResolvedValueOnce({ results: [], meta: {} }); // Query 4: tags

    const res = await GET(new Request("http://localhost:7030/api/projects"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0].name).toBe("Project A");
    expect(body.projects[0].session_count).toBe(5);
    expect(body.projects[0].total_messages).toBe(120);
    expect(body.projects[0].total_duration).toBe(3600);
    expect(body.projects[0].models).toEqual(["claude-4-opus", "claude-4-sonnet"]);
    expect(body.projects[0].aliases).toEqual([
      { source: "claude-code", project_ref: "abc" },
    ]);
    expect(body.projects[0].tags).toEqual([]);
    expect(body.unassigned).toHaveLength(1);
    expect(body.unassigned[0].source).toBe("opencode");
    expect(body.unassigned[0].total_messages).toBe(15);
    expect(body.unassigned[0].total_duration).toBe(600);
    expect(body.unassigned[0].models).toEqual(["gemini-2.5-pro"]);
  });

  it("should handle empty state", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    mockClient.query
      .mockResolvedValueOnce({ results: [], meta: {} })
      .mockResolvedValueOnce({ results: [], meta: {} })
      .mockResolvedValueOnce({ results: [], meta: {} })
      .mockResolvedValueOnce({ results: [], meta: {} }); // tags

    const res = await GET(new Request("http://localhost:7030/api/projects"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projects).toEqual([]);
    expect(body.unassigned).toEqual([]);
  });

  it("should return 500 on D1 error", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    mockClient.query.mockRejectedValueOnce(new Error("D1 down"));

    const res = await GET(new Request("http://localhost:7030/api/projects"));

    expect(res.status).toBe(500);
  });
});
