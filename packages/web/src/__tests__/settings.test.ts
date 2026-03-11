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

function makeRequest(
  method: string,
  body?: unknown,
): Request {
  const opts: RequestInit = { method };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
    opts.headers = { "Content-Type": "application/json" };
  }
  return new Request("http://localhost:7030/api/settings", opts);
}

// ---------------------------------------------------------------------------
// GET /api/settings
// ---------------------------------------------------------------------------

describe("GET /api/settings", () => {
  let GET: (req: Request) => Promise<Response>;
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    vi.mocked(d1Module.getD1Client).mockReturnValue(
      mockClient as unknown as d1Module.D1Client,
    );
    const mod = await import("@/app/api/settings/route");
    GET = mod.GET;
  });

  it("should reject unauthenticated requests with 401", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce(null);

    const res = await GET(makeRequest("GET"));

    expect(res.status).toBe(401);
  });

  it("should return user settings", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockClient.firstOrNull.mockResolvedValueOnce({
      nickname: "Alice",
      slug: "alice",
      is_public: 0,
    });

    const res = await GET(makeRequest("GET"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ nickname: "Alice", slug: "alice", is_public: false });
  });

  it("should return 404 when user not found", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockClient.firstOrNull.mockResolvedValueOnce(null);

    const res = await GET(makeRequest("GET"));

    expect(res.status).toBe(404);
  });

  it("should fall back when nickname column does not exist", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    // Full query fails (nickname missing), level 1 also fails (nickname missing), level 2 succeeds
    mockClient.firstOrNull
      .mockRejectedValueOnce(new Error("no such column: nickname"))
      .mockRejectedValueOnce(new Error("no such column: nickname"))
      .mockResolvedValueOnce({ slug: "alice" });

    const res = await GET(makeRequest("GET"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ nickname: null, slug: "alice", is_public: false });
  });

  it("should return 404 in fallback when user not found", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    // Full query fails, level 1 also fails (nickname missing), level 2 returns null
    mockClient.firstOrNull
      .mockRejectedValueOnce(new Error("no such column: nickname"))
      .mockRejectedValueOnce(new Error("no such column: nickname"))
      .mockResolvedValueOnce(null);

    const res = await GET(makeRequest("GET"));

    expect(res.status).toBe(404);
  });

  it("should return is_public: true when DB value is 1", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockClient.firstOrNull.mockResolvedValueOnce({
      nickname: "Alice",
      slug: "alice",
      is_public: 1,
    });

    const res = await GET(makeRequest("GET"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.is_public).toBe(true);
  });

  it("should return is_public: false in fallback when column missing", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockClient.firstOrNull
      .mockRejectedValueOnce(new Error("no such column: is_public"))
      .mockResolvedValueOnce({ slug: "alice" });

    const res = await GET(makeRequest("GET"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.is_public).toBe(false);
  });

  it("should preserve nickname in fallback when only is_public column is missing", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    // First query fails (is_public missing), level 1 fallback succeeds (nickname exists)
    mockClient.firstOrNull
      .mockRejectedValueOnce(new Error("no such column: is_public"))
      .mockResolvedValueOnce({ nickname: "Alice", slug: "alice" });

    const res = await GET(makeRequest("GET"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ nickname: "Alice", slug: "alice", is_public: false });
  });

  it("should fall back to slug-only when both nickname and is_public columns are missing", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    // First query fails (is_public), level 1 fails (nickname), level 2 succeeds
    mockClient.firstOrNull
      .mockRejectedValueOnce(new Error("no such column: is_public"))
      .mockRejectedValueOnce(new Error("no such column: nickname"))
      .mockResolvedValueOnce({ slug: "alice" });

    const res = await GET(makeRequest("GET"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ nickname: null, slug: "alice", is_public: false });
  });

  it("should return 500 on unexpected error", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockClient.firstOrNull.mockRejectedValueOnce(new Error("D1 down"));

    const res = await GET(makeRequest("GET"));

    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/settings
// ---------------------------------------------------------------------------

describe("PATCH /api/settings", () => {
  let PATCH: (req: Request) => Promise<Response>;
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    vi.mocked(d1Module.getD1Client).mockReturnValue(
      mockClient as unknown as d1Module.D1Client,
    );
    const mod = await import("@/app/api/settings/route");
    PATCH = mod.PATCH;
  });

  it("should reject unauthenticated requests with 401", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce(null);

    const res = await PATCH(makeRequest("PATCH", { nickname: "a" }));

    expect(res.status).toBe(401);
  });

  it("should reject invalid JSON", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });

    const res = await PATCH(
      new Request("http://localhost:7030/api/settings", {
        method: "PATCH",
        body: "not json",
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid JSON");
  });

  it("should reject non-string nickname", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });

    const res = await PATCH(makeRequest("PATCH", { nickname: 123 }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("nickname must be a string");
  });

  it("should reject nickname that is too long", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });

    const res = await PATCH(makeRequest("PATCH", { nickname: "a".repeat(33) }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("1-32 characters");
  });

  it("should reject empty nickname string", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });

    const res = await PATCH(makeRequest("PATCH", { nickname: "" }));

    expect(res.status).toBe(400);
  });

  it("should allow null nickname (clear)", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockClient.execute.mockResolvedValueOnce({ changes: 1 });
    mockClient.firstOrNull.mockResolvedValueOnce({ nickname: null, slug: "alice", is_public: 0 });

    const res = await PATCH(makeRequest("PATCH", { nickname: null }));

    expect(res.status).toBe(200);
    expect(mockClient.execute).toHaveBeenCalledOnce();
    const [sql, params] = mockClient.execute.mock.calls[0]!;
    expect(sql).toContain("nickname = ?");
    expect(params).toContain(null);
  });

  // -- slug validation --

  it("should reject non-string slug", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });

    const res = await PATCH(makeRequest("PATCH", { slug: 42 }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("slug must be a string");
  });

  it("should reject slug shorter than 2 chars", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });

    const res = await PATCH(makeRequest("PATCH", { slug: "a" }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("2-32 characters");
  });

  it("should reject slug longer than 32 chars", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });

    const res = await PATCH(makeRequest("PATCH", { slug: "a".repeat(33) }));

    expect(res.status).toBe(400);
  });

  it("should reject slug with uppercase or invalid chars", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    const res = await PATCH(makeRequest("PATCH", { slug: "Hello_World" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("lowercase alphanumeric");
  });

  it("should reject slug starting with hyphen", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    const res = await PATCH(makeRequest("PATCH", { slug: "-ab" }));
    expect(res.status).toBe(400);
  });

  it("should reject slug ending with hyphen", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    const res = await PATCH(makeRequest("PATCH", { slug: "ab-" }));
    expect(res.status).toBe(400);
  });

  it("should return 409 when slug is already taken", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockClient.firstOrNull.mockResolvedValueOnce({ id: "other-user" });

    const res = await PATCH(makeRequest("PATCH", { slug: "taken" }));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("already taken");
  });

  it("should allow null slug (clear)", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockClient.execute.mockResolvedValueOnce({ changes: 1 });
    mockClient.firstOrNull.mockResolvedValueOnce({ nickname: "Alice", slug: null, is_public: 0 });

    const res = await PATCH(makeRequest("PATCH", { slug: null }));

    expect(res.status).toBe(200);
  });

  it("should reject body with no valid fields", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });

    const res = await PATCH(makeRequest("PATCH", { foo: "bar" }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("No valid fields");
  });

  it("should update nickname and slug together", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    // slug uniqueness check
    mockClient.firstOrNull
      .mockResolvedValueOnce(null) // slug not taken
      .mockResolvedValueOnce({ nickname: "Bob", slug: "bob", is_public: 0 }); // read-back
    mockClient.execute.mockResolvedValueOnce({ changes: 1 });

    const res = await PATCH(makeRequest("PATCH", { nickname: "Bob", slug: "bob" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ nickname: "Bob", slug: "bob", is_public: false });
    // SQL should have both sets
    const [sql] = mockClient.execute.mock.calls[0]!;
    expect(sql).toContain("nickname = ?");
    expect(sql).toContain("slug = ?");
    expect(sql).toContain("updated_at = datetime('now')");
  });

  // -- is_public validation --

  it("should accept is_public: true", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockClient.execute.mockResolvedValueOnce({ changes: 1 });
    mockClient.firstOrNull.mockResolvedValueOnce({ nickname: null, slug: null, is_public: 1 });

    const res = await PATCH(makeRequest("PATCH", { is_public: true }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.is_public).toBe(true);
    const [sql, params] = mockClient.execute.mock.calls[0]!;
    expect(sql).toContain("is_public = ?");
    expect(params).toContain(1);
  });

  it("should accept is_public: false", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockClient.execute.mockResolvedValueOnce({ changes: 1 });
    mockClient.firstOrNull.mockResolvedValueOnce({ nickname: null, slug: null, is_public: 0 });

    const res = await PATCH(makeRequest("PATCH", { is_public: false }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.is_public).toBe(false);
    const [, params] = mockClient.execute.mock.calls[0]!;
    expect(params).toContain(0);
  });

  it("should reject non-boolean is_public (string)", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });

    const res = await PATCH(makeRequest("PATCH", { is_public: "true" }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("is_public must be a boolean");
  });

  it("should reject non-boolean is_public (number)", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });

    const res = await PATCH(makeRequest("PATCH", { is_public: 1 }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("is_public must be a boolean");
  });

  it("should allow updating is_public together with slug and nickname", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockClient.firstOrNull
      .mockResolvedValueOnce(null) // slug not taken
      .mockResolvedValueOnce({ nickname: "Bob", slug: "bob", is_public: 1 }); // read-back
    mockClient.execute.mockResolvedValueOnce({ changes: 1 });

    const res = await PATCH(
      makeRequest("PATCH", { nickname: "Bob", slug: "bob", is_public: true }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ nickname: "Bob", slug: "bob", is_public: true });
    const [sql] = mockClient.execute.mock.calls[0]!;
    expect(sql).toContain("nickname = ?");
    expect(sql).toContain("slug = ?");
    expect(sql).toContain("is_public = ?");
  });

  it("should return 503 when nickname column does not exist", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockClient.execute.mockRejectedValueOnce(new Error("no such column: nickname"));

    const res = await PATCH(makeRequest("PATCH", { nickname: "Bob" }));

    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("migration pending");
  });

  it("should return 500 on unexpected error", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockClient.execute.mockRejectedValueOnce(new Error("D1 boom"));

    const res = await PATCH(makeRequest("PATCH", { nickname: "Bob" }));

    expect(res.status).toBe(500);
  });
});
