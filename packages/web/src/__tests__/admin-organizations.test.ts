import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be before imports that trigger the module chain
// ---------------------------------------------------------------------------

vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
  getDbWrite: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({
  resolveAdmin: vi.fn(),
}));

vi.mock("@/auth", () => ({
  shouldUseSecureCookies: vi.fn(() => false),
}));

import { GET, POST } from "@/app/api/admin/organizations/route";
import {
  GET as GET_ONE,
  PATCH,
  DELETE,
} from "@/app/api/admin/organizations/[orgId]/route";
import { createMockDbRead, createMockDbWrite, makeJsonRequest } from "./test-utils";
import * as dbModule from "@/lib/db";

const { resolveAdmin } = (await import("@/lib/admin")) as unknown as {
  resolveAdmin: ReturnType<typeof vi.fn>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN = { userId: "admin-1", email: "admin@test.com" };

function makeOrgRequest(
  method: string,
  orgId: string,
  body?: Record<string, unknown>
) {
  const url = `http://localhost:7020/api/admin/organizations/${orgId}`;
  const init: RequestInit = { method };
  if (body) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  return new Request(url, init);
}

// ---------------------------------------------------------------------------
// GET /api/admin/organizations
// ---------------------------------------------------------------------------

describe("GET /api/admin/organizations", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as never);
  });

  it("should return all organizations with member counts", async () => {
    resolveAdmin.mockResolvedValueOnce(ADMIN);

    mockDbRead.query.mockResolvedValueOnce({
      results: [
        {
          id: "org-1",
          name: "Anthropic",
          slug: "anthropic",
          logo_url: "https://example.com/logo.png",
          created_by: "admin-1",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
          member_count: 5,
        },
        {
          id: "org-2",
          name: "OpenAI",
          slug: "openai",
          logo_url: null,
          created_by: "admin-1",
          created_at: "2026-01-02T00:00:00Z",
          updated_at: "2026-01-02T00:00:00Z",
          member_count: 0,
        },
      ],
    });

    const res = await GET(makeJsonRequest("GET", "/api/admin/organizations"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.organizations).toHaveLength(2);
    expect(json.organizations[0]).toEqual({
      id: "org-1",
      name: "Anthropic",
      slug: "anthropic",
      logoUrl: "https://example.com/logo.png",
      createdBy: "admin-1",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      memberCount: 5,
    });
    expect(json.organizations[1].memberCount).toBe(0);
  });

  it("should reject non-admin users", async () => {
    resolveAdmin.mockResolvedValueOnce(null);
    const res = await GET(makeJsonRequest("GET", "/api/admin/organizations"));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("Forbidden");
  });

  it("should handle no-such-table gracefully", async () => {
    resolveAdmin.mockResolvedValueOnce(ADMIN);
    mockDbRead.query.mockRejectedValueOnce(new Error("no such table: organizations"));

    const res = await GET(makeJsonRequest("GET", "/api/admin/organizations"));
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toContain("not yet migrated");
  });

  it("should return 500 on unexpected error", async () => {
    resolveAdmin.mockResolvedValueOnce(ADMIN);
    mockDbRead.query.mockRejectedValueOnce(new Error("DB connection failed"));

    const res = await GET(makeJsonRequest("GET", "/api/admin/organizations"));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("Failed to list organizations");
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/organizations
// ---------------------------------------------------------------------------

describe("POST /api/admin/organizations", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;
  let mockDbWrite: ReturnType<typeof createMockDbWrite>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    mockDbWrite = createMockDbWrite();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as never);
    vi.mocked(dbModule.getDbWrite).mockResolvedValue(mockDbWrite as never);
  });

  it("should create organization with valid data", async () => {
    resolveAdmin.mockResolvedValueOnce(ADMIN);
    mockDbRead.firstOrNull.mockResolvedValueOnce(null); // no slug collision
    mockDbWrite.execute.mockResolvedValueOnce({ changes: 1, duration: 0.01 });

    const res = await POST(
      makeJsonRequest("POST", "/api/admin/organizations", {
        name: "Anthropic",
        slug: "anthropic",
      })
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.name).toBe("Anthropic");
    expect(json.slug).toBe("anthropic");
    expect(json.logoUrl).toBeNull();
    expect(json.memberCount).toBe(0);
    expect(json.id).toBeDefined();
    expect(json.createdBy).toBe("admin-1");
  });

  it("should reject non-admin users", async () => {
    resolveAdmin.mockResolvedValueOnce(null);
    const res = await POST(
      makeJsonRequest("POST", "/api/admin/organizations", {
        name: "Test",
        slug: "test",
      })
    );
    expect(res.status).toBe(403);
  });

  it("should reject invalid JSON", async () => {
    resolveAdmin.mockResolvedValueOnce(ADMIN);
    const req = new Request("http://localhost:7020/api/admin/organizations", {
      method: "POST",
      body: "not json",
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid JSON");
  });

  it("should reject missing name", async () => {
    resolveAdmin.mockResolvedValueOnce(ADMIN);
    const res = await POST(
      makeJsonRequest("POST", "/api/admin/organizations", { slug: "test" })
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("name");
  });

  it("should reject invalid slug format", async () => {
    resolveAdmin.mockResolvedValueOnce(ADMIN);
    const res = await POST(
      makeJsonRequest("POST", "/api/admin/organizations", {
        name: "Test",
        slug: "INVALID_SLUG!",
      })
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("slug");
  });

  it("should reject duplicate slug", async () => {
    resolveAdmin.mockResolvedValueOnce(ADMIN);
    mockDbRead.firstOrNull.mockResolvedValueOnce({ id: "existing" });

    const res = await POST(
      makeJsonRequest("POST", "/api/admin/organizations", {
        name: "Test",
        slug: "existing-slug",
      })
    );
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain("already exists");
  });

  it("should handle no-such-table on create", async () => {
    resolveAdmin.mockResolvedValueOnce(ADMIN);
    mockDbRead.firstOrNull.mockRejectedValueOnce(new Error("no such table: organizations"));

    const res = await POST(
      makeJsonRequest("POST", "/api/admin/organizations", {
        name: "Test",
        slug: "test",
      })
    );
    expect(res.status).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/organizations/[orgId]
// ---------------------------------------------------------------------------

describe("GET /api/admin/organizations/[orgId]", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as never);
  });

  it("should return organization details", async () => {
    resolveAdmin.mockResolvedValueOnce(ADMIN);
    mockDbRead.firstOrNull
      .mockResolvedValueOnce({
        id: "org-1",
        name: "Anthropic",
        slug: "anthropic",
        logo_url: "https://example.com/logo.png",
        created_by: "admin-1",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      })
      .mockResolvedValueOnce({ count: 10 });

    const res = await GET_ONE(makeOrgRequest("GET", "org-1"), {
      params: Promise.resolve({ orgId: "org-1" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.name).toBe("Anthropic");
    expect(json.memberCount).toBe(10);
  });

  it("should return 404 for non-existent org", async () => {
    resolveAdmin.mockResolvedValueOnce(ADMIN);
    mockDbRead.firstOrNull.mockResolvedValueOnce(null);

    const res = await GET_ONE(makeOrgRequest("GET", "not-found"), {
      params: Promise.resolve({ orgId: "not-found" }),
    });
    expect(res.status).toBe(404);
  });

  it("should reject non-admin users", async () => {
    resolveAdmin.mockResolvedValueOnce(null);
    const res = await GET_ONE(makeOrgRequest("GET", "org-1"), {
      params: Promise.resolve({ orgId: "org-1" }),
    });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/organizations/[orgId]
// ---------------------------------------------------------------------------

describe("PATCH /api/admin/organizations/[orgId]", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;
  let mockDbWrite: ReturnType<typeof createMockDbWrite>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    mockDbWrite = createMockDbWrite();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as never);
    vi.mocked(dbModule.getDbWrite).mockResolvedValue(mockDbWrite as never);
  });

  it("should update organization name", async () => {
    resolveAdmin.mockResolvedValueOnce(ADMIN);
    mockDbRead.firstOrNull
      .mockResolvedValueOnce({ id: "org-1", slug: "anthropic" }) // existing
      .mockResolvedValueOnce({
        id: "org-1",
        name: "Anthropic Inc",
        slug: "anthropic",
        logo_url: null,
        created_by: "admin-1",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
      }) // updated
      .mockResolvedValueOnce({ count: 5 }); // member count
    mockDbWrite.execute.mockResolvedValueOnce({ changes: 1 });

    const res = await PATCH(makeOrgRequest("PATCH", "org-1", { name: "Anthropic Inc" }), {
      params: Promise.resolve({ orgId: "org-1" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.name).toBe("Anthropic Inc");
    expect(json.memberCount).toBe(5);
  });

  it("should update organization slug", async () => {
    resolveAdmin.mockResolvedValueOnce(ADMIN);
    mockDbRead.firstOrNull
      .mockResolvedValueOnce({ id: "org-1", slug: "old-slug" }) // existing
      .mockResolvedValueOnce(null) // no slug conflict
      .mockResolvedValueOnce({
        id: "org-1",
        name: "Test",
        slug: "new-slug",
        logo_url: null,
        created_by: "admin-1",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
      })
      .mockResolvedValueOnce({ count: 0 });
    mockDbWrite.execute.mockResolvedValueOnce({ changes: 1 });

    const res = await PATCH(makeOrgRequest("PATCH", "org-1", { slug: "new-slug" }), {
      params: Promise.resolve({ orgId: "org-1" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.slug).toBe("new-slug");
  });

  it("should reject duplicate slug on update", async () => {
    resolveAdmin.mockResolvedValueOnce(ADMIN);
    mockDbRead.firstOrNull
      .mockResolvedValueOnce({ id: "org-1", slug: "old-slug" })
      .mockResolvedValueOnce({ id: "org-2" }); // slug conflict

    const res = await PATCH(makeOrgRequest("PATCH", "org-1", { slug: "taken" }), {
      params: Promise.resolve({ orgId: "org-1" }),
    });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain("already exists");
  });

  it("should return 404 for non-existent org", async () => {
    resolveAdmin.mockResolvedValueOnce(ADMIN);
    mockDbRead.firstOrNull.mockResolvedValueOnce(null);

    const res = await PATCH(makeOrgRequest("PATCH", "not-found", { name: "New" }), {
      params: Promise.resolve({ orgId: "not-found" }),
    });
    expect(res.status).toBe(404);
  });

  it("should reject empty update", async () => {
    resolveAdmin.mockResolvedValueOnce(ADMIN);
    mockDbRead.firstOrNull.mockResolvedValueOnce({ id: "org-1", slug: "test" });

    const res = await PATCH(makeOrgRequest("PATCH", "org-1", {}), {
      params: Promise.resolve({ orgId: "org-1" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("No valid fields");
  });

  it("should reject non-admin users", async () => {
    resolveAdmin.mockResolvedValueOnce(null);
    const res = await PATCH(makeOrgRequest("PATCH", "org-1", { name: "New" }), {
      params: Promise.resolve({ orgId: "org-1" }),
    });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/admin/organizations/[orgId]
// ---------------------------------------------------------------------------

describe("DELETE /api/admin/organizations/[orgId]", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;
  let mockDbWrite: ReturnType<typeof createMockDbWrite>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    mockDbWrite = createMockDbWrite();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as never);
    vi.mocked(dbModule.getDbWrite).mockResolvedValue(mockDbWrite as never);
  });

  it("should delete organization", async () => {
    resolveAdmin.mockResolvedValueOnce(ADMIN);
    mockDbRead.firstOrNull.mockResolvedValueOnce({ id: "org-1" });
    mockDbWrite.execute.mockResolvedValueOnce({ changes: 1 });

    const res = await DELETE(makeOrgRequest("DELETE", "org-1"), {
      params: Promise.resolve({ orgId: "org-1" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("should return 404 for non-existent org", async () => {
    resolveAdmin.mockResolvedValueOnce(ADMIN);
    mockDbRead.firstOrNull.mockResolvedValueOnce(null);

    const res = await DELETE(makeOrgRequest("DELETE", "not-found"), {
      params: Promise.resolve({ orgId: "not-found" }),
    });
    expect(res.status).toBe(404);
  });

  it("should reject non-admin users", async () => {
    resolveAdmin.mockResolvedValueOnce(null);
    const res = await DELETE(makeOrgRequest("DELETE", "org-1"), {
      params: Promise.resolve({ orgId: "org-1" }),
    });
    expect(res.status).toBe(403);
  });

  it("should handle no-such-table on delete", async () => {
    resolveAdmin.mockResolvedValueOnce(ADMIN);
    mockDbRead.firstOrNull.mockRejectedValueOnce(new Error("no such table: organizations"));

    const res = await DELETE(makeOrgRequest("DELETE", "org-1"), {
      params: Promise.resolve({ orgId: "org-1" }),
    });
    expect(res.status).toBe(503);
  });
});
