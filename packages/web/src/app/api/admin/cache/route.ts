/**
 * Admin cache management API route.
 *
 * Provides endpoints for managing the KV cache layer.
 * Admin-only access.
 */

import { NextResponse } from "next/server";
import { resolveAdmin } from "@/lib/admin";
import { getDbRead } from "@/lib/db";
import { getLeaderboardCacheStats } from "@/lib/leaderboard-cache";

// ---------------------------------------------------------------------------
// Response Types
// ---------------------------------------------------------------------------

export interface CacheListResponse {
  keys: string[];
  count: number;
  truncated: boolean;
  leaderboardMemory: ReturnType<typeof getLeaderboardCacheStats>;
}

export interface CacheClearResponse {
  deleted: number;
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// GET /api/admin/cache — List cache keys
// ---------------------------------------------------------------------------

export async function GET(request: Request): Promise<Response> {
  const admin = await resolveAdmin(request);

  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const url = new URL(request.url);
    const prefix = url.searchParams.get("prefix") || undefined;

    const db = await getDbRead();
    const result = await db.getCacheKeys(prefix);

    return NextResponse.json(
      { ...result, leaderboardMemory: getLeaderboardCacheStats(db) } satisfies CacheListResponse,
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    console.error("Failed to list cache keys:", err);
    return NextResponse.json({ error: "Failed to list cache keys" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/admin/cache — Clear cache
// ---------------------------------------------------------------------------

export async function DELETE(request: Request): Promise<Response> {
  const admin = await resolveAdmin(request);

  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const url = new URL(request.url);
    const prefix = url.searchParams.get("prefix") || undefined;
    const key = url.searchParams.get("key") || undefined;

    const db = await getDbRead();

    // If specific key provided, invalidate just that key
    if (key) {
      await db.invalidateCacheKey(key);
      return NextResponse.json({ deleted: 1, truncated: false } satisfies CacheClearResponse);
    }

    // Otherwise, clear all (optionally by prefix)
    const result = await db.clearCache(prefix);

    return NextResponse.json(result satisfies CacheClearResponse);
  } catch (err) {
    console.error("Failed to clear cache:", err);
    return NextResponse.json({ error: "Failed to clear cache" }, { status: 500 });
  }
}
