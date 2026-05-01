import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be before imports that trigger the module chain
// ---------------------------------------------------------------------------

vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
  getDbWrite: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  resolveUser: vi.fn(),
}));

vi.mock("@/auth", () => ({
  shouldUseSecureCookies: vi.fn(() => false),
}));

import { GET as LIST_ALL } from "@/app/api/organizations/route";
import { GET as LIST_MINE } from "@/app/api/organizations/mine/route";
import { GET as LIST_MEMBERS } from "@/app/api/organizations/[orgId]/members/route";
import { POST as JOIN } from "@/app/api/organizations/[orgId]/join/route";
import { DELETE as LEAVE } from "@/app/api/organizations/[orgId]/leave/route";
import { createMockDbRead, createMockDbWrite, loadMockedAuthHelpers, makeJsonRequest } from "./test-utils";
import * as dbModule from "@/lib/db";

const { resolveUser } = await loadMockedAuthHelpers();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER = { userId: "user-1" };

function makeOrgRequest(
  method: string,
  orgId: string,
  body?: Record<string, unknown>
) {
  const url = `http://localhost:7020/api/organizations/${orgId}`;
  const init: RequestInit = { method };
  if (body) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  return new Request(url, init);
}

// ---------------------------------------------------------------------------
// GET /api/organizations — list all organizations
// ---------------------------------------------------------------------------

describe("GET /api/organizations", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as never);
  });

  it("should return all organizations with member counts", async () => {
    resolveUser.mockResolvedValueOnce(USER);

    mockDbRead.listOrganizationsWithCount.mockResolvedValueOnce([
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
        created_by: "admin-2",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        member_count: 10,
      },
    ]);

    const res = await LIST_ALL(makeJsonRequest("GET", "/api/organizations"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.organizations).toHaveLength(2);
    expect(json.organizations[0]).toEqual({
      id: "org-1",
      name: "Anthropic",
      slug: "anthropic",
      logoUrl: "https://example.com/logo.png",
      memberCount: 5,
    });
    expect(json.organizations[1].memberCount).toBe(10);
  });

  it("should reject unauthenticated requests", async () => {
    resolveUser.mockResolvedValueOnce(null);
    const res = await LIST_ALL(makeJsonRequest("GET", "/api/organizations"));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("should return empty array if table not migrated", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.listOrganizationsWithCount.mockRejectedValueOnce(new Error("no such table: organizations"));

    const res = await LIST_ALL(makeJsonRequest("GET", "/api/organizations"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.organizations).toEqual([]);
  });

  it("should return 500 on unexpected error", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.listOrganizationsWithCount.mockRejectedValueOnce(new Error("DB connection failed"));

    const res = await LIST_ALL(makeJsonRequest("GET", "/api/organizations"));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("Failed to list organizations");
  });
});

// ---------------------------------------------------------------------------
// GET /api/organizations/mine — list user's organizations
// ---------------------------------------------------------------------------

describe("GET /api/organizations/mine", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as never);
  });

  it("should return user's organizations", async () => {
    resolveUser.mockResolvedValueOnce(USER);

    mockDbRead.listUserOrganizations.mockResolvedValueOnce([
      {
        id: "org-1",
        name: "Anthropic",
        slug: "anthropic",
        logo_url: "https://example.com/logo.png",
        created_by: "admin-1",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ]);

    const res = await LIST_MINE(makeJsonRequest("GET", "/api/organizations/mine"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.organizations).toHaveLength(1);
    expect(json.organizations[0]).toEqual({
      id: "org-1",
      name: "Anthropic",
      slug: "anthropic",
      logoUrl: "https://example.com/logo.png",
    });
  });

  it("should return empty array if user has no orgs", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.listUserOrganizations.mockResolvedValueOnce([]);

    const res = await LIST_MINE(makeJsonRequest("GET", "/api/organizations/mine"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.organizations).toEqual([]);
  });

  it("should reject unauthenticated requests", async () => {
    resolveUser.mockResolvedValueOnce(null);
    const res = await LIST_MINE(makeJsonRequest("GET", "/api/organizations/mine"));
    expect(res.status).toBe(401);
  });

  it("should return empty array if table not migrated", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.listUserOrganizations.mockRejectedValueOnce(new Error("no such table"));

    const res = await LIST_MINE(makeJsonRequest("GET", "/api/organizations/mine"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.organizations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// GET /api/organizations/[orgId]/members — list organization members
// ---------------------------------------------------------------------------

describe("GET /api/organizations/[orgId]/members", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as never);
  });

  it("should return organization members", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.firstOrNull.mockResolvedValueOnce({ id: "org-1" });
    mockDbRead.query.mockResolvedValueOnce({
      results: [
        {
          id: "member-1",
          org_id: "org-1",
          user_id: "user-1",
          joined_at: "2026-01-01T00:00:00Z",
          user_name: "Alice",
          user_image: "https://example.com/alice.png",
          user_slug: "alice",
        },
        {
          id: "member-2",
          org_id: "org-1",
          user_id: "user-2",
          joined_at: "2026-01-02T00:00:00Z",
          user_name: "Bob",
          user_image: null,
          user_slug: "bob",
        },
      ],
    });

    const res = await LIST_MEMBERS(makeOrgRequest("GET", "org-1/members"), {
      params: Promise.resolve({ orgId: "org-1" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.members).toHaveLength(2);
    expect(json.members[0]).toEqual({
      id: "member-1",
      orgId: "org-1",
      userId: "user-1",
      joinedAt: "2026-01-01T00:00:00Z",
      user: {
        id: "user-1",
        name: "Alice",
        image: "https://example.com/alice.png",
        slug: "alice",
      },
    });
    // Verify no email is exposed
    expect(json.members[0].user.email).toBeUndefined();
  });

  it("should return 404 for non-existent org", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.firstOrNull.mockResolvedValueOnce(null);

    const res = await LIST_MEMBERS(makeOrgRequest("GET", "not-found/members"), {
      params: Promise.resolve({ orgId: "not-found" }),
    });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("Organization not found");
  });

  it("should reject unauthenticated requests", async () => {
    resolveUser.mockResolvedValueOnce(null);
    const res = await LIST_MEMBERS(makeOrgRequest("GET", "org-1/members"), {
      params: Promise.resolve({ orgId: "org-1" }),
    });
    expect(res.status).toBe(401);
  });

  it("should return 503 if table not migrated", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.firstOrNull.mockRejectedValueOnce(new Error("no such table"));

    const res = await LIST_MEMBERS(makeOrgRequest("GET", "org-1/members"), {
      params: Promise.resolve({ orgId: "org-1" }),
    });
    expect(res.status).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// POST /api/organizations/[orgId]/join — join organization
// ---------------------------------------------------------------------------

describe("POST /api/organizations/[orgId]/join", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;
  let mockDbWrite: ReturnType<typeof createMockDbWrite>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    mockDbWrite = createMockDbWrite();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as never);
    vi.mocked(dbModule.getDbWrite).mockResolvedValue(mockDbWrite as never);
  });

  it("should join organization successfully", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getOrganizationById.mockResolvedValueOnce({
      id: "org-1",
      name: "Anthropic",
      slug: "anthropic",
      logo_url: null,
      created_by: "admin-1",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    });
    mockDbRead.checkOrgMembership.mockResolvedValueOnce(false);
    mockDbWrite.execute.mockResolvedValueOnce({ changes: 1 });

    const res = await JOIN(makeOrgRequest("POST", "org-1/join"), {
      params: Promise.resolve({ orgId: "org-1" }),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.orgId).toBe("org-1");
    expect(json.orgName).toBe("Anthropic");
    expect(json.orgSlug).toBe("anthropic");
  });

  it("should return 404 for non-existent org", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getOrganizationById.mockResolvedValueOnce(null);

    const res = await JOIN(makeOrgRequest("POST", "not-found/join"), {
      params: Promise.resolve({ orgId: "not-found" }),
    });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("Organization not found");
  });

  it("should return 409 if already a member", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getOrganizationById.mockResolvedValueOnce({
      id: "org-1",
      name: "Anthropic",
      slug: "anthropic",
      logo_url: null,
      created_by: "admin-1",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    });
    mockDbRead.checkOrgMembership.mockResolvedValueOnce(true);

    const res = await JOIN(makeOrgRequest("POST", "org-1/join"), {
      params: Promise.resolve({ orgId: "org-1" }),
    });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("Already a member of this organization");
  });

  it("should reject unauthenticated requests", async () => {
    resolveUser.mockResolvedValueOnce(null);
    const res = await JOIN(makeOrgRequest("POST", "org-1/join"), {
      params: Promise.resolve({ orgId: "org-1" }),
    });
    expect(res.status).toBe(401);
  });

  it("should return 503 if table not migrated", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getOrganizationById.mockRejectedValueOnce(new Error("no such table"));

    const res = await JOIN(makeOrgRequest("POST", "org-1/join"), {
      params: Promise.resolve({ orgId: "org-1" }),
    });
    expect(res.status).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/organizations/[orgId]/leave — leave organization
// ---------------------------------------------------------------------------

describe("DELETE /api/organizations/[orgId]/leave", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;
  let mockDbWrite: ReturnType<typeof createMockDbWrite>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    mockDbWrite = createMockDbWrite();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as never);
    vi.mocked(dbModule.getDbWrite).mockResolvedValue(mockDbWrite as never);
  });

  it("should leave organization successfully", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getOrganizationById.mockResolvedValueOnce({
      id: "org-1",
      name: "Anthropic",
      slug: "anthropic",
      logo_url: null,
      created_by: "admin-1",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    });
    mockDbRead.checkOrgMembership.mockResolvedValueOnce(true);
    mockDbWrite.execute.mockResolvedValueOnce({ changes: 1 });

    const res = await LEAVE(makeOrgRequest("DELETE", "org-1/leave"), {
      params: Promise.resolve({ orgId: "org-1" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("should return 404 for non-existent org", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getOrganizationById.mockResolvedValueOnce(null);

    const res = await LEAVE(makeOrgRequest("DELETE", "not-found/leave"), {
      params: Promise.resolve({ orgId: "not-found" }),
    });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("Organization not found");
  });

  it("should return 404 if not a member", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getOrganizationById.mockResolvedValueOnce({
      id: "org-1",
      name: "Anthropic",
      slug: "anthropic",
      logo_url: null,
      created_by: "admin-1",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    });
    mockDbRead.checkOrgMembership.mockResolvedValueOnce(false);

    const res = await LEAVE(makeOrgRequest("DELETE", "org-1/leave"), {
      params: Promise.resolve({ orgId: "org-1" }),
    });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("Not a member of this organization");
  });

  it("should reject unauthenticated requests", async () => {
    resolveUser.mockResolvedValueOnce(null);
    const res = await LEAVE(makeOrgRequest("DELETE", "org-1/leave"), {
      params: Promise.resolve({ orgId: "org-1" }),
    });
    expect(res.status).toBe(401);
  });

  it("should return 503 if table not migrated", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getOrganizationById.mockRejectedValueOnce(new Error("no such table"));

    const res = await LEAVE(makeOrgRequest("DELETE", "org-1/leave"), {
      params: Promise.resolve({ orgId: "org-1" }),
    });
    expect(res.status).toBe(503);
  });
});
