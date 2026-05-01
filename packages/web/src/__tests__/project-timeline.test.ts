import { describe, it, expect, vi, beforeEach } from "vitest";
import * as dbModule from "@/lib/db";
import { createMockDbRead, loadMockedAuthHelpers } from "./test-utils";

// Mock DB
vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
  getDbWrite: vi.fn(),
  resetDb: vi.fn(),
}));

// Mock resolveUser
vi.mock("@/lib/auth-helpers", () => ({
  resolveUser: vi.fn(),
}));

const { resolveUser } = await loadMockedAuthHelpers();

describe("GET /api/projects/timeline", () => {
  let GET: (req: Request) => Promise<Response>;
  let mockDbRead: ReturnType<typeof createMockDbRead>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as any);
    const mod = await import("@/app/api/projects/timeline/route");
    GET = mod.GET;
  });

  it("should reject unauthenticated requests", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce(null);
    const res = await GET(
      new Request("http://localhost:7020/api/projects/timeline?from=2026-03-01&to=2026-03-14"),
    );
    expect(res.status).toBe(401);
  });

  it("should require from param", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    const res = await GET(
      new Request("http://localhost:7020/api/projects/timeline"),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("from");
  });

  it("should default to tomorrow when only from is provided", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    mockDbRead.getProjectTimeline.mockResolvedValueOnce([]);

    const res = await GET(
      new Request("http://localhost:7020/api/projects/timeline?from=2026-03-01"),
    );
    expect(res.status).toBe(200);

    // Verify getProjectTimeline was called with correct params
    expect(mockDbRead.getProjectTimeline).toHaveBeenCalledTimes(1);
    const [userId, from, to] = mockDbRead.getProjectTimeline.mock.calls[0]!;
    expect(userId).toBe("u1");
    expect(from).toBe("2026-03-01");
    // to should be a date string (tomorrow), not undefined
    expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("should return timeline grouped by date and project", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    mockDbRead.getProjectTimeline.mockResolvedValueOnce([
      { date: "2026-03-01", project_name: "pew", session_count: 5 },
      { date: "2026-03-01", project_name: "work-api", session_count: 3 },
      { date: "2026-03-01", project_name: "Unassigned", session_count: 2 },
      { date: "2026-03-02", project_name: "pew", session_count: 8 },
    ]);

    const res = await GET(
      new Request(
        "http://localhost:7020/api/projects/timeline?from=2026-03-01&to=2026-03-14",
      ),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.timeline).toHaveLength(2);
    expect(body.timeline[0]).toEqual({
      date: "2026-03-01",
      projects: { pew: 5, "work-api": 3, Unassigned: 2 },
    });
    expect(body.timeline[1]).toEqual({
      date: "2026-03-02",
      projects: { pew: 8 },
    });
  });

  it("should call getProjectTimeline with correct params", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    mockDbRead.getProjectTimeline.mockResolvedValueOnce([]);

    await GET(
      new Request(
        "http://localhost:7020/api/projects/timeline?from=2026-03-01&to=2026-03-14",
      ),
    );

    expect(mockDbRead.getProjectTimeline).toHaveBeenCalledTimes(1);
    expect(mockDbRead.getProjectTimeline).toHaveBeenCalledWith(
      "u1",
      "2026-03-01",
      "2026-03-14",
    );
  });

  it("should return empty timeline when no sessions in range", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    mockDbRead.getProjectTimeline.mockResolvedValueOnce([]);

    const res = await GET(
      new Request(
        "http://localhost:7020/api/projects/timeline?from=2026-03-01&to=2026-03-14",
      ),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.timeline).toEqual([]);
  });

  it("should return 500 on D1 error", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    mockDbRead.getProjectTimeline.mockRejectedValueOnce(new Error("D1 down"));

    const res = await GET(
      new Request(
        "http://localhost:7020/api/projects/timeline?from=2026-03-01&to=2026-03-14",
      ),
    );

    expect(res.status).toBe(500);
  });
});
