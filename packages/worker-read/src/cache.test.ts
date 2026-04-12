import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  withCache,
  listAllCacheKeys,
  clearAllCache,
  invalidateKey,
  TTL_24H,
  TTL_5M,
} from "./cache";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMockKV(overrides?: {
  get?: ReturnType<typeof vi.fn>;
  put?: ReturnType<typeof vi.fn>;
  delete?: ReturnType<typeof vi.fn>;
  list?: ReturnType<typeof vi.fn>;
}) {
  return {
    get: overrides?.get ?? vi.fn().mockResolvedValue(null),
    put: overrides?.put ?? vi.fn().mockResolvedValue(undefined),
    delete: overrides?.delete ?? vi.fn().mockResolvedValue(undefined),
    list:
      overrides?.list ??
      vi.fn().mockResolvedValue({ keys: [], list_complete: true }),
    getWithMetadata: vi.fn().mockResolvedValue({ value: null, metadata: null }),
  } as unknown as KVNamespace;
}

// ---------------------------------------------------------------------------
// TTL Constants
// ---------------------------------------------------------------------------

describe("TTL constants", () => {
  it("TTL_24H should be 86400 seconds", () => {
    expect(TTL_24H).toBe(86400);
  });

  it("TTL_5M should be 300 seconds", () => {
    expect(TTL_5M).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// withCache
// ---------------------------------------------------------------------------

describe("withCache", () => {
  it("should return cached data on cache hit", async () => {
    const cachedData = { foo: "bar" };
    const kv = createMockKV({
      get: vi.fn().mockResolvedValue(cachedData),
    });
    const fetcher = vi.fn().mockResolvedValue({ foo: "fresh" });

    const result = await withCache(kv, "test-key", fetcher, { ttlSeconds: 300 });

    expect(result.data).toEqual(cachedData);
    expect(result.cached).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
    expect(kv.put).not.toHaveBeenCalled();
  });

  it("should fetch and cache on cache miss", async () => {
    const freshData = { foo: "fresh" };
    const kv = createMockKV();
    const fetcher = vi.fn().mockResolvedValue(freshData);

    const result = await withCache(kv, "test-key", fetcher, { ttlSeconds: 300 });

    expect(result.data).toEqual(freshData);
    expect(result.cached).toBe(false);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(kv.put).toHaveBeenCalledWith("test-key", JSON.stringify(freshData), {
      expirationTtl: 300,
    });
  });

  it("should fall through to fetcher on cache read error", async () => {
    const freshData = { foo: "fresh" };
    const kv = createMockKV({
      get: vi.fn().mockRejectedValue(new Error("KV read failed")),
    });
    const fetcher = vi.fn().mockResolvedValue(freshData);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await withCache(kv, "test-key", fetcher, { ttlSeconds: 300 });

    expect(result.data).toEqual(freshData);
    expect(result.cached).toBe(false);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(consoleSpy).toHaveBeenCalledWith(
      '[cache] read error for "test-key":',
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });

  it("should not fail request on cache write error", async () => {
    const freshData = { foo: "fresh" };
    const kv = createMockKV({
      put: vi.fn().mockRejectedValue(new Error("KV write failed")),
    });
    const fetcher = vi.fn().mockResolvedValue(freshData);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await withCache(kv, "test-key", fetcher, { ttlSeconds: 300 });

    expect(result.data).toEqual(freshData);
    expect(result.cached).toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith(
      '[cache] write error for "test-key":',
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });

  it("should use correct TTL when writing to cache", async () => {
    const kv = createMockKV();
    const fetcher = vi.fn().mockResolvedValue({ data: 1 });

    await withCache(kv, "key-24h", fetcher, { ttlSeconds: TTL_24H });

    expect(kv.put).toHaveBeenCalledWith(
      "key-24h",
      expect.any(String),
      { expirationTtl: 86400 }
    );
  });
});

// ---------------------------------------------------------------------------
// listAllCacheKeys
// ---------------------------------------------------------------------------

describe("listAllCacheKeys", () => {
  it("should return empty array when no keys", async () => {
    const kv = createMockKV();

    const result = await listAllCacheKeys(kv);

    expect(result.keys).toEqual([]);
    expect(result.count).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it("should return all keys from single page", async () => {
    const kv = createMockKV({
      list: vi.fn().mockResolvedValue({
        keys: [{ name: "key1" }, { name: "key2" }, { name: "key3" }],
        list_complete: true,
      }),
    });

    const result = await listAllCacheKeys(kv);

    expect(result.keys).toEqual(["key1", "key2", "key3"]);
    expect(result.count).toBe(3);
    expect(result.truncated).toBe(false);
  });

  it("should paginate through multiple pages", async () => {
    const kv = createMockKV({
      list: vi
        .fn()
        .mockResolvedValueOnce({
          keys: [{ name: "key1" }, { name: "key2" }],
          list_complete: false,
          cursor: "cursor1",
        })
        .mockResolvedValueOnce({
          keys: [{ name: "key3" }, { name: "key4" }],
          list_complete: true,
        }),
    });

    const result = await listAllCacheKeys(kv);

    expect(result.keys).toEqual(["key1", "key2", "key3", "key4"]);
    expect(result.count).toBe(4);
    expect(result.truncated).toBe(false);
    expect(kv.list).toHaveBeenCalledTimes(2);
    expect(kv.list).toHaveBeenNthCalledWith(2, {
      prefix: undefined,
      limit: 1000,
      cursor: "cursor1",
    });
  });

  it("should filter by prefix", async () => {
    const kv = createMockKV({
      list: vi.fn().mockResolvedValue({
        keys: [{ name: "pricing:all" }],
        list_complete: true,
      }),
    });

    await listAllCacheKeys(kv, "pricing:");

    expect(kv.list).toHaveBeenCalledWith({
      prefix: "pricing:",
      limit: 1000,
      cursor: undefined,
    });
  });

  it("should truncate and mark truncated=true when hitting MAX_KEYS_LIMIT", async () => {
    // Simulate having more than 10000 keys
    const keysPerPage = 1000;
    const totalPages = 11; // 11000 keys total, should truncate at 10000
    const listMock = vi.fn();

    for (let i = 0; i < totalPages; i++) {
      const keys = Array.from({ length: keysPerPage }, (_, j) => ({
        name: `key${i * keysPerPage + j}`,
      }));
      listMock.mockResolvedValueOnce({
        keys,
        list_complete: i === totalPages - 1,
        cursor: i < totalPages - 1 ? `cursor${i}` : undefined,
      });
    }

    const kv = createMockKV({ list: listMock });

    const result = await listAllCacheKeys(kv);

    expect(result.keys.length).toBe(10000);
    expect(result.count).toBe(10000);
    expect(result.truncated).toBe(true);
    // Should stop after 10 pages (10000 keys), 11th page not fetched
    expect(listMock).toHaveBeenCalledTimes(10);
  });

  it("should set truncated=true when exact 10000 keys but more pages exist", async () => {
    // 10 pages of 1000 keys each, but list_complete = false on last page
    const keysPerPage = 1000;
    const totalPages = 10;
    const listMock = vi.fn();

    for (let i = 0; i < totalPages; i++) {
      const keys = Array.from({ length: keysPerPage }, (_, j) => ({
        name: `key${i * keysPerPage + j}`,
      }));
      listMock.mockResolvedValueOnce({
        keys,
        list_complete: false, // Always more pages
        cursor: `cursor${i}`,
      });
    }

    const kv = createMockKV({ list: listMock });

    const result = await listAllCacheKeys(kv);

    expect(result.keys.length).toBe(10000);
    expect(result.truncated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// clearAllCache
// ---------------------------------------------------------------------------

describe("clearAllCache", () => {
  it("should return 0 deleted when no keys", async () => {
    const kv = createMockKV();

    const result = await clearAllCache(kv);

    expect(result.deleted).toBe(0);
    expect(result.truncated).toBe(false);
    expect(kv.delete).not.toHaveBeenCalled();
  });

  it("should delete all keys from single page", async () => {
    const kv = createMockKV({
      list: vi.fn().mockResolvedValue({
        keys: [{ name: "key1" }, { name: "key2" }],
        list_complete: true,
      }),
    });

    const result = await clearAllCache(kv);

    expect(result.deleted).toBe(2);
    expect(result.truncated).toBe(false);
    expect(kv.delete).toHaveBeenCalledTimes(2);
    expect(kv.delete).toHaveBeenCalledWith("key1");
    expect(kv.delete).toHaveBeenCalledWith("key2");
  });

  it("should paginate through multiple pages when deleting", async () => {
    const kv = createMockKV({
      list: vi
        .fn()
        .mockResolvedValueOnce({
          keys: [{ name: "key1" }],
          list_complete: false,
          cursor: "cursor1",
        })
        .mockResolvedValueOnce({
          keys: [{ name: "key2" }],
          list_complete: true,
        }),
    });

    const result = await clearAllCache(kv);

    expect(result.deleted).toBe(2);
    expect(result.truncated).toBe(false);
    expect(kv.delete).toHaveBeenCalledTimes(2);
  });

  it("should filter by prefix when clearing", async () => {
    const kv = createMockKV({
      list: vi.fn().mockResolvedValue({
        keys: [{ name: "pricing:all" }],
        list_complete: true,
      }),
    });

    await clearAllCache(kv, "pricing:");

    expect(kv.list).toHaveBeenCalledWith({
      prefix: "pricing:",
      limit: 1000,
      cursor: undefined,
    });
    expect(kv.delete).toHaveBeenCalledWith("pricing:all");
  });

  it("should truncate and mark truncated=true when hitting MAX_KEYS_LIMIT", async () => {
    // Similar to listAllCacheKeys test
    const keysPerPage = 1000;
    const totalPages = 11;
    const listMock = vi.fn();

    for (let i = 0; i < totalPages; i++) {
      const keys = Array.from({ length: keysPerPage }, (_, j) => ({
        name: `key${i * keysPerPage + j}`,
      }));
      listMock.mockResolvedValueOnce({
        keys,
        list_complete: i === totalPages - 1,
        cursor: i < totalPages - 1 ? `cursor${i}` : undefined,
      });
    }

    const kv = createMockKV({ list: listMock });

    const result = await clearAllCache(kv);

    expect(result.deleted).toBe(10000);
    expect(result.truncated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// invalidateKey
// ---------------------------------------------------------------------------

describe("invalidateKey", () => {
  it("should delete a single key", async () => {
    const kv = createMockKV();

    await invalidateKey(kv, "pricing:all");

    expect(kv.delete).toHaveBeenCalledWith("pricing:all");
    expect(kv.delete).toHaveBeenCalledOnce();
  });
});
