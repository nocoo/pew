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

describe("GET /api/projects/timeline", () => {
  let GET: (req: Request) => Promise<Response>;
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    vi.mocked(d1Module.getD1Client).mockReturnValue(
      mockClient as unknown as d1Module.D1Client,
    );
    const mod = await import("@/app/api/projects/timeline/route");
    GET = mod.GET;
  });

  it("should reject unauthenticated requests", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce(null);
    const res = await GET(
      new Request("http://localhost:7030/api/projects/timeline?from=2026-03-01&to=2026-03-14"),
    );
    expect(res.status).toBe(401);
  });

  it("should require from param", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    const res = await GET(
      new Request("http://localhost:7030/api/projects/timeline"),
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

    mockClient.query.mockResolvedValueOnce({ results: [], meta: {} });

    const res = await GET(
      new Request("http://localhost:7030/api/projects/timeline?from=2026-03-01"),
    );
    expect(res.status).toBe(200);

    // Verify the `to` param was defaulted (tomorrow)
    const [, params] = mockClient.query.mock.calls[0];
    expect(params[0]).toBe("u1");
    expect(params[1]).toBe("2026-03-01");
    // to should be a date string (tomorrow), not undefined
    expect(params[2]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("should return timeline grouped by date and project", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    mockClient.query.mockResolvedValueOnce({
      results: [
        { date: "2026-03-01", project_name: "pew", session_count: 5 },
        { date: "2026-03-01", project_name: "work-api", session_count: 3 },
        { date: "2026-03-01", project_name: "Unassigned", session_count: 2 },
        { date: "2026-03-02", project_name: "pew", session_count: 8 },
      ],
      meta: {},
    });

    const res = await GET(
      new Request(
        "http://localhost:7030/api/projects/timeline?from=2026-03-01&to=2026-03-14",
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

  it("should pass correct params to SQL query", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    mockClient.query.mockResolvedValueOnce({ results: [], meta: {} });

    await GET(
      new Request(
        "http://localhost:7030/api/projects/timeline?from=2026-03-01&to=2026-03-14",
      ),
    );

    expect(mockClient.query).toHaveBeenCalledTimes(1);
    const [sql, params] = mockClient.query.mock.calls[0];
    expect(params).toEqual(["u1", "2026-03-01", "2026-03-14"]);
    expect(sql).toContain("COALESCE(p.name, 'Unassigned')");
    expect(sql).toContain("DATE(sr.started_at)");
    expect(sql).toContain("GROUP BY date, project_name");
  });

  it("should return empty timeline when no sessions in range", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "test@example.com",
    });

    mockClient.query.mockResolvedValueOnce({ results: [], meta: {} });

    const res = await GET(
      new Request(
        "http://localhost:7030/api/projects/timeline?from=2026-03-01&to=2026-03-14",
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

    mockClient.query.mockRejectedValueOnce(new Error("D1 down"));

    const res = await GET(
      new Request(
        "http://localhost:7030/api/projects/timeline?from=2026-03-01&to=2026-03-14",
      ),
    );

    expect(res.status).toBe(500);
  });
});
