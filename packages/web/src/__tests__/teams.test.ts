import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDbRead, createMockDbWrite, loadMockedAuthHelpers } from "./test-utils";
import * as dbModule from "@/lib/db";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/db", async (importOriginal) => {
  const original = await importOriginal<typeof dbModule>();
  return { ...original, getDbRead: vi.fn(), getDbWrite: vi.fn() };
});

vi.mock("@/lib/auth-helpers", () => ({
  resolveUser: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({
  isAdminUser: vi.fn(),
}));

const { resolveUser } = await loadMockedAuthHelpers();

const { isAdminUser } = (await import("@/lib/admin")) as unknown as {
  isAdminUser: ReturnType<typeof vi.fn>;
};

function makeJson(method: string, body?: unknown): Request {
  const opts: RequestInit = { method };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
    opts.headers = { "Content-Type": "application/json" };
  }
  return new Request("http://localhost:7020/api/teams", opts);
}

// ---------------------------------------------------------------------------
// GET /api/teams
// ---------------------------------------------------------------------------

describe("GET /api/teams", () => {
  let GET: (req: Request) => Promise<Response>;
  let mockDbRead: ReturnType<typeof createMockDbRead>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(
      mockDbRead as unknown as dbModule.DbRead,
    );
    const mod = await import("@/app/api/teams/route");
    GET = mod.GET;
  });

  it("should reject unauthenticated with 401", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce(null);

    const res = await GET(makeJson("GET"));

    expect(res.status).toBe(401);
  });

  it("should return teams list", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.listTeamsForUser.mockResolvedValueOnce([
      {
        id: "t1",
        name: "Team Alpha",
        slug: "team-alpha",
        invite_code: "abc12345",
        created_by: "u1",
        created_at: "2026-01-01T00:00:00Z",
        member_count: 3,
        logo_url: null,
      },
    ]);

    const res = await GET(makeJson("GET"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.teams).toHaveLength(1);
    expect(body.teams[0].name).toBe("Team Alpha");
  });

  it("should return empty array when teams table does not exist", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.listTeamsForUser.mockRejectedValueOnce(new Error("no such table: teams"));

    const res = await GET(makeJson("GET"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.teams).toEqual([]);
  });

  it("should return 500 on unexpected error", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.listTeamsForUser.mockRejectedValueOnce(new Error("D1 down"));

    const res = await GET(makeJson("GET"));

    expect(res.status).toBe(500);
  });

  it("should list all teams for admin users", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "admin-1" });
    vi.mocked(isAdminUser).mockResolvedValueOnce(true);
    (mockDbRead as unknown as { listAllTeams: ReturnType<typeof vi.fn> }).listAllTeams =
      vi.fn().mockResolvedValueOnce([
        {
          id: "t1",
          name: "Team Alpha",
          slug: "team-alpha",
          invite_code: "secret",
          created_by: "other-user",
          created_at: "2026-01-01T00:00:00Z",
          member_count: 3,
          logo_url: "https://example.com/logo.png",
        },
      ]);

    const res = await GET(makeJson("GET"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.teams).toHaveLength(1);
    // Admin can see invite_code
    expect(body.teams[0].invite_code).toBe("secret");
    expect(body.teams[0].logoUrl).toBe("https://example.com/logo.png");
  });

  it("should strip invite_code for non-creator non-admin members", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u2" });
    vi.mocked(isAdminUser).mockResolvedValueOnce(false);
    mockDbRead.listTeamsForUser.mockResolvedValueOnce([
      {
        id: "t1",
        name: "Team Alpha",
        slug: "team-alpha",
        invite_code: "secret",
        created_by: "u1",
        created_at: "2026-01-01T00:00:00Z",
        member_count: 3,
        logo_url: null,
      },
    ]);

    const res = await GET(makeJson("GET"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.teams[0].invite_code).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// POST /api/teams
// ---------------------------------------------------------------------------

describe("POST /api/teams", () => {
  let POST: (req: Request) => Promise<Response>;
  let mockDbRead: ReturnType<typeof createMockDbRead>;
  let mockDbWrite: ReturnType<typeof createMockDbWrite>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    mockDbWrite = createMockDbWrite();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(
      mockDbRead as unknown as dbModule.DbRead,
    );
    vi.mocked(dbModule.getDbWrite).mockResolvedValue(
      mockDbWrite as unknown as dbModule.DbWrite,
    );
    // Deterministic UUIDs for testing
    let callIdx = 0;
    const uuids = [
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      "11111111-2222-3333-4444-555555555555",
      "66666666-7777-8888-9999-000000000000",
    ];
    vi.spyOn(crypto, "randomUUID").mockImplementation(
      () => uuids[callIdx++ % uuids.length]!,
    );
    const mod = await import("@/app/api/teams/route");
    POST = mod.POST;
  });

  it("should reject unauthenticated with 401", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce(null);

    const res = await POST(makeJson("POST", { name: "My Team" }));

    expect(res.status).toBe(401);
  });

  it("should reject invalid JSON", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });

    const res = await POST(
      new Request("http://localhost:7020/api/teams", {
        method: "POST",
        body: "not json",
      }),
    );

    expect(res.status).toBe(400);
  });

  it("should reject empty name", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });

    const res = await POST(makeJson("POST", { name: "" }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("1-64 characters");
  });

  it("should reject name longer than 64 chars", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });

    const res = await POST(makeJson("POST", { name: "a".repeat(65) }));

    expect(res.status).toBe(400);
  });

  it("should create a team with auto-generated slug (201)", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.checkTeamSlugExists.mockResolvedValueOnce(false); // slug not taken
    mockDbWrite.execute.mockResolvedValue({ changes: 1 });

    const res = await POST(makeJson("POST", { name: "My Cool Team!" }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.name).toBe("My Cool Team!");
    expect(body.slug).toBe("my-cool-team"); // auto slugified
    expect(body.member_count).toBe(1);
    expect(body.invite_code).toBeTruthy();
    // Should have 2 execute calls: INSERT teams + INSERT team_members
    expect(mockDbWrite.execute).toHaveBeenCalledTimes(2);
  });

  it("should append random suffix when slug is taken", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.checkTeamSlugExists.mockResolvedValueOnce(true); // slug taken
    mockDbWrite.execute.mockResolvedValue({ changes: 1 });

    const res = await POST(makeJson("POST", { name: "Taken" }));
    const body = await res.json();

    expect(res.status).toBe(201);
    // slug should be "taken-" + 6 random chars from UUID
    expect(body.slug).toMatch(/^taken-[a-f0-9]{6}$/);
  });

  it("should use 'team' as fallback slug for non-alphanumeric names", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.checkTeamSlugExists.mockResolvedValueOnce(false);
    mockDbWrite.execute.mockResolvedValue({ changes: 1 });

    const res = await POST(makeJson("POST", { name: "---" }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.slug).toBe("team");
  });

  it("should return 503 when teams table does not exist", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.checkTeamSlugExists.mockResolvedValueOnce(false);
    mockDbWrite.execute.mockRejectedValueOnce(new Error("no such table: teams"));

    const res = await POST(makeJson("POST", { name: "Test" }));

    expect(res.status).toBe(503);
  });

  it("should return 500 on unexpected POST error", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.checkTeamSlugExists.mockResolvedValueOnce(false);
    mockDbWrite.execute.mockRejectedValueOnce(new Error("D1 down"));

    const res = await POST(makeJson("POST", { name: "Test" }));

    expect(res.status).toBe(500);
  });
});
