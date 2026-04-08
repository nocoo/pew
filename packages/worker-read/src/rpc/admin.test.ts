import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleAdminRpc,
  type ListAuditLogsRequest,
  type GetAuditLogRequest,
  type GetSystemStatsRequest,
  type ListAdminUsersRequest,
  type GetAdminUserRequest,
  type CountUsersRequest,
} from "./admin";
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

describe("admin RPC handlers", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  // -------------------------------------------------------------------------
  // admin.listAuditLogs
  // -------------------------------------------------------------------------

  describe("admin.listAuditLogs", () => {
    it("should return list of audit logs", async () => {
      const mockLogs = [
        {
          id: "al1",
          user_id: "u1",
          action: "login",
          resource_type: "user",
          resource_id: "u1",
          details: null,
          ip_address: "192.168.1.1",
          user_agent: "Mozilla/5.0",
          created_at: "2026-01-01T00:00:00Z",
        },
      ];
      db.all.mockResolvedValue({ results: mockLogs });

      const request: ListAuditLogsRequest = {
        method: "admin.listAuditLogs",
      };
      const response = await handleAdminRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: mockLogs });
    });

    it("should filter by userId", async () => {
      db.all.mockResolvedValue({ results: [] });

      const request: ListAuditLogsRequest = {
        method: "admin.listAuditLogs",
        userId: "u1",
      };
      await handleAdminRpc(request, db);

      expect(db.prepare).toHaveBeenCalled();
    });

    it("should filter by action", async () => {
      db.all.mockResolvedValue({ results: [] });

      const request: ListAuditLogsRequest = {
        method: "admin.listAuditLogs",
        action: "login",
      };
      await handleAdminRpc(request, db);

      expect(db.prepare).toHaveBeenCalled();
    });

    it("should filter by resourceType", async () => {
      db.all.mockResolvedValue({ results: [] });

      const request: ListAuditLogsRequest = {
        method: "admin.listAuditLogs",
        resourceType: "user",
      };
      await handleAdminRpc(request, db);

      expect(db.prepare).toHaveBeenCalled();
    });

    it("should filter by date range", async () => {
      db.all.mockResolvedValue({ results: [] });

      const request: ListAuditLogsRequest = {
        method: "admin.listAuditLogs",
        fromDate: "2026-01-01T00:00:00Z",
        toDate: "2026-01-31T00:00:00Z",
      };
      await handleAdminRpc(request, db);

      expect(db.prepare).toHaveBeenCalled();
    });

    it("should support pagination", async () => {
      db.all.mockResolvedValue({ results: [] });

      const request: ListAuditLogsRequest = {
        method: "admin.listAuditLogs",
        limit: 10,
        offset: 20,
      };
      await handleAdminRpc(request, db);

      expect(db.prepare).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // admin.getAuditLog
  // -------------------------------------------------------------------------

  describe("admin.getAuditLog", () => {
    it("should return audit log by ID", async () => {
      const mockLog = {
        id: "al1",
        user_id: "u1",
        action: "login",
        resource_type: "user",
        resource_id: "u1",
        details: '{"ip": "192.168.1.1"}',
        ip_address: "192.168.1.1",
        user_agent: "Mozilla/5.0",
        created_at: "2026-01-01T00:00:00Z",
      };
      db.first.mockResolvedValue(mockLog);

      const request: GetAuditLogRequest = {
        method: "admin.getAuditLog",
        logId: "al1",
      };
      const response = await handleAdminRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: mockLog });
    });

    it("should return null when not found", async () => {
      db.first.mockResolvedValue(null);

      const request: GetAuditLogRequest = {
        method: "admin.getAuditLog",
        logId: "nonexistent",
      };
      const response = await handleAdminRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: null });
    });

    it("should return 400 when logId missing", async () => {
      const request = {
        method: "admin.getAuditLog",
        logId: "",
      } as GetAuditLogRequest;
      const response = await handleAdminRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // admin.getSystemStats
  // -------------------------------------------------------------------------

  describe("admin.getSystemStats", () => {
    it("should return system stats", async () => {
      const mockStats = {
        total_users: 1000,
        total_sessions: 50000,
        total_tokens: 100000000,
        active_users_24h: 150,
      };
      db.first.mockResolvedValue(mockStats);

      const request: GetSystemStatsRequest = {
        method: "admin.getSystemStats",
      };
      const response = await handleAdminRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: mockStats });
    });
  });

  // -------------------------------------------------------------------------
  // admin.listUsers
  // -------------------------------------------------------------------------

  describe("admin.listUsers", () => {
    it("should return list of users", async () => {
      const mockUsers = [
        {
          id: "u1",
          username: "alice",
          email: "alice@example.com",
          role: "user",
          is_active: true,
          created_at: "2026-01-01T00:00:00Z",
          last_login_at: "2026-01-15T00:00:00Z",
        },
      ];
      db.all.mockResolvedValue({ results: mockUsers });

      const request: ListAdminUsersRequest = {
        method: "admin.listUsers",
      };
      const response = await handleAdminRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: mockUsers });
    });

    it("should filter by role", async () => {
      db.all.mockResolvedValue({ results: [] });

      const request: ListAdminUsersRequest = {
        method: "admin.listUsers",
        role: "admin",
      };
      await handleAdminRpc(request, db);

      expect(db.prepare).toHaveBeenCalled();
    });

    it("should filter by isActive", async () => {
      db.all.mockResolvedValue({ results: [] });

      const request: ListAdminUsersRequest = {
        method: "admin.listUsers",
        isActive: true,
      };
      await handleAdminRpc(request, db);

      expect(db.prepare).toHaveBeenCalled();
    });

    it("should filter by query", async () => {
      db.all.mockResolvedValue({ results: [] });

      const request: ListAdminUsersRequest = {
        method: "admin.listUsers",
        query: "alice",
      };
      await handleAdminRpc(request, db);

      expect(db.prepare).toHaveBeenCalled();
    });

    it("should support pagination", async () => {
      db.all.mockResolvedValue({ results: [] });

      const request: ListAdminUsersRequest = {
        method: "admin.listUsers",
        limit: 10,
        offset: 20,
      };
      await handleAdminRpc(request, db);

      expect(db.prepare).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // admin.getUser
  // -------------------------------------------------------------------------

  describe("admin.getUser", () => {
    it("should return user by ID", async () => {
      const mockUser = {
        id: "u1",
        username: "alice",
        email: "alice@example.com",
        role: "user",
        is_active: true,
        created_at: "2026-01-01T00:00:00Z",
        last_login_at: "2026-01-15T00:00:00Z",
      };
      db.first.mockResolvedValue(mockUser);

      const request: GetAdminUserRequest = {
        method: "admin.getUser",
        userId: "u1",
      };
      const response = await handleAdminRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: mockUser });
    });

    it("should return 400 when userId missing", async () => {
      const request = {
        method: "admin.getUser",
        userId: "",
      } as GetAdminUserRequest;
      const response = await handleAdminRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // admin.countUsers
  // -------------------------------------------------------------------------

  describe("admin.countUsers", () => {
    it("should return user count", async () => {
      db.first.mockResolvedValue({ count: 1000 });

      const request: CountUsersRequest = {
        method: "admin.countUsers",
      };
      const response = await handleAdminRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: 1000 });
    });

    it("should filter by role", async () => {
      db.first.mockResolvedValue({ count: 10 });

      const request: CountUsersRequest = {
        method: "admin.countUsers",
        role: "admin",
      };
      await handleAdminRpc(request, db);

      expect(db.prepare).toHaveBeenCalled();
    });

    it("should filter by isActive", async () => {
      db.first.mockResolvedValue({ count: 950 });

      const request: CountUsersRequest = {
        method: "admin.countUsers",
        isActive: true,
      };
      await handleAdminRpc(request, db);

      expect(db.prepare).toHaveBeenCalled();
    });

    it("should return 0 when no result", async () => {
      db.first.mockResolvedValue(null);

      const request: CountUsersRequest = {
        method: "admin.countUsers",
      };
      const response = await handleAdminRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: 0 });
    });
  });

  // -------------------------------------------------------------------------
  // Unknown method
  // -------------------------------------------------------------------------

  describe("unknown method", () => {
    it("should return 400 for unknown method", async () => {
      const request = { method: "admin.unknown" } as unknown as ListAuditLogsRequest;
      const response = await handleAdminRpc(request, db);

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toContain("Unknown admin method");
    });
  });
});
