import { describe, it, expect, vi, beforeEach } from "vitest";
import * as dbModule from "@/lib/db";
import { createMockDbRead, loadMockedAuthHelpers, makeGetRequest } from "./test-utils";

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

describe("GET /api/sessions", () => {
  let GET: (req: Request) => Promise<Response>;
  let mockDbRead: ReturnType<typeof createMockDbRead>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as any);
    const mod = await import("@/app/api/sessions/route");
    GET = mod.GET;
  });

  // -----------------------------------------------------------------------
  // Authentication
  // -----------------------------------------------------------------------

  describe("authentication", () => {
    it("should reject unauthenticated requests with 401", async () => {
      vi.mocked(resolveUser).mockResolvedValueOnce(null);

      const res = await GET(makeGetRequest("/api/sessions"));

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Unauthorized");
    });
  });

  // -----------------------------------------------------------------------
  // Query params
  // -----------------------------------------------------------------------

  describe("query params", () => {
    beforeEach(() => {
      vi.mocked(resolveUser).mockResolvedValue({
        userId: "u1",
        email: "test@example.com",
      });
    });

    it("should query with default date range (last 30 days)", async () => {
      mockDbRead.getSessionRecords.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/sessions"));

      expect(res.status).toBe(200);
      expect(mockDbRead.getSessionRecords).toHaveBeenCalledOnce();
      const [userId] = mockDbRead.getSessionRecords.mock.calls[0]!;
      expect(userId).toBe("u1");
    });

    it("should accept custom from/to date range", async () => {
      mockDbRead.getSessionRecords.mockResolvedValueOnce([]);

      const res = await GET(
        makeGetRequest("/api/sessions", { from: "2026-03-01", to: "2026-03-07" }),
      );

      expect(res.status).toBe(200);
      const [, fromDate, toDate] = mockDbRead.getSessionRecords.mock.calls[0]!;
      expect(fromDate).toBe("2026-03-01T00:00:00.000Z");
      // Bare-date `to` is treated as inclusive: bumped +1 day for `< toDate`
      expect(toDate).toBe("2026-03-08T00:00:00.000Z");
    });

    it("should filter by source", async () => {
      mockDbRead.getSessionRecords.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/sessions", { source: "claude-code" }));

      expect(res.status).toBe(200);
      const [, , , options] = mockDbRead.getSessionRecords.mock.calls[0]!;
      expect(options.source).toBe("claude-code");
    });

    it("should reject invalid source filter", async () => {
      const res = await GET(makeGetRequest("/api/sessions", { source: "invalid-tool" }));

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("source");
    });

    it("should filter by kind", async () => {
      mockDbRead.getSessionRecords.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/sessions", { kind: "human" }));

      expect(res.status).toBe(200);
      const [, , , options] = mockDbRead.getSessionRecords.mock.calls[0]!;
      expect(options.kind).toBe("human");
    });

    it("should reject invalid kind filter", async () => {
      const res = await GET(makeGetRequest("/api/sessions", { kind: "invalid" }));

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("kind");
    });

    it("should reject invalid date format for from", async () => {
      const res = await GET(makeGetRequest("/api/sessions", { from: "not-a-date" }));

      expect(res.status).toBe(400);
    });

    it("should reject invalid date format for to", async () => {
      const res = await GET(makeGetRequest("/api/sessions", { to: "xyz" }));

      expect(res.status).toBe(400);
    });
  });

  // -----------------------------------------------------------------------
  // Response format
  // -----------------------------------------------------------------------

  describe("response format", () => {
    beforeEach(() => {
      vi.mocked(resolveUser).mockResolvedValue({
        userId: "u1",
        email: "test@example.com",
      });
    });

    it("should return session records", async () => {
      mockDbRead.getSessionRecords.mockResolvedValueOnce([
        {
          session_key: "claude-code:abc",
          source: "claude-code",
          kind: "human",
          started_at: "2026-03-08T10:00:00Z",
          last_message_at: "2026-03-08T10:30:00Z",
          duration_seconds: 1800,
          user_messages: 12,
          assistant_messages: 10,
          total_messages: 25,
          project_ref: "a1b2",
          project_name: "pew",
          model: "claude-sonnet-4-20250514",
        },
        {
          session_key: "opencode:def",
          source: "opencode",
          kind: "human",
          started_at: "2026-03-08T11:00:00Z",
          last_message_at: "2026-03-08T11:45:00Z",
          duration_seconds: 2700,
          user_messages: 8,
          assistant_messages: 7,
          total_messages: 18,
          project_ref: null,
          project_name: null,
          model: "o3",
        },
      ]);

      const res = await GET(makeGetRequest("/api/sessions"));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.records).toHaveLength(2);
      expect(body.records[0].source).toBe("claude-code");
      expect(body.records[1].source).toBe("opencode");
    });

    it("should include summary stats", async () => {
      mockDbRead.getSessionRecords.mockResolvedValueOnce([
        {
          session_key: "claude-code:abc",
          source: "claude-code",
          kind: "human",
          started_at: "2026-03-08T10:00:00Z",
          last_message_at: "2026-03-08T10:30:00Z",
          duration_seconds: 1800,
          user_messages: 12,
          assistant_messages: 10,
          total_messages: 25,
          project_ref: "a1b2",
          project_name: "pew",
          model: "claude-sonnet-4-20250514",
        },
        {
          session_key: "opencode:def",
          source: "opencode",
          kind: "human",
          started_at: "2026-03-08T11:00:00Z",
          last_message_at: "2026-03-08T11:45:00Z",
          duration_seconds: 2700,
          user_messages: 8,
          assistant_messages: 7,
          total_messages: 18,
          project_ref: null,
          project_name: null,
          model: "o3",
        },
      ]);

      const res = await GET(makeGetRequest("/api/sessions"));
      const body = await res.json();

      expect(body.summary).toBeDefined();
      expect(body.summary.total_sessions).toBe(2);
      expect(body.summary.total_duration_seconds).toBe(4500);
      expect(body.summary.total_user_messages).toBe(20);
      expect(body.summary.total_assistant_messages).toBe(17);
      expect(body.summary.total_messages).toBe(43);
    });

    it("should return empty records when no data", async () => {
      mockDbRead.getSessionRecords.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/sessions"));
      const body = await res.json();

      expect(body.records).toEqual([]);
      expect(body.summary.total_sessions).toBe(0);
      expect(body.summary.total_duration_seconds).toBe(0);
    });

    it("should return 500 on D1 error", async () => {
      mockDbRead.getSessionRecords.mockRejectedValueOnce(new Error("D1 down"));

      const res = await GET(makeGetRequest("/api/sessions"));

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain("session");
    });
  });
});
