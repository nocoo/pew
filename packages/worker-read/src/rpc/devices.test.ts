import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleDevicesRpc,
  type ListDevicesRequest,
  type CheckDeviceExistsRequest,
  type CheckDuplicateAliasRequest,
  type CheckDeviceHasRecordsRequest,
  type GetDeviceAliasRequest,
} from "./devices";
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

describe("devices RPC handlers", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  // -------------------------------------------------------------------------
  // devices.list
  // -------------------------------------------------------------------------

  describe("devices.list", () => {
    it("should return list of devices", async () => {
      const mockDevices = [
        {
          device_id: "d1",
          alias: "MacBook Pro",
          first_seen: "2026-04-01T10:00:00.000Z",
          last_seen: "2026-04-08T18:00:00.000Z",
          total_tokens: 100000,
          sources: "claude-code,codex",
          model_count: 5,
        },
        {
          device_id: "d2",
          alias: null,
          first_seen: null,
          last_seen: null,
          total_tokens: 0,
          sources: null,
          model_count: 0,
        },
      ];
      db.all.mockResolvedValue({ results: mockDevices });

      const request: ListDevicesRequest = {
        method: "devices.list",
        userId: "u1",
      };
      const response = await handleDevicesRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: mockDevices });
    });

    it("should return 400 when userId missing", async () => {
      const request = {
        method: "devices.list",
        userId: "",
      } as ListDevicesRequest;
      const response = await handleDevicesRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // devices.exists
  // -------------------------------------------------------------------------

  describe("devices.exists", () => {
    it("should return exists: true when device exists", async () => {
      db.first.mockResolvedValue({ device_id: "d1" });

      const request: CheckDeviceExistsRequest = {
        method: "devices.exists",
        userId: "u1",
        deviceId: "d1",
      };
      const response = await handleDevicesRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: { exists: true } });
    });

    it("should return exists: false when device not found", async () => {
      db.first.mockResolvedValue(null);

      const request: CheckDeviceExistsRequest = {
        method: "devices.exists",
        userId: "u1",
        deviceId: "nonexistent",
      };
      const response = await handleDevicesRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: { exists: false } });
    });

    it("should return 400 when params missing", async () => {
      const request = {
        method: "devices.exists",
        userId: "",
        deviceId: "d1",
      } as CheckDeviceExistsRequest;
      const response = await handleDevicesRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // devices.checkDuplicateAlias
  // -------------------------------------------------------------------------

  describe("devices.checkDuplicateAlias", () => {
    it("should return duplicate: true when alias exists on another device", async () => {
      db.first.mockResolvedValue({ device_id: "d2" });

      const request: CheckDuplicateAliasRequest = {
        method: "devices.checkDuplicateAlias",
        userId: "u1",
        alias: "MacBook Pro",
        excludeDeviceId: "d1",
      };
      const response = await handleDevicesRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: { duplicate: true } });
    });

    it("should return duplicate: false when alias is unique", async () => {
      db.first.mockResolvedValue(null);

      const request: CheckDuplicateAliasRequest = {
        method: "devices.checkDuplicateAlias",
        userId: "u1",
        alias: "New Device",
        excludeDeviceId: "d1",
      };
      const response = await handleDevicesRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: { duplicate: false } });
    });

    it("should return 400 when params missing", async () => {
      const request = {
        method: "devices.checkDuplicateAlias",
        userId: "u1",
        alias: "",
        excludeDeviceId: "d1",
      } as CheckDuplicateAliasRequest;
      const response = await handleDevicesRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // devices.hasRecords
  // -------------------------------------------------------------------------

  describe("devices.hasRecords", () => {
    it("should return hasRecords: true when device has usage records", async () => {
      db.first.mockResolvedValue({ cnt: 100 });

      const request: CheckDeviceHasRecordsRequest = {
        method: "devices.hasRecords",
        userId: "u1",
        deviceId: "d1",
      };
      const response = await handleDevicesRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: { hasRecords: true } });
    });

    it("should return hasRecords: false when device has no records", async () => {
      db.first.mockResolvedValue({ cnt: 0 });

      const request: CheckDeviceHasRecordsRequest = {
        method: "devices.hasRecords",
        userId: "u1",
        deviceId: "d1",
      };
      const response = await handleDevicesRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: { hasRecords: false } });
    });

    it("should return hasRecords: false when result is null", async () => {
      db.first.mockResolvedValue(null);

      const request: CheckDeviceHasRecordsRequest = {
        method: "devices.hasRecords",
        userId: "u1",
        deviceId: "d1",
      };
      const response = await handleDevicesRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: { hasRecords: false } });
    });

    it("should return 400 when params missing", async () => {
      const request = {
        method: "devices.hasRecords",
        userId: "u1",
        deviceId: "",
      } as CheckDeviceHasRecordsRequest;
      const response = await handleDevicesRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // devices.getAlias
  // -------------------------------------------------------------------------

  describe("devices.getAlias", () => {
    it("should return alias when exists", async () => {
      db.first.mockResolvedValue({ alias: "MacBook Pro" });

      const request: GetDeviceAliasRequest = {
        method: "devices.getAlias",
        userId: "u1",
        deviceId: "d1",
      };
      const response = await handleDevicesRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: "MacBook Pro" });
    });

    it("should return null when no alias set", async () => {
      db.first.mockResolvedValue(null);

      const request: GetDeviceAliasRequest = {
        method: "devices.getAlias",
        userId: "u1",
        deviceId: "d1",
      };
      const response = await handleDevicesRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: null });
    });

    it("should return 400 when params missing", async () => {
      const request = {
        method: "devices.getAlias",
        userId: "",
        deviceId: "d1",
      } as GetDeviceAliasRequest;
      const response = await handleDevicesRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // Unknown method
  // -------------------------------------------------------------------------

  describe("unknown method", () => {
    it("should return 400 for unknown method", async () => {
      const request = { method: "devices.unknown" } as unknown as ListDevicesRequest;
      const response = await handleDevicesRpc(request, db);

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toContain("Unknown devices method");
    });
  });
});
