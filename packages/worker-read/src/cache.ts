/**
 * KV cache helpers for worker-read.
 *
 * Provides a cache-aside pattern for caching RPC responses in Cloudflare KV.
 * All cache operations are fault-tolerant — KV errors never fail requests.
 */

import type { KVNamespace } from "@cloudflare/workers-types";

// ---------------------------------------------------------------------------
// TTL Constants
// ---------------------------------------------------------------------------

/** 24 hours — for rarely-changing data (pricing, frozen snapshots) */
export const TTL_24H = 86400;

/** 5 minutes — for moderately-changing data (seasons list, public leaderboard) */
export const TTL_5M = 300;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CacheOptions {
  ttlSeconds: number;
}

// ---------------------------------------------------------------------------
// Internal Constants
// ---------------------------------------------------------------------------

/** Maximum keys to process in list/clear operations */
const MAX_KEYS_LIMIT = 10000;

// ---------------------------------------------------------------------------
// Cache-Aside Pattern
// ---------------------------------------------------------------------------

/**
 * Cache-aside pattern wrapper.
 *
 * 1. Try KV cache
 * 2. On miss, call fetcher
 * 3. Write result to KV (awaited, errors logged but not thrown)
 * 4. Return result
 *
 * KV errors never fail the request — they fall through to D1.
 */
export async function withCache<T>(
  kv: KVNamespace,
  key: string,
  fetcher: () => Promise<T>,
  options: CacheOptions
): Promise<{ data: T; cached: boolean }> {
  // 1. Try cache
  try {
    const cached = await kv.get(key, "json");
    if (cached !== null) {
      return { data: cached as T, cached: true };
    }
  } catch (err) {
    // Cache read failed, continue to fetcher
    console.error(`[cache] read error for "${key}":`, err);
  }

  // 2. Fetch from source
  const data = await fetcher();

  // 3. Write to cache (awaited, but errors don't fail the request)
  try {
    await kv.put(key, JSON.stringify(data), {
      expirationTtl: options.ttlSeconds,
    });
  } catch (err) {
    console.error(`[cache] write error for "${key}":`, err);
  }

  return { data, cached: false };
}

// ---------------------------------------------------------------------------
// Key Management
// ---------------------------------------------------------------------------

/**
 * List all cache keys with cursor pagination.
 * Returns up to MAX_KEYS_LIMIT keys.
 *
 * truncated = true means there are still keys in KV that were not returned.
 */
export async function listAllCacheKeys(
  kv: KVNamespace,
  prefix?: string
): Promise<{ keys: string[]; truncated: boolean; count: number }> {
  const keys: string[] = [];
  let cursor: string | undefined;
  let hasMoreData = false;

  outer: while (keys.length < MAX_KEYS_LIMIT) {
    const result = await kv.list({
      prefix: prefix ?? undefined,
      limit: 1000,
      cursor,
    });

    for (const key of result.keys) {
      if (keys.length >= MAX_KEYS_LIMIT) {
        // Hit limit — there's definitely more data (this key we couldn't add)
        hasMoreData = true;
        break outer;
      }
      keys.push(key.name);
    }

    // Finished processing this page
    if (result.list_complete) {
      // No more pages — we got everything
      hasMoreData = false;
      break;
    }

    // More pages exist — continue
    cursor = result.cursor;
    // If we exit the while loop after this due to keys.length >= MAX_KEYS_LIMIT,
    // hasMoreData should be true because result.list_complete was false
    hasMoreData = true;
  }

  return {
    keys,
    truncated: hasMoreData,
    count: keys.length,
  };
}

/**
 * Delete all cache entries with cursor pagination.
 * Deletes up to MAX_KEYS_LIMIT keys.
 *
 * truncated = true means there are still keys in KV that were not deleted.
 */
export async function clearAllCache(
  kv: KVNamespace,
  prefix?: string
): Promise<{ deleted: number; truncated: boolean }> {
  let deleted = 0;
  let cursor: string | undefined;
  let hasMoreData = false;

  outer: while (deleted < MAX_KEYS_LIMIT) {
    const result = await kv.list({
      prefix: prefix ?? undefined,
      limit: 1000,
      cursor,
    });

    for (const key of result.keys) {
      if (deleted >= MAX_KEYS_LIMIT) {
        // Hit limit — there's definitely more data (this key we couldn't delete)
        hasMoreData = true;
        break outer;
      }
      await kv.delete(key.name);
      deleted++;
    }

    // Finished processing this page
    if (result.list_complete) {
      // No more pages — we deleted everything
      hasMoreData = false;
      break;
    }

    // More pages exist — continue
    cursor = result.cursor;
    // If we exit the while loop after this due to deleted >= MAX_KEYS_LIMIT,
    // hasMoreData should be true because result.list_complete was false
    hasMoreData = true;
  }

  return {
    deleted,
    truncated: hasMoreData,
  };
}

/**
 * Delete a single cache entry.
 */
export async function invalidateKey(
  kv: KVNamespace,
  key: string
): Promise<void> {
  await kv.delete(key);
}
