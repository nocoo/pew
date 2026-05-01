import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDbRead, createMockDbWrite, loadMockedAuthHelpers } from "./test-utils";
import * as dbModule from "@/lib/db";
import { inMemoryRateLimiter } from "@/lib/rate-limit";

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

// Mock syncSeasonRosters (called after successful join)
vi.mock("@/lib/season-roster", () => ({
  syncSeasonRosters: vi.fn(),
}));

const { resolveUser } = await loadMockedAuthHelpers();

function makeJson(body?: unknown): Request {
  const opts: RequestInit = { method: "POST" };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
    opts.headers = { "Content-Type": "application/json" };
  }
  return new Request("http://localhost:7020/api/teams/join", opts);
}

// ---------------------------------------------------------------------------
// POST /api/teams/join
// ---------------------------------------------------------------------------

describe("POST /api/teams/join", () => {
  let POST: (req: Request) => Promise<Response>;
  let mockDbRead: ReturnType<typeof createMockDbRead>;
  let mockDbWrite: ReturnType<typeof createMockDbWrite>;

  beforeEach(async () => {
    vi.clearAllMocks();
    inMemoryRateLimiter.reset();
    mockDbRead = createMockDbRead();
    mockDbWrite = createMockDbWrite();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(
      mockDbRead as unknown as dbModule.DbRead,
    );
    vi.mocked(dbModule.getDbWrite).mockResolvedValue(
      mockDbWrite as unknown as dbModule.DbWrite,
    );
    const mod = await import("@/app/api/teams/join/route");
    POST = mod.POST;
  });

  it("should reject unauthenticated with 401", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce(null);

    const res = await POST(makeJson({ invite_code: "abc" }));

    expect(res.status).toBe(401);
  });

  it("should reject invalid JSON", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });

    const res = await POST(
      new Request("http://localhost:7020/api/teams/join", {
        method: "POST",
        body: "not json",
      }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid JSON");
  });

  it("should reject missing invite_code", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });

    const res = await POST(makeJson({}));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("invite_code is required");
  });

  it("should reject empty invite_code", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });

    const res = await POST(makeJson({ invite_code: "" }));

    expect(res.status).toBe(400);
  });

  it("should reject non-string invite_code", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });

    const res = await POST(makeJson({ invite_code: 123 }));

    expect(res.status).toBe(400);
  });

  it("should return 404 for invalid invite code", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.findTeamByInviteCode.mockResolvedValueOnce(null); // no team found

    const res = await POST(makeJson({ invite_code: "bad-code" }));

    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain("Invalid invite code");
  });

  it("should return 409 when already a member", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.findTeamByInviteCode.mockResolvedValueOnce({ id: "t1", name: "Team", slug: "team" }); // team found
    mockDbRead.checkTeamMembershipExists.mockResolvedValueOnce(true); // already a member

    const res = await POST(makeJson({ invite_code: "valid-code" }));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("Already a member");
  });

  it("should join team successfully", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.findTeamByInviteCode.mockResolvedValueOnce({ id: "t1", name: "Team Alpha", slug: "team-alpha" });
    mockDbRead.checkTeamMembershipExists.mockResolvedValueOnce(false); // not yet a member
    mockDbRead.getAppSetting.mockResolvedValueOnce("5"); // max_team_members setting
    // Atomic INSERT ... SELECT succeeds (1 row inserted)
    mockDbWrite.execute.mockResolvedValueOnce({ changes: 1 });

    const res = await POST(makeJson({ invite_code: "valid-code" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.team_id).toBe("t1");
    expect(body.team_name).toBe("Team Alpha");
    expect(body.team_slug).toBe("team-alpha");
    // Verify the INSERT was called with role: member
    const [sql] = mockDbWrite.execute.mock.calls[0]!;
    expect(sql).toContain("'member'");
  });

  it("should return 403 when team is full", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.findTeamByInviteCode.mockResolvedValueOnce({ id: "t1", name: "Team", slug: "team" }); // team found
    mockDbRead.checkTeamMembershipExists.mockResolvedValueOnce(false); // not yet a member
    mockDbRead.getAppSetting.mockResolvedValueOnce("5"); // max_team_members = 5
    // Atomic INSERT ... SELECT inserts 0 rows (team already at limit)
    mockDbWrite.execute.mockResolvedValueOnce({ changes: 0 });

    const res = await POST(makeJson({ invite_code: "valid-code" }));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toContain("Team is full");
    expect(body.error).toContain("5");
  });

  it("should use default limit when settings table missing", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.findTeamByInviteCode.mockResolvedValueOnce({ id: "t1", name: "Team", slug: "team" }); // team found
    mockDbRead.checkTeamMembershipExists.mockResolvedValueOnce(false); // not yet a member
    mockDbRead.getAppSetting.mockRejectedValueOnce(new Error("no such table: app_settings")); // settings missing
    // Atomic INSERT uses default limit of 5, succeeds
    mockDbWrite.execute.mockResolvedValueOnce({ changes: 1 });

    const res = await POST(makeJson({ invite_code: "valid-code" }));
    expect(res.status).toBe(200);
  });

  it("should enforce default limit of 5 when settings table missing", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.findTeamByInviteCode.mockResolvedValueOnce({ id: "t1", name: "Team", slug: "team" }); // team found
    mockDbRead.checkTeamMembershipExists.mockResolvedValueOnce(false); // not yet a member
    mockDbRead.getAppSetting.mockRejectedValueOnce(new Error("no such table: app_settings")); // settings missing
    // Atomic INSERT uses default limit of 5, inserts 0 rows (at limit)
    mockDbWrite.execute.mockResolvedValueOnce({ changes: 0 });

    const res = await POST(makeJson({ invite_code: "valid-code" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("5");
  });

  it("should respect custom team limit from settings", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.findTeamByInviteCode.mockResolvedValueOnce({ id: "t1", name: "Team", slug: "team" }); // team found
    mockDbRead.checkTeamMembershipExists.mockResolvedValueOnce(false); // not yet a member
    mockDbRead.getAppSetting.mockResolvedValueOnce("10"); // custom limit
    // Atomic INSERT uses custom limit of 10, succeeds
    mockDbWrite.execute.mockResolvedValueOnce({ changes: 1 });

    const res = await POST(makeJson({ invite_code: "valid-code" }));
    expect(res.status).toBe(200);
  });

  it("should return 503 when teams table does not exist", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.findTeamByInviteCode.mockRejectedValueOnce(new Error("no such table: teams"));

    const res = await POST(makeJson({ invite_code: "abc" }));

    expect(res.status).toBe(503);
  });

  it("should return 500 on unexpected error", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.findTeamByInviteCode.mockRejectedValueOnce(new Error("D1 down"));

    const res = await POST(makeJson({ invite_code: "abc" }));

    expect(res.status).toBe(500);
  });

  it("should use atomic INSERT ... SELECT to prevent race conditions", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.findTeamByInviteCode.mockResolvedValueOnce({ id: "t1", name: "Team", slug: "team" }); // team found
    mockDbRead.checkTeamMembershipExists.mockResolvedValueOnce(false); // not yet a member
    mockDbRead.getAppSetting.mockResolvedValueOnce("5"); // max_team_members setting
    // Atomic INSERT ... SELECT succeeds with 1 change
    mockDbWrite.execute.mockResolvedValueOnce({ changes: 1 });

    const res = await POST(makeJson({ invite_code: "valid-code" }));
    expect(res.status).toBe(200);

    // Verify the INSERT uses a SELECT subquery (atomic pattern)
    const [sql] = mockDbWrite.execute.mock.calls[0]!;
    expect(sql).toContain("INSERT INTO team_members");
    expect(sql).toContain("SELECT");
    expect(sql).toContain("COUNT(*)");
  });

  it("should return 403 when atomic INSERT inserts 0 rows (race lost)", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.findTeamByInviteCode.mockResolvedValueOnce({ id: "t1", name: "Team", slug: "team" }); // team found
    mockDbRead.checkTeamMembershipExists.mockResolvedValueOnce(false); // not yet a member
    mockDbRead.getAppSetting.mockResolvedValueOnce("5"); // max_team_members setting
    // Atomic INSERT ... SELECT inserts 0 rows (team became full concurrently)
    mockDbWrite.execute.mockResolvedValueOnce({ changes: 0 });

    const res = await POST(makeJson({ invite_code: "valid-code" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("Team is full");
  });

  it("should return 429 when rate limited", async () => {
    vi.mocked(resolveUser).mockResolvedValue({ userId: "rate-user" });

    // Exhaust rate limit (5 requests per minute)
    for (let i = 0; i < 5; i++) {
      mockDbRead.findTeamByInviteCode.mockResolvedValueOnce(null);
      await POST(makeJson({ invite_code: "code" }));
    }

    const res = await POST(makeJson({ invite_code: "code" }));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toContain("Too many join attempts");
  });

  it("should succeed even when syncSeasonRosters fails", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.findTeamByInviteCode.mockResolvedValueOnce({ id: "t1", name: "Team", slug: "team" });
    mockDbRead.checkTeamMembershipExists.mockResolvedValueOnce(false);
    mockDbRead.getAppSetting.mockResolvedValueOnce("5");
    mockDbWrite.execute.mockResolvedValueOnce({ changes: 1 });

    const { syncSeasonRosters } = (await import("@/lib/season-roster")) as unknown as {
      syncSeasonRosters: ReturnType<typeof vi.fn>;
    };
    syncSeasonRosters.mockRejectedValueOnce(new Error("roster sync failed"));

    const res = await POST(makeJson({ invite_code: "valid-code" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.team_id).toBe("t1");
  });
});
