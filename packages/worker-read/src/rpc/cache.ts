/**
 * Cache domain RPC handlers for worker-read.
 *
 * Provides admin endpoints for KV cache management:
 * - List cache keys
 * - Clear cache entries
 * - Invalidate specific keys
 */

import type { D1Database, KVNamespace } from "@cloudflare/workers-types";
import { listAllCacheKeys, clearAllCache, invalidateKey } from "../cache";
import { invalidateLeaderboard } from "../leaderboard-snapshot";

// ---------------------------------------------------------------------------
// RPC Request Types
// ---------------------------------------------------------------------------

export interface CacheListRequest {
  method: "cache.list";
  prefix?: string;
}

export interface CacheClearRequest {
  method: "cache.clear";
  prefix?: string;
}

export interface CacheInvalidateRequest {
  method: "cache.invalidate";
  key: string;
}

export type CacheRpcRequest = CacheListRequest | CacheClearRequest | CacheInvalidateRequest;

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handleCacheRpc(
  request: CacheRpcRequest,
  kv: KVNamespace,
  db: D1Database,
): Promise<Response> {
  switch (request.method) {
    case "cache.list": {
      const result = await listAllCacheKeys(kv, request.prefix);
      return Response.json({ result });
    }

    case "cache.clear": {
      if (!request.prefix || "lb:".startsWith(request.prefix) || request.prefix.startsWith("lb:")) {
        await invalidateLeaderboard(db);
      }
      const result = await clearAllCache(kv, request.prefix);
      return Response.json({ result });
    }

    case "cache.invalidate": {
      if (!request.key) {
        return Response.json({ error: "key is required" }, { status: 400 });
      }
      if (request.key.startsWith("lb:")) await invalidateLeaderboard(db);
      await invalidateKey(kv, request.key);
      return Response.json({ result: { invalidated: request.key } });
    }

    default:
      return Response.json(
        { error: `Unknown cache method: ${(request as { method: string }).method}` },
        { status: 400 },
      );
  }
}
