import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { GET } from "@/app/api/admin/usage/compare/route";
import { createMockDbRead, makeGetRequest } from "./test-utils";
import * as dbModule from "@/lib/db";

const { resolveAdmin } = (await import("@/lib/admin")) as unknown as {
  resolveAdmin: ReturnType<typeof vi.fn>;
};

const BASE_PATH = "/api/admin/usage/compare";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/admin/usage/compare", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead);
    resolveAdmin.mockResolvedValue({ userId: "admin1", email: "a@b.com" });
  });

  // ---- Auth ----

  it("returns 403 when not admin", async () => {
    resolveAdmin.mockResolvedValueOnce(null);
    const res = await GET(makeGetRequest(BASE_PATH, { userIds: "u1,u2" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
  });

  // ---- Validation ----

  it("returns 400 when userIds is missing", async () => {
    const res = await GET(makeGetRequest(BASE_PATH));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/userIds/);
  });

  it("returns 400 when userIds is empty string", async () => {
    const res = await GET(makeGetRequest(BASE_PATH, { userIds: "  " }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when fewer than 2 unique IDs", async () => {
    const res = await GET(makeGetRequest(BASE_PATH, { userIds: "u1" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/2 unique/);
  });

  it("returns 400 when duplicate IDs reduce count below 2", async () => {
    const res = await GET(makeGetRequest(BASE_PATH, { userIds: "u1,u1" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when more than 10 users", async () => {
    const ids = Array.from({ length: 11 }, (_, i) => `u${i}`).join(",");
    const res = await GET(makeGetRequest(BASE_PATH, { userIds: ids }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/10/);
  });

  it("returns 400 for invalid date format", async () => {
    const res = await GET(
      makeGetRequest(BASE_PATH, { userIds: "u1,u2", from: "not-a-date" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/date/i);
  });

  it("returns 400 for invalid tzOffset", async () => {
    const res = await GET(
      makeGetRequest(BASE_PATH, { userIds: "u1,u2", tzOffset: "9999" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/tzOffset/);
  });

  it("returns 400 for NaN tzOffset", async () => {
    const res = await GET(
      makeGetRequest(BASE_PATH, { userIds: "u1,u2", tzOffset: "abc" }),
    );
    expect(res.status).toBe(400);
  });

  // ---- Success paths ----

  it("returns compare data for valid users", async () => {
    mockDbRead.query
      .mockResolvedValueOnce({
        results: [
          { id: "u1", name: "Alice", email: "a@a.com", image: null, slug: "alice" },
          { id: "u2", name: "Bob", email: "b@b.com", image: null, slug: "bob" },
        ],
      })
      .mockResolvedValueOnce({
        results: [
          { date: "2026-04-01", user_id: "u1", total_tokens: 100, source: "claude-code", model: "opus" },
          { date: "2026-04-01", user_id: "u2", total_tokens: 200, source: "claude-code", model: "opus" },
        ],
      });

    const res = await GET(makeGetRequest(BASE_PATH, { userIds: "u1,u2" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users).toHaveLength(2);
    expect(body.users[0].id).toBe("u1");
    expect(body.daily).toHaveLength(1);
    expect(body.daily[0].users.u1).toBe(100);
    expect(body.sources).toEqual(["claude-code"]);
    expect(body.models).toEqual(["opus"]);
  });

  it("deduplicates user IDs while preserving order", async () => {
    mockDbRead.query
      .mockResolvedValueOnce({
        results: [
          { id: "u1", name: "A", email: "a@a.com", image: null, slug: null },
          { id: "u2", name: "B", email: "b@b.com", image: null, slug: null },
        ],
      })
      .mockResolvedValueOnce({ results: [] });

    const res = await GET(
      makeGetRequest(BASE_PATH, { userIds: "u1,u2,u1" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users).toHaveLength(2);
  });

  it("returns 400 when fewer than 2 valid users exist in DB", async () => {
    mockDbRead.query.mockResolvedValueOnce({
      results: [
        { id: "u1", name: "A", email: "a@a.com", image: null, slug: null },
      ],
    });

    const res = await GET(makeGetRequest(BASE_PATH, { userIds: "u1,u2" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/2 valid/);
  });

  it("applies source and model filters", async () => {
    mockDbRead.query
      .mockResolvedValueOnce({
        results: [
          { id: "u1", name: "A", email: "a@a.com", image: null, slug: null },
          { id: "u2", name: "B", email: "b@b.com", image: null, slug: null },
        ],
      })
      .mockResolvedValueOnce({ results: [] });

    const res = await GET(
      makeGetRequest(BASE_PATH, {
        userIds: "u1,u2",
        source: "claude-code",
        model: "opus",
      }),
    );
    expect(res.status).toBe(200);
    // Verify source/model were passed as query params
    const usageCall = mockDbRead.query.mock.calls[1];
    expect(usageCall[1]).toContain("claude-code");
    expect(usageCall[1]).toContain("opus");
  });

  it("applies tzOffset to date expression", async () => {
    mockDbRead.query
      .mockResolvedValueOnce({
        results: [
          { id: "u1", name: "A", email: "a@a.com", image: null, slug: null },
          { id: "u2", name: "B", email: "b@b.com", image: null, slug: null },
        ],
      })
      .mockResolvedValueOnce({ results: [] });

    const res = await GET(
      makeGetRequest(BASE_PATH, { userIds: "u1,u2", tzOffset: "480" }),
    );
    expect(res.status).toBe(200);
    // Check that the usage query includes the offset param
    const usageCall = mockDbRead.query.mock.calls[1];
    expect(usageCall[1]).toContain("-480");
  });

  it("aggregates multiple rows for same user/date", async () => {
    mockDbRead.query
      .mockResolvedValueOnce({
        results: [
          { id: "u1", name: "A", email: "a@a.com", image: null, slug: null },
          { id: "u2", name: "B", email: "b@b.com", image: null, slug: null },
        ],
      })
      .mockResolvedValueOnce({
        results: [
          { date: "2026-04-01", user_id: "u1", total_tokens: 50, source: "a", model: "m1" },
          { date: "2026-04-01", user_id: "u1", total_tokens: 30, source: "b", model: "m2" },
        ],
      });

    const res = await GET(makeGetRequest(BASE_PATH, { userIds: "u1,u2" }));
    const body = await res.json();
    expect(body.daily[0].users.u1).toBe(80);
    expect(body.sources).toEqual(["a", "b"]);
    expect(body.models).toEqual(["m1", "m2"]);
  });

  // ---- DB errors ----

  it("returns 500 on DB error", async () => {
    mockDbRead.query.mockRejectedValueOnce(new Error("DB down"));

    const res = await GET(makeGetRequest(BASE_PATH, { userIds: "u1,u2" }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/Failed/);
  });
});
