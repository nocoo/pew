# 38 — Cloudflare KV Cache Layer

> Add edge caching to worker-read via Cloudflare KV, reducing D1 query load
> for frequently-accessed, slowly-changing, **identity-independent** data.
>
> **Historical note (2026-05):** All references below to
> `pricing.listModelPricing` / `pricing:all` / `model_pricing` describe the
> legacy admin-CRUD pricing path that was removed in migration 021 (see
> `docs/40-dynamic-model-pricing.md`). The active pricing cache is now
> `pricing:dynamic` populated by the worker-read sync orchestrator from
> baseline + OpenRouter + models.dev. Treat the table-4/admin-pricing rows
> as historical context only.

## Status

| # | Description | Status |
|---|-------------|--------|
| 1 | This document | ✅ done |
| 2 | Add test environment KV binding | ✅ done |
| 3 | Implement cache helper (`withCache`) | ✅ done |
| 4 | Cache `pricing.listModelPricing` (24h TTL) | ✅ done |
| 5 | Cache `seasons.getSnapshots` for frozen seasons (24h TTL) | ✅ done |
| 6 | Cache `seasons.list` (5min TTL) | ✅ done |
| 7 | Cache `leaderboard.getGlobal` — **public only** (5min TTL) | ✅ done |
| 8 | ~~Cache `achievements.getEarners`~~ — **deferred** (see Decision 3) | ⏭️ skipped |
| 9 | Add `cache.*` RPC domain + DbRead interface methods | ✅ done |
| 10 | Add KV management card to Admin Storage page | ✅ done |
| 11 | Tests (unit + integration) | ✅ done |
| 12 | Deploy + verify | ✅ done |
| 13 | Retrospective | ✅ done |

---

## Background

### Current State

- **worker-read**: Every RPC call hits D1 directly
- **No caching layer**: Identical queries from different users all hit D1
- **Leaderboard/pricing/seasons**: Public pages with high read overlap

### Problem

| Scenario | Impact |
|----------|--------|
| 10 users view `/leaderboard` in 1 minute | 10 identical `leaderboard.getGlobal` queries |
| Every cost calculation fetches pricing | ~100 identical `pricing.listModelPricing` calls/day |
| Season list on navbar | Every page load triggers `seasons.list` |

### Solution

Add Cloudflare KV as a cache layer in worker-read. KV provides:

- **Global edge distribution**: ~10ms reads worldwide
- **Simple key-value semantics**: No complex invalidation logic
- **Free tier**: 100K reads/day, 1K writes/day, 1GB storage

---

## Key Decisions

### Decision 1: Only Cache Identity-Independent Data

**Problem**: The current `/api/leaderboard` route enforces `Cache-Control: private, no-store` for team/org-scoped requests because results depend on user membership. Caching these in shared KV would cause cache pollution and potential data leakage.

**Decision**: First version **only caches truly public, identity-independent data**:

| Cacheable | Key Characteristics |
|-----------|---------------------|
| `pricing.listModelPricing` | Global, no user context |
| `seasons.list` | Global, no user context |
| `seasons.getSnapshots` (frozen only) | Frozen data, no user context |
| `leaderboard.getGlobal` (no team/org filter) | Public leaderboard only |

| NOT Cacheable | Reason |
|---------------|--------|
| `leaderboard.getGlobal` with `teamId` or `orgId` | Scoped to membership, `private, no-store` |
| `achievements.getEarners` | See Decision 3 |
| All `usage.*`, `sessions.*`, `users.*` | Per-user data |

### Decision 2: Honest Stats Over Fake Precision

**Problem**: Worker isolates are ephemeral and multi-region. In-memory stats (hits/misses/writes) are:
- Reset on every isolate restart
- Not aggregated across regions
- Misleading if presented as "global hit rate"

**Decision**: 
- **Do NOT display hit rate** in admin UI — it's not meaningful
- Admin UI shows only **observable facts**: key list, key count
- Stats are kept for local debugging only (Worker logs), not exposed to UI
- Future: If we need real metrics, use Cloudflare Analytics API or Workers Analytics Engine

### Decision 3: Defer `achievements.getEarners` Caching

**Problem**: This RPC accepts raw `sql` and `params` from the caller. The key pattern in v1 (`ach:{id}:earners:{limit}:{offset}`) ignores the actual SQL shape, which could cause:
- Cache collisions between different SQL queries for the same achievement
- Stale data after achievement definition changes

**Decision**: Defer to v2. Proper caching requires either:
1. Standardized RPC methods per achievement (no raw SQL), or
2. Stable hash of normalized SQL + params (complex, error-prone)

Neither is worth the complexity for v1 given the low query volume.

### Decision 4: Paginated Key Management

**Problem**: `kv.list({ limit: 1000 })` only returns the first page. "Clear All" and "List Keys" would silently truncate.

**Decision**: Implement cursor-based pagination for both operations:
- `listAllCacheKeys()`: Paginate through all keys, return up to limit
- `clearAllCache()`: Paginate and delete all keys, return deleted count
- Set a hard limit (10,000 keys) to prevent runaway loops
- `truncated: true` means "there are still unprocessed keys remaining in KV" — not just "we hit the limit"

### Decision 5: Accept Light Query for Frozen Check

**Problem**: `seasons.getSnapshots` must verify `snapshot_ready = 1` before serving cached data. This means every request still hits D1 once, even for cached responses.

**Analysis**:
- Light query: `SELECT snapshot_ready FROM seasons WHERE id = ?` — indexed single-row lookup, <1ms
- Heavy query: Multi-table JOIN + GROUP BY on `season_snapshots` + `teams`, 20-50ms
- Cache hit eliminates the heavy query, not the light one

**Decision**: Accept this tradeoff. The light query is negligible compared to the heavy query savings. Alternative approaches (cache the frozen status separately, or encode it in the key) add complexity without meaningful benefit.

**If this becomes a bottleneck**: Cache the season metadata (including `snapshot_ready`) with a short TTL, then use that cached value to decide whether to cache snapshots. But this is premature optimization for v1.

---

## Cache Targets (v1)

### Tier 1: Long TTL (24 hours)

| RPC Method | Key Pattern | Conditions |
|------------|-------------|------------|
| `pricing.listModelPricing` | `pricing:all` | Always |
| `seasons.getSnapshots` | `season:{id}:snapshots` | Only if `snapshot_ready = 1` |

### Tier 2: Short TTL (5 minutes)

| RPC Method | Key Pattern | Conditions |
|------------|-------------|------------|
| `seasons.list` | `seasons:list` | Always |
| `leaderboard.getGlobal` | `lb:global:{from}:{source}:{model}:{limit}:{offset}` | Only if `teamId` AND `orgId` are both absent |

### Explicitly NOT Cached

| Category | Reason |
|----------|--------|
| `leaderboard.getGlobal` with `teamId` or `orgId` | Private scope, membership-dependent |
| `achievements.getEarners` | Raw SQL, deferred to v2 |
| All per-user RPC methods | Key explosion, privacy |

---

## Implementation

### Phase 1: Test Environment KV Binding

Production KV is already bound. Add test environment binding:

**wrangler.toml**:

```toml
# Production (already exists)
[[kv_namespaces]]
binding = "CACHE"
id = "5df59e90f9e34c5da40fd312eb83e4ee"

# Test environment
[env.test]
# ... existing config ...

[[env.test.kv_namespaces]]
binding = "CACHE"
id = "<TEST_KV_NAMESPACE_ID>"  # Create with: wrangler kv:namespace create CACHE --env test
```

**Env type update**:

```typescript
// packages/worker-read/src/index.ts
export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;  // NEW
  WORKER_READ_SECRET: string;
}
```

### Phase 2: Cache Helper

Create `packages/worker-read/src/cache.ts`:

```typescript
import type { KVNamespace } from "@cloudflare/workers-types";

export interface CacheOptions {
  ttlSeconds: number;
}

/** Maximum keys to process in list/clear operations */
const MAX_KEYS_LIMIT = 10000;

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
```

### Phase 3: Integrate into RPC Handlers

**TTL constants** (add to `cache.ts`):

```typescript
export const TTL_24H = 86400;
export const TTL_5M = 300;
```

**Example: pricing.ts**

```typescript
import { withCache, TTL_24H } from "../cache";

export async function handlePricingRpc(
  request: PricingRpcRequest,
  db: D1Database,
  kv: KVNamespace  // NEW param
): Promise<Response> {
  switch (request.method) {
    case "pricing.listModelPricing":
      return handleListModelPricing(db, kv);
    // ...
  }
}

async function handleListModelPricing(
  db: D1Database,
  kv: KVNamespace
): Promise<Response> {
  const { data, cached } = await withCache(
    kv,
    "pricing:all",
    async () => {
      const results = await db
        .prepare("SELECT * FROM model_pricing ORDER BY model ASC, source ASC")
        .all<ModelPricingRow>();
      return results.results;
    },
    { ttlSeconds: TTL_24H }
  );

  return Response.json({ result: data, _cached: cached });
}
```

**Example: seasons.ts (conditional caching)**

```typescript
import { withCache, TTL_24H, TTL_5M } from "../cache";

async function handleListSeasons(
  db: D1Database,
  kv: KVNamespace
): Promise<Response> {
  const { data, cached } = await withCache(
    kv,
    "seasons:list",
    () => fetchSeasonsList(db),
    { ttlSeconds: TTL_5M }
  );

  return Response.json({ result: data, _cached: cached });
}

async function handleGetSeasonSnapshots(
  req: GetSeasonSnapshotsRequest,
  db: D1Database,
  kv: KVNamespace
): Promise<Response> {
  // Check if season is frozen
  const season = await db
    .prepare("SELECT snapshot_ready FROM seasons WHERE id = ?")
    .bind(req.seasonId)
    .first<{ snapshot_ready: number }>();

  const isFrozen = season?.snapshot_ready === 1;

  if (isFrozen) {
    // Cache frozen seasons for 24h
    const { data, cached } = await withCache(
      kv,
      `season:${req.seasonId}:snapshots`,
      () => fetchSnapshots(db, req.seasonId),
      { ttlSeconds: TTL_24H }
    );
    return Response.json({ result: data, _cached: cached });
  }

  // Live season: no cache
  const data = await fetchSnapshots(db, req.seasonId);
  return Response.json({ result: data, _cached: false });
}
```

**Example: leaderboard.ts (conditional caching — public only)**

```typescript
import { withCache, TTL_5M } from "../cache";

async function handleGetGlobalLeaderboard(
  req: GetGlobalLeaderboardRequest,
  db: D1Database,
  kv: KVNamespace
): Promise<Response> {
  // CRITICAL: Only cache if NO team/org scope
  // Team/org scoped results are membership-dependent and must not be shared
  const hasPrivateScope = !!(req.teamId || req.orgId);

  if (hasPrivateScope) {
    // No caching for private scopes
    const data = await fetchGlobalLeaderboard(db, req);
    return Response.json({ result: data, _cached: false });
  }

  // Public leaderboard: cache for 5min
  const cacheKey = buildPublicLeaderboardKey(req);
  const { data, cached } = await withCache(
    kv,
    cacheKey,
    () => fetchGlobalLeaderboard(db, req),
    { ttlSeconds: TTL_5M }
  );

  return Response.json({ result: data, _cached: cached });
}

function buildPublicLeaderboardKey(req: GetGlobalLeaderboardRequest): string {
  // Only include identity-independent params
  // teamId/orgId are guaranteed absent here
  const parts = [
    "lb:global",
    req.fromDate ?? "_",
    req.source ?? "_",
    req.model ?? "_",
    String(req.limit),
    String(req.offset ?? 0),
  ];
  return parts.join(":");
}
```

### Phase 4: Cache RPC Domain

Create `packages/worker-read/src/rpc/cache.ts`:

```typescript
import type { KVNamespace } from "@cloudflare/workers-types";
import { listAllCacheKeys, clearAllCache, invalidateKey } from "../cache";

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

export type CacheRpcRequest =
  | CacheListRequest
  | CacheClearRequest
  | CacheInvalidateRequest;

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handleCacheRpc(
  request: CacheRpcRequest,
  kv: KVNamespace
): Promise<Response> {
  switch (request.method) {
    case "cache.list": {
      const result = await listAllCacheKeys(kv, request.prefix);
      return Response.json({ result });
    }

    case "cache.clear": {
      const result = await clearAllCache(kv, request.prefix);
      return Response.json({ result });
    }

    case "cache.invalidate": {
      if (!request.key) {
        return Response.json({ error: "key is required" }, { status: 400 });
      }
      await invalidateKey(kv, request.key);
      return Response.json({ result: { invalidated: request.key } });
    }

    default:
      return Response.json(
        { error: `Unknown cache method: ${(request as { method: string }).method}` },
        { status: 400 }
      );
  }
}
```

### Phase 5: DbRead Interface Extension

Add to `packages/web/src/lib/db.ts`:

```typescript
export interface DbRead {
  // ... existing methods ...

  // ---------------------------------------------------------------------------
  // Cache management (admin only)
  // ---------------------------------------------------------------------------

  /** List all cache keys */
  getCacheKeys(prefix?: string): Promise<{
    keys: string[];
    truncated: boolean;
    count: number;  // Number of keys returned, not total in KV
  }>;

  /** Clear all cache entries */
  clearCache(prefix?: string): Promise<{
    deleted: number;
    truncated: boolean;  // true if more keys remain after hitting limit
  }>;

  /** Invalidate a single cache key */
  invalidateCacheKey(key: string): Promise<void>;
}
```

Add to `packages/web/src/lib/db-worker.ts`:

```typescript
async getCacheKeys(prefix?: string): Promise<{
  keys: string[];
  truncated: boolean;
  count: number;
}> {
  return rpc<{ keys: string[]; truncated: boolean; count: number }>({
    method: "cache.list",
    prefix,
  });
},

async clearCache(prefix?: string): Promise<{
  deleted: number;
  truncated: boolean;
}> {
  return rpc<{ deleted: number; truncated: boolean }>({
    method: "cache.clear",
    prefix,
  });
},

async invalidateCacheKey(key: string): Promise<void> {
  await rpc<{ invalidated: string }>({
    method: "cache.invalidate",
    key,
  });
},
```

### Phase 6: Worker Router Update

Update `packages/worker-read/src/index.ts`:

```typescript
import { handleCacheRpc, type CacheRpcRequest } from "./rpc/cache";

export type RpcRequest =
  | UsersRpcRequest
  | ProjectsRpcRequest
  // ... existing types ...
  | CacheRpcRequest;  // NEW

async function handleRpc(body: unknown, env: Env): Promise<Response> {
  // ...
  const domain = method.split(".")[0];

  try {
    switch (domain) {
      // ... existing domains ...

      case "cache":
        return handleCacheRpc(body as CacheRpcRequest, env.CACHE);

      // Pass KV to domains that use caching
      case "pricing":
        return handlePricingRpc(body as PricingRpcRequest, env.DB, env.CACHE);
      case "seasons":
        return handleSeasonsRpc(body as SeasonsRpcRequest, env.DB, env.CACHE);
      case "leaderboard":
        return handleLeaderboardRpc(body as LeaderboardRpcRequest, env.DB, env.CACHE);

      // ... other domains (no KV) ...
    }
  }
  // ...
}
```

### Phase 7: Admin Storage Page Enhancement

**API Route** (`/api/admin/storage/cache/route.ts`):

```typescript
import { NextResponse } from "next/server";
import { resolveAdmin } from "@/lib/admin";
import { getDbRead } from "@/lib/db";

export async function GET(request: Request) {
  const admin = await resolveAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = await getDbRead();
  const result = await db.getCacheKeys();

  return NextResponse.json(result);
}

export async function DELETE(request: Request) {
  const admin = await resolveAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const prefix = searchParams.get("prefix") ?? undefined;

  const db = await getDbRead();
  const result = await db.clearCache(prefix);

  return NextResponse.json(result);
}
```

**UI Component** (add to `admin/storage/page.tsx`):

```tsx
function KVCacheCard() {
  const [keys, setKeys] = useState<string[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/storage/cache");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setKeys(data.keys);
      setTruncated(data.truncated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleClear = async () => {
    if (!confirm("Clear all cache entries? This cannot be undone.")) return;
    setClearing(true);
    try {
      const res = await fetch("/api/admin/storage/cache", { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      alert(`Deleted ${result.deleted} keys${result.truncated ? " (limit reached, run again)" : ""}`);
      await fetchKeys();
    } catch (err) {
      alert(`Failed to clear: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setClearing(false);
    }
  };

  if (loading) return <Skeleton className="h-48" />;

  return (
    <div className="rounded-xl bg-secondary p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium">KV Cache</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Edge cache for public, read-heavy data
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleClear}
          disabled={clearing || keys.length === 0}
        >
          {clearing ? "Clearing..." : "Clear All"}
        </Button>
      </div>

      {error && (
        <div className="text-sm text-destructive">{error}</div>
      )}

      {/* Key count */}
      <div className="rounded-lg bg-background p-3">
        <p className="text-xs text-muted-foreground">Cached Keys</p>
        <p className="text-lg font-semibold tabular-nums">
          {keys.length.toLocaleString()}
          {truncated && <span className="text-muted-foreground text-sm ml-1">(limit reached)</span>}
        </p>
      </div>

      {/* Key list (collapsible) */}
      {keys.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            View keys ({keys.length.toLocaleString()})
          </summary>
          <ul className="mt-2 space-y-1 max-h-48 overflow-y-auto font-mono text-xs bg-background rounded-lg p-2">
            {keys.map((key) => (
              <li key={key} className="text-muted-foreground truncate">
                {key}
              </li>
            ))}
          </ul>
          {truncated && (
            <p className="text-xs text-muted-foreground mt-2">
              More keys exist beyond the 10,000 limit
            </p>
          )}
        </details>
      )}

      {keys.length === 0 && !error && (
        <p className="text-sm text-muted-foreground">No cached keys</p>
      )}
    </div>
  );
}
```

---

## Key Naming Convention

| Cache Target | Key Pattern | Example |
|--------------|-------------|---------|
| Pricing | `pricing:all` | `pricing:all` |
| Season snapshots | `season:{id}:snapshots` | `season:abc123:snapshots` |
| Season list | `seasons:list` | `seasons:list` |
| Public leaderboard | `lb:global:{from}:{source}:{model}:{limit}:{offset}` | `lb:global:_:_:_:50:0` |

**Rules**:
- Use `:` as separator
- Use `_` for null/undefined params
- **Never include `teamId` or `orgId` in leaderboard keys** — those requests are not cached

---

## Cache Invalidation Strategy

| Scenario | Strategy |
|----------|----------|
| Pricing updated (admin) | Manual clear via admin UI |
| Season snapshot generated | Automatic via TTL (24h) |
| Season created/ended | Automatic via TTL (5min) |
| Leaderboard data changes | Automatic via TTL (5min) |

**No proactive invalidation in v1** — TTL-based expiry is sufficient given data change frequency.

---

## Testing

### Unit Tests

```typescript
// packages/worker-read/src/cache.test.ts

describe("withCache", () => {
  it("returns cached data on hit", async () => {
    const kv = createMockKV({ "test:key": { value: 42 } });
    const fetcher = vi.fn().mockResolvedValue({ value: 99 });

    const result = await withCache(kv, "test:key", fetcher, { ttlSeconds: 60 });

    expect(result.data).toEqual({ value: 42 });
    expect(result.cached).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("calls fetcher and writes on miss", async () => {
    const kv = createMockKV({});
    const fetcher = vi.fn().mockResolvedValue({ value: 99 });

    const result = await withCache(kv, "test:key", fetcher, { ttlSeconds: 60 });

    expect(result.data).toEqual({ value: 99 });
    expect(result.cached).toBe(false);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(kv.put).toHaveBeenCalledWith(
      "test:key",
      '{"value":99}',
      { expirationTtl: 60 }
    );
  });

  it("falls through on KV read error", async () => {
    const kv = createMockKV({});
    kv.get = vi.fn().mockRejectedValue(new Error("KV down"));
    const fetcher = vi.fn().mockResolvedValue({ value: 99 });

    const result = await withCache(kv, "test:key", fetcher, { ttlSeconds: 60 });

    expect(result.data).toEqual({ value: 99 });
    expect(result.cached).toBe(false);
  });

  it("returns data even when KV write fails", async () => {
    const kv = createMockKV({});
    kv.put = vi.fn().mockRejectedValue(new Error("KV write failed"));
    const fetcher = vi.fn().mockResolvedValue({ value: 99 });

    const result = await withCache(kv, "test:key", fetcher, { ttlSeconds: 60 });

    expect(result.data).toEqual({ value: 99 });
    expect(result.cached).toBe(false);
    // Write was attempted
    expect(kv.put).toHaveBeenCalled();
  });
});

describe("listAllCacheKeys", () => {
  it("paginates through all keys", async () => {
    const kv = createMockKVWithPagination([
      { keys: ["a", "b"], cursor: "page2" },
      { keys: ["c", "d"], cursor: "page3" },
      { keys: ["e"], complete: true },
    ]);

    const result = await listAllCacheKeys(kv);

    expect(result.keys).toEqual(["a", "b", "c", "d", "e"]);
    expect(result.truncated).toBe(false);
    expect(result.count).toBe(5);
  });

  it("truncates at MAX_KEYS_LIMIT", async () => {
    // Test with many pages
    // ...
  });
});

describe("clearAllCache", () => {
  it("deletes all keys with pagination", async () => {
    // ...
  });
});
```

### Integration Tests

**Note**: The `_cached` field is returned by worker-read RPC responses but is **not surfaced to Next.js API clients**. The `db-worker` adapter extracts only `body.result`, and API routes assemble their own response envelopes. This is intentional — cache observability is an internal concern, not part of the public API contract.

**Testing strategy**:
- **Unit tests**: Verify `withCache` behavior with mocked KV
- **Worker-level tests**: Hit worker-read RPC directly to verify `_cached` field
- **E2E tests**: Verify functional correctness (same data returned), not cache state

```typescript
// packages/worker-read/src/rpc/leaderboard.test.ts
// Test at worker RPC level where _cached is visible

describe("leaderboard.getGlobal caching", () => {
  it("caches public leaderboard", async () => {
    const kv = createMockKV({});
    const db = createMockDB();

    // First request - miss
    const req1 = { method: "leaderboard.getGlobal", limit: 10 };
    const res1 = await handleLeaderboardRpc(req1, db, kv);
    const json1 = await res1.json();
    expect(json1._cached).toBe(false);

    // Second request - hit
    const res2 = await handleLeaderboardRpc(req1, db, kv);
    const json2 = await res2.json();
    expect(json2._cached).toBe(true);
  });

  it("does NOT cache team-scoped leaderboard", async () => {
    const kv = createMockKV({});
    const db = createMockDB();

    const req1 = { method: "leaderboard.getGlobal", limit: 10, teamId: "team123" };
    const res1 = await handleLeaderboardRpc(req1, db, kv);
    const json1 = await res1.json();
    expect(json1._cached).toBe(false);

    // Second request - still not cached (private scope)
    const res2 = await handleLeaderboardRpc(req1, db, kv);
    const json2 = await res2.json();
    expect(json2._cached).toBe(false);
    
    // Verify KV was never written
    expect(kv.put).not.toHaveBeenCalled();
  });

  it("does NOT cache org-scoped leaderboard", async () => {
    const kv = createMockKV({});
    const db = createMockDB();

    const req = { method: "leaderboard.getGlobal", limit: 10, orgId: "org123" };
    const res = await handleLeaderboardRpc(req, db, kv);
    const json = await res.json();
    expect(json._cached).toBe(false);
    expect(kv.put).not.toHaveBeenCalled();
  });
});
```

---

## Cloudflare KV Limits (Free Tier)

| Resource | Limit | Expected Usage | OK? |
|----------|-------|----------------|-----|
| Reads/day | 100,000 | ~5,000 (100 users × 50 pageviews) | Yes |
| Writes/day | 1,000 | ~200 (cache misses) | Yes |
| Storage | 1GB | ~10MB (JSON payloads) | Yes |
| Key size | 512 bytes | ~100 bytes | Yes |
| Value size | 25MB | ~100KB max | Yes |

---

## Rollout Plan

1. **Create test KV namespace**: `wrangler kv:namespace create CACHE --env test`
2. **Update wrangler.toml**: Add test binding
3. **Implement & test locally**: Unit tests + manual verification
4. **Deploy worker-read**: `wrangler deploy`
5. **Monitor**: Check Cloudflare dashboard for KV metrics
6. **Verify admin UI**: List keys, clear cache

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Stale data shown | Short TTL (5min) for dynamic data, 24h only for frozen data |
| KV errors | `withCache` catches errors and falls back to D1 |
| Key explosion | Only cache aggregated/public data, strict scope check |
| Team/org data leaked | Explicit `hasPrivateScope` check, no caching for scoped requests |
| Admin clears at wrong time | Confirm dialog, cache rebuilds naturally via TTL |
| Stats misleading | No hit rate in UI, only observable facts (key count) |

---

## Future Work (Out of Scope for v1)

- **`achievements.getEarners` caching**: Requires stable query fingerprinting
- **Proactive invalidation**: Clear specific keys on write operations
- **Cache warming**: Pre-populate on deploy
- **Real analytics**: Use Cloudflare Analytics API for accurate hit rates
- **Per-key TTL visibility**: Show remaining TTL in admin UI

---

## Retrospective

### What Went Well

1. **Scope-aware caching worked cleanly**: The `hasPrivateScope = !!(req.teamId || req.orgId)` pattern made it trivial to skip caching for team/org-scoped requests without any complex logic.

2. **Conditional caching for frozen seasons**: The light query to check `snapshot_ready` before caching was simple to implement and keeps the caching logic honest about what's frozen vs. live.

3. **Paginated key management**: The cursor-based pagination with `truncated` flag provides honest feedback to admins about whether they've seen all keys or hit the limit.

4. **Test coverage was already in place**: The TDD approach meant all cache behaviors (hits, misses, error fallback, TTL values, scope checks) were verified before deployment.

### Lessons Learned

1. **API route imports**: Admin API routes should use `resolveAdmin()` from `@/lib/admin` rather than importing auth directly. The helper handles the full admin check flow and the import path is consistent with other admin routes.

2. **Cache key format stability**: The `lb:global:{from}:{source}:{model}:{limit}:{offset}` pattern with 5 colon-separated segments (after `lb:global:`) means tests need to account for empty segments rendering as `::` not single colons.

3. **Worker deployment is atomic with KV**: The KV binding was already configured in wrangler.toml for production, so deployment "just worked". For test environments, the binding needs explicit setup.

### Future Improvements

- **Cache warming on deploy**: Pre-populate pricing and frozen season snapshots immediately after deployment
- **TTL visibility in admin UI**: Show remaining TTL per key (requires storing metadata or using KV's `getWithMetadata`)
- **Proactive invalidation**: Clear specific cache keys when admin updates pricing or generates season snapshots
