import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleLiveRpc,
  type GetActiveSessionsRequest,
  type GetRecentActivityRequest,
  type GetLiveStatsRequest,
  type GetUserLiveStatsRequest,
} from "./live";
import type { D1Database } from "@cloudflare/workers-types";

// ---------------------------------------------------------------------------
// Mock D1Database
// ---------------------------------------------------------------------------

function createMockDb() {
  return {
    prepare: vi.fn().mockReturnThis(),
    bind: vi.fn().mockReturnThis(),
    first: vi.fn(),
    all: vi.fn(),
  } as unknown as D1Database & {
    prepare: ReturnType<typeof vi.fn>;
    bind: ReturnType<typeof vi.fn>;
    first: ReturnType<typeof vi.fn>;
    all: ReturnType<typeof vi.fn>;
  };
}

describe("live RPC handlers", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  // -------------------------------------------------------------------------
  // live.getActiveSessions
  // -------------------------------------------------------------------------

  describe("live.getActiveSessions", () => {
    it("should return active sessions", async () => {
      const mockSessions = [
        {
          id: "s1",
          user_id: "u1",
          username: "alice",
          source: "claude-code",
          started_at: "2026-01-01T00:00:00Z",
          total_messages: 10,
          last_activity_at: "2026-01-01T00:30:00Z",
        },
      ];
      db.all.mockResolvedValue({ results: mockSessions });

      const request: GetActiveSessionsRequest = {
        method: "live.getActiveSessions",
      };
      const response = await handleLiveRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: mockSessions });
    });

    it("should respect limit", async () => {
      db.all.mockResolvedValue({ results: [] });

      const request: GetActiveSessionsRequest = {
        method: "live.getActiveSessions",
        limit: 10,
      };
      await handleLiveRpc(request, db);

      expect(db.prepare).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // live.getRecentActivity
  // -------------------------------------------------------------------------

  describe("live.getRecentActivity", () => {
    it("should return recent activity", async () => {
      const mockActivity = [
        {
          id: "ur1",
          user_id: "u1",
          username: "alice",
          source: "claude-code",
          model: "claude-3-opus",
          input_tokens: 1000,
          output_tokens: 500,
          created_at: "2026-01-01T00:00:00Z",
        },
      ];
      db.all.mockResolvedValue({ results: mockActivity });

      const request: GetRecentActivityRequest = {
        method: "live.getRecentActivity",
      };
      const response = await handleLiveRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: mockActivity });
    });

    it("should filter by userId", async () => {
      db.all.mockResolvedValue({ results: [] });

      const request: GetRecentActivityRequest = {
        method: "live.getRecentActivity",
        userId: "u1",
      };
      await handleLiveRpc(request, db);

      expect(db.prepare).toHaveBeenCalled();
    });

    it("should filter by source", async () => {
      db.all.mockResolvedValue({ results: [] });

      const request: GetRecentActivityRequest = {
        method: "live.getRecentActivity",
        source: "claude-code",
      };
      await handleLiveRpc(request, db);

      expect(db.prepare).toHaveBeenCalled();
    });

    it("should respect limit", async () => {
      db.all.mockResolvedValue({ results: [] });

      const request: GetRecentActivityRequest = {
        method: "live.getRecentActivity",
        limit: 10,
      };
      await handleLiveRpc(request, db);

      expect(db.prepare).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // live.getStats
  // -------------------------------------------------------------------------

  describe("live.getStats", () => {
    it("should return live stats", async () => {
      const mockStats = {
        active_sessions: 25,
        tokens_last_hour: 5000000,
        requests_last_hour: 150,
        unique_users_last_hour: 20,
      };
      db.first.mockResolvedValue(mockStats);

      const request: GetLiveStatsRequest = {
        method: "live.getStats",
      };
      const response = await handleLiveRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: mockStats });
    });
  });

  // -------------------------------------------------------------------------
  // live.getUserStats
  // -------------------------------------------------------------------------

  describe("live.getUserStats", () => {
    it("should return user live stats", async () => {
      const mockStats = {
        active_sessions: 2,
        tokens_last_hour: 50000,
        requests_last_hour: 10,
      };
      db.first.mockResolvedValue(mockStats);

      const request: GetUserLiveStatsRequest = {
        method: "live.getUserStats",
        userId: "u1",
      };
      const response = await handleLiveRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: mockStats });
    });

    it("should return 400 when userId missing", async () => {
      const request = {
        method: "live.getUserStats",
        userId: "",
      } as GetUserLiveStatsRequest;
      const response = await handleLiveRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // Unknown method
  // -------------------------------------------------------------------------

  describe("unknown method", () => {
    it("should return 400 for unknown method", async () => {
      const request = { method: "live.unknown" } as unknown as GetActiveSessionsRequest;
      const response = await handleLiveRpc(request, db);

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toContain("Unknown live method");
    });
  });
});
