import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDbRead, createMockDbWrite } from "./test-utils";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
  getDbWrite: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({
  resolveAdmin: vi.fn(),
}));

import * as dbModule from "@/lib/db";

const { resolveAdmin } = (await import("@/lib/admin")) as unknown as {
  resolveAdmin: ReturnType<typeof vi.fn>;
};

function makeJson(method: string, body?: unknown): Request {
  const opts: RequestInit = { method };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
    opts.headers = { "Content-Type": "application/json" };
  }
  return new Request("http://localhost:7020/api/admin/pricing", opts);
}

function makeDelete(params: Record<string, string> = {}): Request {
  const url = new URL("http://localhost:7020/api/admin/pricing");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url.toString(), { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// GET /api/admin/pricing
// ---------------------------------------------------------------------------

describe("GET /api/admin/pricing", () => {
  let GET: (req: Request) => Promise<Response>;
  let mockDbRead: ReturnType<typeof createMockDbRead>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as never);
    const mod = await import("@/app/api/admin/pricing/route");
    GET = mod.GET;
  });

  it("should reject non-admin with 403", async () => {
    vi.mocked(resolveAdmin).mockResolvedValueOnce(null);

    const res = await GET(makeJson("GET"));

    expect(res.status).toBe(403);
  });

  it("should return pricing rows", async () => {
    vi.mocked(resolveAdmin).mockResolvedValueOnce({
      userId: "u1",
      email: "admin@test.com",
    });
    mockDbRead.listModelPricing.mockResolvedValueOnce([
      { id: 1, model: "gpt-4o", input: 2.5, output: 10.0, cached: null, source: null, note: null, updated_at: "", created_at: "" },
    ]);

    const res = await GET(makeJson("GET"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].model).toBe("gpt-4o");
  });

  it("should return empty rows when table does not exist", async () => {
    vi.mocked(resolveAdmin).mockResolvedValueOnce({
      userId: "u1",
      email: "admin@test.com",
    });
    mockDbRead.listModelPricing.mockRejectedValueOnce(new Error("no such table: model_pricing"));

    const res = await GET(makeJson("GET"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.rows).toEqual([]);
  });

  it("should return 500 on unexpected error", async () => {
    vi.mocked(resolveAdmin).mockResolvedValueOnce({
      userId: "u1",
      email: "admin@test.com",
    });
    mockDbRead.listModelPricing.mockRejectedValueOnce(new Error("D1 down"));

    const res = await GET(makeJson("GET"));

    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/pricing
// ---------------------------------------------------------------------------

describe("POST /api/admin/pricing", () => {
  let POST: (req: Request) => Promise<Response>;
  let mockDbRead: ReturnType<typeof createMockDbRead>;
  let mockDbWrite: ReturnType<typeof createMockDbWrite>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    mockDbWrite = createMockDbWrite();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as never);
    vi.mocked(dbModule.getDbWrite).mockResolvedValue(mockDbWrite as never);
    const mod = await import("@/app/api/admin/pricing/route");
    POST = mod.POST;
  });

  it("should reject non-admin with 403", async () => {
    vi.mocked(resolveAdmin).mockResolvedValueOnce(null);

    const res = await POST(makeJson("POST", { model: "x", input: 1, output: 1 }));

    expect(res.status).toBe(403);
  });

  it("should reject invalid JSON", async () => {
    vi.mocked(resolveAdmin).mockResolvedValueOnce({
      userId: "u1",
      email: "a@test.com",
    });

    const res = await POST(
      new Request("http://localhost:7020/api/admin/pricing", {
        method: "POST",
        body: "bad",
      }),
    );

    expect(res.status).toBe(400);
  });

  it("should reject missing model", async () => {
    vi.mocked(resolveAdmin).mockResolvedValueOnce({
      userId: "u1",
      email: "a@test.com",
    });

    const res = await POST(makeJson("POST", { input: 1, output: 1 }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("model is required");
  });

  it("should reject empty model string", async () => {
    vi.mocked(resolveAdmin).mockResolvedValueOnce({
      userId: "u1",
      email: "a@test.com",
    });

    const res = await POST(makeJson("POST", { model: "  ", input: 1, output: 1 }));

    expect(res.status).toBe(400);
  });

  it("should reject negative input", async () => {
    vi.mocked(resolveAdmin).mockResolvedValueOnce({
      userId: "u1",
      email: "a@test.com",
    });

    const res = await POST(makeJson("POST", { model: "gpt-4o", input: -1, output: 1 }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("input");
  });

  it("should reject negative output", async () => {
    vi.mocked(resolveAdmin).mockResolvedValueOnce({
      userId: "u1",
      email: "a@test.com",
    });

    const res = await POST(makeJson("POST", { model: "gpt-4o", input: 1, output: -1 }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("output");
  });

  it("should reject negative cached value", async () => {
    vi.mocked(resolveAdmin).mockResolvedValueOnce({
      userId: "u1",
      email: "a@test.com",
    });

    const res = await POST(
      makeJson("POST", { model: "gpt-4o", input: 1, output: 1, cached: -5 }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("cached");
  });

  it("should accept null cached value", async () => {
    vi.mocked(resolveAdmin).mockResolvedValueOnce({
      userId: "u1",
      email: "a@test.com",
    });
    mockDbWrite.execute.mockResolvedValueOnce({ changes: 1 });
    mockDbRead.firstOrNull.mockResolvedValueOnce({
      id: 1,
      model: "gpt-4o",
      input: 1,
      output: 2,
      cached: null,
    });

    const res = await POST(
      makeJson("POST", { model: "gpt-4o", input: 1, output: 2, cached: null }),
    );

    expect(res.status).toBe(201);
  });

  it("should create a pricing entry (201)", async () => {
    vi.mocked(resolveAdmin).mockResolvedValueOnce({
      userId: "u1",
      email: "a@test.com",
    });
    mockDbWrite.execute.mockResolvedValueOnce({ changes: 1 });
    mockDbRead.firstOrNull.mockResolvedValueOnce({
      id: 1,
      model: "gpt-4o",
      input: 2.5,
      output: 10.0,
      cached: null,
      source: null,
      note: null,
    });

    const res = await POST(
      makeJson("POST", { model: "gpt-4o", input: 2.5, output: 10.0 }),
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.model).toBe("gpt-4o");
  });

  it("should return 409 on UNIQUE constraint violation", async () => {
    vi.mocked(resolveAdmin).mockResolvedValueOnce({
      userId: "u1",
      email: "a@test.com",
    });
    mockDbWrite.execute.mockRejectedValueOnce(new Error("UNIQUE constraint failed"));

    const res = await POST(
      makeJson("POST", { model: "gpt-4o", input: 1, output: 1 }),
    );

    expect(res.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/admin/pricing
// ---------------------------------------------------------------------------

describe("PUT /api/admin/pricing", () => {
  let PUT: (req: Request) => Promise<Response>;
  let mockDbRead: ReturnType<typeof createMockDbRead>;
  let mockDbWrite: ReturnType<typeof createMockDbWrite>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    mockDbWrite = createMockDbWrite();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as never);
    vi.mocked(dbModule.getDbWrite).mockResolvedValue(mockDbWrite as never);
    const mod = await import("@/app/api/admin/pricing/route");
    PUT = mod.PUT;
  });

  it("should reject non-admin with 403", async () => {
    vi.mocked(resolveAdmin).mockResolvedValueOnce(null);

    const res = await PUT(makeJson("PUT", { id: 1, model: "x" }));

    expect(res.status).toBe(403);
  });

  it("should reject missing id", async () => {
    vi.mocked(resolveAdmin).mockResolvedValueOnce({
      userId: "u1",
      email: "a@test.com",
    });

    const res = await PUT(makeJson("PUT", { model: "x" }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("id is required");
  });

  it("should reject empty model string", async () => {
    vi.mocked(resolveAdmin).mockResolvedValueOnce({
      userId: "u1",
      email: "a@test.com",
    });

    const res = await PUT(makeJson("PUT", { id: 1, model: "" }));

    expect(res.status).toBe(400);
  });

  it("should reject negative input", async () => {
    vi.mocked(resolveAdmin).mockResolvedValueOnce({
      userId: "u1",
      email: "a@test.com",
    });

    const res = await PUT(makeJson("PUT", { id: 1, input: -5 }));

    expect(res.status).toBe(400);
  });

  it("should reject negative output", async () => {
    vi.mocked(resolveAdmin).mockResolvedValueOnce({
      userId: "u1",
      email: "a@test.com",
    });

    const res = await PUT(makeJson("PUT", { id: 1, output: -3 }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("output");
  });

  it("should reject negative cached in PUT", async () => {
    vi.mocked(resolveAdmin).mockResolvedValueOnce({
      userId: "u1",
      email: "a@test.com",
    });

    const res = await PUT(makeJson("PUT", { id: 1, cached: -1 }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("cached");
  });

  it("should reject no fields to update", async () => {
    vi.mocked(resolveAdmin).mockResolvedValueOnce({
      userId: "u1",
      email: "a@test.com",
    });

    const res = await PUT(makeJson("PUT", { id: 1 }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("No fields");
  });

  it("should update partial fields", async () => {
    vi.mocked(resolveAdmin).mockResolvedValueOnce({
      userId: "u1",
      email: "a@test.com",
    });
    mockDbWrite.execute.mockResolvedValueOnce({ changes: 1 });
    mockDbRead.firstOrNull.mockResolvedValueOnce({
      id: 1,
      model: "gpt-4o",
      input: 5,
      output: 10,
    });

    const res = await PUT(makeJson("PUT", { id: 1, input: 5 }));

    expect(res.status).toBe(200);
    const [sql] = mockDbWrite.execute.mock.calls[0]!;
    expect(sql).toContain("input = ?");
    expect(sql).toContain("updated_at = datetime('now')");
  });

  it("should return 404 when entry not found (changes === 0)", async () => {
    vi.mocked(resolveAdmin).mockResolvedValueOnce({
      userId: "u1",
      email: "a@test.com",
    });
    mockDbWrite.execute.mockResolvedValueOnce({ changes: 0 });

    const res = await PUT(makeJson("PUT", { id: 999, model: "x" }));

    expect(res.status).toBe(404);
  });

  it("should return 409 on UNIQUE constraint violation", async () => {
    vi.mocked(resolveAdmin).mockResolvedValueOnce({
      userId: "u1",
      email: "a@test.com",
    });
    mockDbWrite.execute.mockRejectedValueOnce(new Error("UNIQUE constraint failed"));

    const res = await PUT(makeJson("PUT", { id: 1, model: "dup" }));

    expect(res.status).toBe(409);
  });

  it("should allow setting cached to null", async () => {
    vi.mocked(resolveAdmin).mockResolvedValueOnce({
      userId: "u1",
      email: "a@test.com",
    });
    mockDbWrite.execute.mockResolvedValueOnce({ changes: 1 });
    mockDbRead.firstOrNull.mockResolvedValueOnce({ id: 1, cached: null });

    const res = await PUT(makeJson("PUT", { id: 1, cached: null }));

    expect(res.status).toBe(200);
    const [, params] = mockDbWrite.execute.mock.calls[0]!;
    expect(params).toContain(null);
  });

  it("should allow setting source and note", async () => {
    vi.mocked(resolveAdmin).mockResolvedValueOnce({
      userId: "u1",
      email: "a@test.com",
    });
    mockDbWrite.execute.mockResolvedValueOnce({ changes: 1 });
    mockDbRead.firstOrNull.mockResolvedValueOnce({ id: 1 });

    const res = await PUT(
      makeJson("PUT", { id: 1, source: "openai", note: "updated" }),
    );

    expect(res.status).toBe(200);
    const [sql] = mockDbWrite.execute.mock.calls[0]!;
    expect(sql).toContain("source = ?");
    expect(sql).toContain("note = ?");
  });

  it("should return 500 on unexpected error", async () => {
    vi.mocked(resolveAdmin).mockResolvedValueOnce({
      userId: "u1",
      email: "a@test.com",
    });
    mockDbWrite.execute.mockRejectedValueOnce(new Error("D1 boom"));

    const res = await PUT(makeJson("PUT", { id: 1, model: "x" }));

    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/admin/pricing
// ---------------------------------------------------------------------------

describe("DELETE /api/admin/pricing", () => {
  let DELETE: (req: Request) => Promise<Response>;
  let mockDbWrite: ReturnType<typeof createMockDbWrite>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbWrite = createMockDbWrite();
    vi.mocked(dbModule.getDbWrite).mockResolvedValue(mockDbWrite as never);
    const mod = await import("@/app/api/admin/pricing/route");
    DELETE = mod.DELETE;
  });

  it("should reject non-admin with 403", async () => {
    vi.mocked(resolveAdmin).mockResolvedValueOnce(null);

    const res = await DELETE(makeDelete({ id: "1" }));

    expect(res.status).toBe(403);
  });

  it("should reject missing id param", async () => {
    vi.mocked(resolveAdmin).mockResolvedValueOnce({
      userId: "u1",
      email: "a@test.com",
    });

    const res = await DELETE(makeDelete());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("id");
  });

  it("should reject NaN id", async () => {
    vi.mocked(resolveAdmin).mockResolvedValueOnce({
      userId: "u1",
      email: "a@test.com",
    });

    const res = await DELETE(makeDelete({ id: "abc" }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Invalid id");
  });

  it("should return 404 when entry not found", async () => {
    vi.mocked(resolveAdmin).mockResolvedValueOnce({
      userId: "u1",
      email: "a@test.com",
    });
    mockDbWrite.execute.mockResolvedValueOnce({ changes: 0 });

    const res = await DELETE(makeDelete({ id: "999" }));

    expect(res.status).toBe(404);
  });

  it("should delete entry successfully", async () => {
    vi.mocked(resolveAdmin).mockResolvedValueOnce({
      userId: "u1",
      email: "a@test.com",
    });
    mockDbWrite.execute.mockResolvedValueOnce({ changes: 1 });

    const res = await DELETE(makeDelete({ id: "1" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.deleted).toBe(true);
  });

  it("should return 500 on unexpected error", async () => {
    vi.mocked(resolveAdmin).mockResolvedValueOnce({
      userId: "u1",
      email: "a@test.com",
    });
    mockDbWrite.execute.mockRejectedValueOnce(new Error("D1 down"));

    const res = await DELETE(makeDelete({ id: "1" }));

    expect(res.status).toBe(500);
  });
});
