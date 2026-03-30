import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDbRead, createMockDbWrite } from "./test-utils";
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

const { resolveUser } = (await import("@/lib/auth-helpers")) as unknown as {
  resolveUser: ReturnType<typeof vi.fn>;
};

function makeGetRequest(month?: string): Request {
  const url = month
    ? `http://localhost:7020/api/budgets?month=${month}`
    : "http://localhost:7020/api/budgets";
  return new Request(url, { method: "GET" });
}

function makePutRequest(body: unknown): Request {
  return new Request("http://localhost:7020/api/budgets", {
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
  let mockDbRead: ReturnType<typeof createMockDbRead>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(
      mockDbRead as unknown as dbModule.DbRead,
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
    mockDbRead.firstOrNull.mockResolvedValueOnce(null);

    const res = await GET(makeGetRequest("2026-03"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toBeNull();
    expect(mockDbRead.firstOrNull).toHaveBeenCalledWith(
      expect.stringContaining("user_budgets"),
      ["u1", "2026-03"],
    );
  });

  it("should return existing budget", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.firstOrNull.mockResolvedValueOnce({
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
    mockDbRead.firstOrNull.mockRejectedValueOnce(new Error("D1 down"));

    const res = await GET(makeGetRequest("2026-03"));
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/budgets
// ---------------------------------------------------------------------------

describe("PUT /api/budgets", () => {
  let PUT: (req: Request) => Promise<Response>;
  let mockDbWrite: ReturnType<typeof createMockDbWrite>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbWrite = createMockDbWrite();
    vi.mocked(dbModule.getDbWrite).mockResolvedValue(
      mockDbWrite as unknown as dbModule.DbWrite,
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
      new Request("http://localhost:7020/api/budgets", {
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
    mockDbWrite.execute.mockResolvedValueOnce({ changes: 1 });

    const res = await PUT(makePutRequest({ month: "2026-03", budget_usd: 100 }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(mockDbWrite.execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO user_budgets"),
      expect.arrayContaining(["u1", "2026-03", 100]),
    );
  });

  it("should upsert budget with only budget_tokens", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbWrite.execute.mockResolvedValueOnce({ changes: 1 });

    const res = await PUT(makePutRequest({ month: "2026-03", budget_tokens: 5_000_000 }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
  });

  it("should upsert budget with both fields", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbWrite.execute.mockResolvedValueOnce({ changes: 1 });

    const res = await PUT(
      makePutRequest({ month: "2026-03", budget_usd: 100, budget_tokens: 5_000_000 }),
    );

    expect(res.status).toBe(200);
    expect(mockDbWrite.execute).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT"),
      expect.arrayContaining(["u1", "2026-03", 100, 5_000_000]),
    );
  });

  it("should accept zero budgets", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbWrite.execute.mockResolvedValueOnce({ changes: 1 });

    const res = await PUT(
      makePutRequest({ month: "2026-03", budget_usd: 0, budget_tokens: 0 }),
    );

    expect(res.status).toBe(200);
  });

  it("should return 500 on unexpected error", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbWrite.execute.mockRejectedValueOnce(new Error("D1 boom"));

    const res = await PUT(makePutRequest({ month: "2026-03", budget_usd: 100 }));
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/budgets
// ---------------------------------------------------------------------------

describe("DELETE /api/budgets", () => {
  let DELETE: (req: Request) => Promise<Response>;
  let mockDbWrite: ReturnType<typeof createMockDbWrite>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbWrite = createMockDbWrite();
    vi.mocked(dbModule.getDbWrite).mockResolvedValue(
      mockDbWrite as unknown as dbModule.DbWrite,
    );
    const mod = await import("@/app/api/budgets/route");
    DELETE = mod.DELETE;
  });

  it("should reject unauthenticated requests with 401", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce(null);

    const res = await DELETE(
      new Request("http://localhost:7020/api/budgets?month=2026-03", { method: "DELETE" }),
    );
    expect(res.status).toBe(401);
  });

  it("should return 400 when month param is missing", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });

    const res = await DELETE(
      new Request("http://localhost:7020/api/budgets", { method: "DELETE" }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("month");
  });

  it("should return 400 for invalid month format", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });

    const res = await DELETE(
      new Request("http://localhost:7020/api/budgets?month=bad", { method: "DELETE" }),
    );
    expect(res.status).toBe(400);
  });

  it("should delete budget and return ok", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbWrite.execute.mockResolvedValueOnce({ changes: 1 });

    const res = await DELETE(
      new Request("http://localhost:7020/api/budgets?month=2026-03", { method: "DELETE" }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(mockDbWrite.execute).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM user_budgets"),
      ["u1", "2026-03"],
    );
  });

  it("should return ok even if no budget existed (idempotent)", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbWrite.execute.mockResolvedValueOnce({ changes: 0 });

    const res = await DELETE(
      new Request("http://localhost:7020/api/budgets?month=2026-03", { method: "DELETE" }),
    );
    expect(res.status).toBe(200);
  });

  it("should return 500 on unexpected error", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbWrite.execute.mockRejectedValueOnce(new Error("D1 boom"));

    const res = await DELETE(
      new Request("http://localhost:7020/api/budgets?month=2026-03", { method: "DELETE" }),
    );
    expect(res.status).toBe(500);
  });
});
