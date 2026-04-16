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

import { GET, DELETE } from "@/app/api/admin/cache/route";
import { createMockDbRead, makeGetRequest, makeJsonRequest } from "./test-utils";
import * as dbModule from "@/lib/db";

const { resolveAdmin } = (await import("@/lib/admin")) as unknown as {
  resolveAdmin: ReturnType<typeof vi.fn>;
};

const BASE_PATH = "/api/admin/cache";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Admin cache API", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead> & {
    getCacheKeys: ReturnType<typeof vi.fn>;
    invalidateCacheKey: ReturnType<typeof vi.fn>;
    clearCache: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    const base = createMockDbRead();
    mockDbRead = Object.assign(base, {
      getCacheKeys: vi.fn(),
      invalidateCacheKey: vi.fn(),
      clearCache: vi.fn(),
    }) as typeof mockDbRead;
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as never);
    resolveAdmin.mockResolvedValue({ userId: "admin1", email: "a@b.com" });
  });

  // ========== GET ==========

  describe("GET /api/admin/cache", () => {
    it("returns 403 when not admin", async () => {
      resolveAdmin.mockResolvedValueOnce(null);
      const res = await GET(makeGetRequest(BASE_PATH));
      expect(res.status).toBe(403);
    });

    it("lists all cache keys", async () => {
      mockDbRead.getCacheKeys.mockResolvedValueOnce({
        keys: ["k1", "k2"],
        count: 2,
        truncated: false,
      });

      const res = await GET(makeGetRequest(BASE_PATH));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.keys).toEqual(["k1", "k2"]);
      expect(body.count).toBe(2);
    });

    it("passes prefix filter", async () => {
      mockDbRead.getCacheKeys.mockResolvedValueOnce({
        keys: ["lb:1"],
        count: 1,
        truncated: false,
      });

      await GET(makeGetRequest(BASE_PATH, { prefix: "lb:" }));
      expect(mockDbRead.getCacheKeys).toHaveBeenCalledWith("lb:");
    });

    it("returns 500 on DB error", async () => {
      mockDbRead.getCacheKeys.mockRejectedValueOnce(new Error("fail"));
      const res = await GET(makeGetRequest(BASE_PATH));
      expect(res.status).toBe(500);
    });
  });

  // ========== DELETE ==========

  describe("DELETE /api/admin/cache", () => {
    it("returns 403 when not admin", async () => {
      resolveAdmin.mockResolvedValueOnce(null);
      const res = await DELETE(makeJsonRequest("DELETE", BASE_PATH));
      expect(res.status).toBe(403);
    });

    it("clears all cache", async () => {
      mockDbRead.clearCache.mockResolvedValueOnce({
        deleted: 5,
        truncated: false,
      });

      const res = await DELETE(makeJsonRequest("DELETE", BASE_PATH));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.deleted).toBe(5);
      expect(mockDbRead.clearCache).toHaveBeenCalledWith(undefined);
    });

    it("clears cache by prefix", async () => {
      mockDbRead.clearCache.mockResolvedValueOnce({
        deleted: 2,
        truncated: false,
      });

      const res = await DELETE(
        new Request(`http://localhost:7020${BASE_PATH}?prefix=lb:`, { method: "DELETE" }),
      );
      expect(res.status).toBe(200);
      expect(mockDbRead.clearCache).toHaveBeenCalledWith("lb:");
    });

    it("invalidates a specific key", async () => {
      mockDbRead.invalidateCacheKey.mockResolvedValueOnce(undefined);

      const res = await DELETE(
        new Request(`http://localhost:7020${BASE_PATH}?key=my-key`, { method: "DELETE" }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.deleted).toBe(1);
      expect(mockDbRead.invalidateCacheKey).toHaveBeenCalledWith("my-key");
    });

    it("returns 500 on DB error", async () => {
      mockDbRead.clearCache.mockRejectedValueOnce(new Error("fail"));
      const res = await DELETE(makeJsonRequest("DELETE", BASE_PATH));
      expect(res.status).toBe(500);
    });
  });
});
