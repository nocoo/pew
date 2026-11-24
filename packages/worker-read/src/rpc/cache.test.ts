import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleCacheRpc,
  type CacheListRequest,
  type CacheClearRequest,
  type CacheInvalidateRequest,
} from "./cache";
import type { D1Database, KVNamespace } from "@cloudflare/workers-types";

// ---------------------------------------------------------------------------
// Mock KVNamespace
// ---------------------------------------------------------------------------

function createMockKv() {
  return {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ keys: [], list_complete: true }),
    getWithMetadata: vi.fn().mockResolvedValue({ value: null, metadata: null }),
  } as unknown as KVNamespace & {
    get: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
  };
}

describe("cache RPC handlers", () => {
  let kv: ReturnType<typeof createMockKv>;
  const run = vi.fn().mockResolvedValue({ success: true });
  const db = { prepare: vi.fn(() => ({ run })) } as unknown as D1Database;

  beforeEach(() => {
    kv = createMockKv();
    run.mockClear();
  });

  it.each([undefined, "l", "lb:", "lb:v1:"])(
    "fences leaderboard fills before clearing prefix %s",
    async (prefix) => {
      await handleCacheRpc({ method: "cache.clear", prefix }, kv, db);
      expect(run).toHaveBeenCalledOnce();
      expect(run.mock.invocationCallOrder[0]).toBeLessThan(kv.list.mock.invocationCallOrder[0]);
    },
  );

  it("invalidates versioned leaderboard keys without invalidating unrelated families", async () => {
    await handleCacheRpc({ method: "cache.invalidate", key: "lb:v1:old" }, kv, db);
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.invocationCallOrder[0]).toBeLessThan(kv.delete.mock.invocationCallOrder[0]);
    await handleCacheRpc({ method: "cache.clear", prefix: "pricing:" }, kv, db);
    expect(run).toHaveBeenCalledOnce();
  });

  it("does not delete keys if authoritative invalidation fails", async () => {
    run.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(handleCacheRpc({ method: "cache.clear" }, kv, db)).rejects.toThrow(
      "database unavailable",
    );
    expect(kv.delete).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // cache.list
  // -------------------------------------------------------------------------

  describe("cache.list", () => {
    it("should list all cache keys", async () => {
      kv.list.mockResolvedValue({
        keys: [{ name: "pricing:all" }, { name: "seasons:list" }],
        list_complete: true,
      });

      const request: CacheListRequest = { method: "cache.list" };
      const response = await handleCacheRpc(request, kv, db);
      const body = (await response.json()) as { result: unknown; error?: string };

      expect(response.status).toBe(200);
      expect(body.result).toEqual({
        keys: ["pricing:all", "seasons:list"],
        truncated: false,
        count: 2,
      });
    });

    it("should filter by prefix", async () => {
      kv.list.mockResolvedValue({
        keys: [{ name: "pricing:all" }],
        list_complete: true,
      });

      const request: CacheListRequest = { method: "cache.list", prefix: "pricing:" };
      await handleCacheRpc(request, kv, db);

      expect(kv.list).toHaveBeenCalledWith({
        prefix: "pricing:",
        limit: 1000,
        cursor: undefined,
      });
    });

    it("should return empty array when no keys", async () => {
      const request: CacheListRequest = { method: "cache.list" };
      const response = await handleCacheRpc(request, kv, db);
      const body = (await response.json()) as { result: unknown; error?: string };

      expect(body.result).toEqual({
        keys: [],
        truncated: false,
        count: 0,
      });
    });
  });

  // -------------------------------------------------------------------------
  // cache.clear
  // -------------------------------------------------------------------------

  describe("cache.clear", () => {
    it("should clear all cache keys", async () => {
      kv.list.mockResolvedValue({
        keys: [{ name: "key1" }, { name: "key2" }],
        list_complete: true,
      });

      const request: CacheClearRequest = { method: "cache.clear" };
      const response = await handleCacheRpc(request, kv, db);
      const body = (await response.json()) as { result: unknown; error?: string };

      expect(response.status).toBe(200);
      expect(body.result).toEqual({
        deleted: 2,
        truncated: false,
      });
      expect(kv.delete).toHaveBeenCalledTimes(2);
      expect(kv.delete).toHaveBeenCalledWith("key1");
      expect(kv.delete).toHaveBeenCalledWith("key2");
    });

    it("should filter by prefix when clearing", async () => {
      kv.list.mockResolvedValue({
        keys: [{ name: "pricing:all" }],
        list_complete: true,
      });

      const request: CacheClearRequest = { method: "cache.clear", prefix: "pricing:" };
      await handleCacheRpc(request, kv, db);

      expect(kv.list).toHaveBeenCalledWith({
        prefix: "pricing:",
        limit: 1000,
        cursor: undefined,
      });
      expect(kv.delete).toHaveBeenCalledWith("pricing:all");
    });

    it("should return 0 deleted when no keys", async () => {
      const request: CacheClearRequest = { method: "cache.clear" };
      const response = await handleCacheRpc(request, kv, db);
      const body = (await response.json()) as { result: unknown; error?: string };

      expect(body.result).toEqual({
        deleted: 0,
        truncated: false,
      });
      expect(kv.delete).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // cache.invalidate
  // -------------------------------------------------------------------------

  describe("cache.invalidate", () => {
    it("should invalidate a single key", async () => {
      const request: CacheInvalidateRequest = {
        method: "cache.invalidate",
        key: "pricing:all",
      };
      const response = await handleCacheRpc(request, kv, db);
      const body = (await response.json()) as { result: unknown; error?: string };

      expect(response.status).toBe(200);
      expect(body.result).toEqual({ invalidated: "pricing:all" });
      expect(kv.delete).toHaveBeenCalledWith("pricing:all");
      expect(kv.delete).toHaveBeenCalledOnce();
    });

    it("should return 400 when key is missing", async () => {
      const request = {
        method: "cache.invalidate",
        key: "",
      } as CacheInvalidateRequest;
      const response = await handleCacheRpc(request, kv, db);

      expect(response.status).toBe(400);
      const body = (await response.json()) as { result: unknown; error?: string };
      expect(body.error).toContain("key is required");
    });
  });

  // -------------------------------------------------------------------------
  // Unknown method
  // -------------------------------------------------------------------------

  describe("unknown method", () => {
    it("should return 400 for unknown method", async () => {
      const request = { method: "cache.unknown" } as unknown as CacheListRequest;
      const response = await handleCacheRpc(request, kv, db);

      expect(response.status).toBe(400);
      const body = (await response.json()) as { result: unknown; error?: string };
      expect(body.error).toContain("Unknown cache method");
    });
  });
});
