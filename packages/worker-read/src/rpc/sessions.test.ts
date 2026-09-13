import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleSessionsRpc,
  type ListSessionsRequest,
  type GetSessionStatsRequest,
  type CountSessionsRequest,
  type GetSessionRecordsRequest,
} from "./sessions";
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

describe("sessions RPC handlers", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  // -------------------------------------------------------------------------
  // sessions.list
  // -------------------------------------------------------------------------

  describe("sessions.list", () => {
    it("should return list of sessions", async () => {
      const mockSessions = [
        {
          id: "s1",
          user_id: "u1",
          source: "claude-code",
          session_key: "sk1",
          started_at: "2026-01-01T00:00:00Z",
          last_message_at: "2026-01-01T01:00:00Z",
          duration_seconds: 3600,
          total_messages: 10,
          kind: null,
        },
        {
          id: "s2",
          user_id: "u1",
          source: "copilot",
          session_key: "sk2",
          started_at: "2026-01-02T00:00:00Z",
          last_message_at: "2026-01-02T00:30:00Z",
          duration_seconds: 1800,
          total_messages: 5,
          kind: "chat",
        },
      ];
      db.all.mockResolvedValue({ results: mockSessions });

      const request: ListSessionsRequest = {
        method: "sessions.list",
        userId: "u1",
      };
      const response = await handleSessionsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: mockSessions });
    });

    it("should filter by source", async () => {
      db.all.mockResolvedValue({ results: [] });

      const request: ListSessionsRequest = {
        method: "sessions.list",
        userId: "u1",
        source: "claude-code",
      };
      await handleSessionsRpc(request, db);

      expect(db.prepare).toHaveBeenCalled();
    });

    it("should filter by date range", async () => {
      db.all.mockResolvedValue({ results: [] });

      const request: ListSessionsRequest = {
        method: "sessions.list",
        userId: "u1",
        fromDate: "2026-01-01T00:00:00Z",
        toDate: "2026-01-31T00:00:00Z",
      };
      await handleSessionsRpc(request, db);

      expect(db.prepare).toHaveBeenCalled();
    });

    it("should support pagination", async () => {
      db.all.mockResolvedValue({ results: [] });

      const request: ListSessionsRequest = {
        method: "sessions.list",
        userId: "u1",
        limit: 10,
        offset: 20,
      };
      await handleSessionsRpc(request, db);

      expect(db.prepare).toHaveBeenCalled();
    });

    it("should return 400 when userId missing", async () => {
      const request = {
        method: "sessions.list",
        userId: "",
      } as ListSessionsRequest;
      const response = await handleSessionsRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // sessions.getStats
  // -------------------------------------------------------------------------

  describe("sessions.getStats", () => {
    it("should return session stats", async () => {
      const mockStats = {
        total_sessions: 100,
        total_duration_seconds: 360000,
        avg_duration_seconds: 3600,
        avg_messages: 15,
      };
      db.first.mockResolvedValue(mockStats);

      const request: GetSessionStatsRequest = {
        method: "sessions.getStats",
        userId: "u1",
      };
      const response = await handleSessionsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: mockStats });
    });

    it("should filter by date range", async () => {
      db.first.mockResolvedValue({
        total_sessions: 10,
        total_duration_seconds: 36000,
        avg_duration_seconds: 3600,
        avg_messages: 12,
      });

      const request: GetSessionStatsRequest = {
        method: "sessions.getStats",
        userId: "u1",
        fromDate: "2026-01-01T00:00:00Z",
        toDate: "2026-01-31T00:00:00Z",
      };
      await handleSessionsRpc(request, db);

      expect(db.prepare).toHaveBeenCalled();
    });

    it("should return 400 when userId missing", async () => {
      const request = {
        method: "sessions.getStats",
        userId: "",
      } as GetSessionStatsRequest;
      const response = await handleSessionsRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // sessions.count
  // -------------------------------------------------------------------------

  describe("sessions.count", () => {
    it("should return session count", async () => {
      db.first.mockResolvedValue({ count: 42 });

      const request: CountSessionsRequest = {
        method: "sessions.count",
        userId: "u1",
      };
      const response = await handleSessionsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: 42 });
    });

    it("should filter by source", async () => {
      db.first.mockResolvedValue({ count: 15 });

      const request: CountSessionsRequest = {
        method: "sessions.count",
        userId: "u1",
        source: "claude-code",
      };
      await handleSessionsRpc(request, db);

      expect(db.prepare).toHaveBeenCalled();
    });

    it("should filter by date range", async () => {
      db.first.mockResolvedValue({ count: 20 });

      const request: CountSessionsRequest = {
        method: "sessions.count",
        userId: "u1",
        fromDate: "2026-01-01T00:00:00Z",
        toDate: "2026-01-31T00:00:00Z",
      };
      await handleSessionsRpc(request, db);

      expect(db.prepare).toHaveBeenCalled();
    });

    it("should return 0 when no sessions found", async () => {
      db.first.mockResolvedValue(null);

      const request: CountSessionsRequest = {
        method: "sessions.count",
        userId: "u1",
      };
      const response = await handleSessionsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: 0 });
    });

    it("should return 400 when userId missing", async () => {
      const request = {
        method: "sessions.count",
        userId: "",
      } as CountSessionsRequest;
      const response = await handleSessionsRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // sessions.getRecords
  // -------------------------------------------------------------------------

  describe("sessions.getRecords", () => {
    it("should return session records", async () => {
      const mockRecords = [
        {
          session_key: "sk1",
          source: "claude-code",
          kind: "human",
          started_at: "2026-01-01T00:00:00Z",
          last_message_at: "2026-01-01T01:00:00Z",
          duration_seconds: 3600,
          user_messages: 10,
          assistant_messages: 8,
          total_messages: 20,
          project_ref: "abc",
          model: "claude-sonnet-4-20250514",
        },
      ];
      db.all.mockResolvedValue({ results: mockRecords });

      const request: GetSessionRecordsRequest = {
        method: "sessions.getRecords",
        userId: "u1",
        fromDate: "2026-01-01T00:00:00Z",
        toDate: "2026-02-01T00:00:00Z",
      };
      const response = await handleSessionsRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: mockRecords });
    });

    it("should filter by source and kind", async () => {
      db.all.mockResolvedValue({ results: [] });

      const request: GetSessionRecordsRequest = {
        method: "sessions.getRecords",
        userId: "u1",
        fromDate: "2026-01-01T00:00:00Z",
        toDate: "2026-02-01T00:00:00Z",
        source: "claude-code",
        kind: "human",
      };
      await handleSessionsRpc(request, db);

      expect(db.prepare).toHaveBeenCalled();
    });

    it("should return 400 when required params missing", async () => {
      const request = {
        method: "sessions.getRecords",
        userId: "u1",
        // missing fromDate and toDate
      } as GetSessionRecordsRequest;
      const response = await handleSessionsRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // Unknown method
  // -------------------------------------------------------------------------

  describe("unknown method", () => {
    it("should return 400 for unknown method", async () => {
      const request = { method: "sessions.unknown" } as unknown as ListSessionsRequest;
      const response = await handleSessionsRpc(request, db);

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toContain("Unknown sessions method");
    });
  });
});
