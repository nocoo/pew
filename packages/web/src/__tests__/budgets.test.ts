import { describe, it, expect, vi, beforeEach } from "vitest";
import * as d1Module from "@/lib/d1";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/d1", async (importOriginal) => {
  const original = await importOriginal<typeof d1Module>();
  return { ...original, getD1Client: vi.fn() };
});

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

function makeGetRequest(month?: string): Request {
  const url = month
    ? `http://localhost:7030/api/budgets?month=${month}`
    : "http://localhost:7030/api/budgets";
  return new Request(url, { method: "GET" });
}

function makePutRequest(body: unknown): Request {
  return new Request("http://localhost:7030/api/budgets", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// GET /api/budgets
// ---------------------------------------------------------------------------

describe("GET /api/budgets", () => {
  let GET: (req: Request) => Promise<Response>;
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    vi.mocked(d1Module.getD1Client).mockReturnValue(
      mockClient as unknown as d1Module.D1Client,
    );
    const mod = await import("@/app/api/budgets/route");
    GET = mod.GET;
  });

  it("should reject unauthenticated requests with 401", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce(null);

    const res = await GET(makeGetRequest("2026-03"));
    expect(res.status).toBe(401);
  });

  it("should return 400 when month param is missing", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("month");
  });

  it("should return 400 for invalid month format", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });

    const res = await GET(makeGetRequest("2026-13"));
    expect(res.status).toBe(400);
  });

  it("should return null when no budget exists", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockClient.firstOrNull.mockResolvedValueOnce(null);

    const res = await GET(makeGetRequest("2026-03"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toBeNull();
    expect(mockClient.firstOrNull).toHaveBeenCalledWith(
      expect.stringContaining("user_budgets"),
      ["u1", "2026-03"],
    );
  });

  it("should return existing budget", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockClient.firstOrNull.mockResolvedValueOnce({
      budget_usd: 100,
      budget_tokens: 5_000_000,
      month: "2026-03",
    });

    const res = await GET(makeGetRequest("2026-03"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      budget_usd: 100,
      budget_tokens: 5_000_000,
      month: "2026-03",
    });
  });

  it("should return 500 on unexpected error", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockClient.firstOrNull.mockRejectedValueOnce(new Error("D1 down"));

    const res = await GET(makeGetRequest("2026-03"));
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/budgets
// ---------------------------------------------------------------------------

describe("PUT /api/budgets", () => {
  let PUT: (req: Request) => Promise<Response>;
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    vi.mocked(d1Module.getD1Client).mockReturnValue(
      mockClient as unknown as d1Module.D1Client,
    );
    const mod = await import("@/app/api/budgets/route");
    PUT = mod.PUT;
  });

  it("should reject unauthenticated requests with 401", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce(null);

    const res = await PUT(makePutRequest({ month: "2026-03", budget_usd: 100 }));
    expect(res.status).toBe(401);
  });

  it("should return 400 for invalid JSON", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });

    const res = await PUT(
      new Request("http://localhost:7030/api/budgets", {
        method: "PUT",
        body: "not json",
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("should return 400 for invalid month format", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });

    const res = await PUT(makePutRequest({ month: "March 2026", budget_usd: 100 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("month");
  });

  it("should return 400 for negative budget_usd", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });

    const res = await PUT(makePutRequest({ month: "2026-03", budget_usd: -50 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("budget_usd");
  });

  it("should return 400 for negative budget_tokens", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });

    const res = await PUT(makePutRequest({ month: "2026-03", budget_tokens: -1 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("budget_tokens");
  });

  it("should return 400 when neither budget_usd nor budget_tokens provided", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });

    const res = await PUT(makePutRequest({ month: "2026-03" }));
    expect(res.status).toBe(400);
  });

  it("should upsert budget with only budget_usd", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockClient.execute.mockResolvedValueOnce({ changes: 1 });

    const res = await PUT(makePutRequest({ month: "2026-03", budget_usd: 100 }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(mockClient.execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO user_budgets"),
      expect.arrayContaining(["u1", "2026-03", 100]),
    );
  });

  it("should upsert budget with only budget_tokens", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockClient.execute.mockResolvedValueOnce({ changes: 1 });

    const res = await PUT(makePutRequest({ month: "2026-03", budget_tokens: 5_000_000 }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
  });

  it("should upsert budget with both fields", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockClient.execute.mockResolvedValueOnce({ changes: 1 });

    const res = await PUT(
      makePutRequest({ month: "2026-03", budget_usd: 100, budget_tokens: 5_000_000 }),
    );

    expect(res.status).toBe(200);
    expect(mockClient.execute).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT"),
      expect.arrayContaining(["u1", "2026-03", 100, 5_000_000]),
    );
  });

  it("should accept zero budgets", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockClient.execute.mockResolvedValueOnce({ changes: 1 });

    const res = await PUT(
      makePutRequest({ month: "2026-03", budget_usd: 0, budget_tokens: 0 }),
    );

    expect(res.status).toBe(200);
  });

  it("should return 500 on unexpected error", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockClient.execute.mockRejectedValueOnce(new Error("D1 boom"));

    const res = await PUT(makePutRequest({ month: "2026-03", budget_usd: 100 }));
    expect(res.status).toBe(500);
  });
});
