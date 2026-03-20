# Worker Read Migration — D1 REST API → Worker Native Binding

> Migrate all D1 reads from the Cloudflare REST API (`api.cloudflare.com`)
> to a dedicated **pew** Worker with native D1 bindings, eliminating the
> cross-network REST bottleneck and achieving a uniform Worker-based data layer.

## Status

| # | Commit | Description | Status |
|---|--------|-------------|--------|
| 1 | `docs: add worker read migration plan` | This document | ✅ done |
| 2 | | Phase 1: define `DbRead` / `DbWrite` interfaces + `RestDbRead` adapter | |
| 3 | | Phase 1: migrate read-only files to `getDbRead()` | |
| 4 | | Phase 1: migrate mixed read+write files to `getDbRead()` + `getDbWrite()` | |
| 5 | | Phase 2: implement pew read Worker | |
| 6 | | Phase 2: Worker tests (≥ 95% coverage) | |
| 7 | | Phase 3: add `WorkerDbRead` adapter + dev switching | |
| 8 | | Phase 3: E2E validation against dev Worker | |
| 9 | | Phase 4: delete `RestDbRead` + REST-only env vars | |
| 10 | | docs: retrospective | |

## Problem

The Next.js app (Railway) reads D1 through the **Cloudflare REST API**:

```
Next.js (Railway) ──POST /query──→ api.cloudflare.com ──→ D1
                    ^                ^
                    HTTPS            token auth
                    ~50-150ms RTT    rate limited
```

### Pain Points

| Issue | Impact |
|-------|--------|
| Every read = full HTTPS round-trip to `api.cloudflare.com` | ~50-150ms latency per query |
| REST API rate limits | Risk of 429 under load |
| `fetch failed` errors on network blips | Dashboard shows "Failed to load" |
| No batch read support | `D1Client.batch()` is a serial loop |
| 3 env vars just for reads (`CF_ACCOUNT_ID`, `CF_D1_DATABASE_ID`, `CF_D1_API_TOKEN`) | Config sprawl |
| Write path already uses Worker binding | Architectural inconsistency |

### Current D1 Surface (Audited)

**37 production files** with **58 `getD1Client()` call sites** (excluding tests and `d1.ts` itself):

| Category | Files | Read-Only | Read+Write |
|----------|-------|-----------|------------|
| API routes — dashboard/usage | 4 | 4 | 0 |
| API routes — public (leaderboard, profile, pricing, seasons) | 7 | 5 | 2 |
| API routes — auth/settings | 5 | 1 | 4 |
| API routes — teams | 5 | 0 | 5 |
| API routes — admin | 7 | 3 | 4 |
| API routes — other (devices, budgets, projects) | 5 | 1 | 4 |
| Lib modules (auth, auth-adapter, auth-helpers, invite, admin) | 5 | 2 | 3 |
| SSR page (`/u/[slug]`) | 1 | 1 | 0 |
| **Total** | **37** (excl. d1.ts, tests) | **17** | **20** |

**Note**: `season-roster.ts` is excluded — it receives a `D1Client` parameter
from callers, it does not call `getD1Client()` itself. It will be migrated
separately when its callers (`admin/seasons/[id]/sync-rosters/route.ts`) are
updated to pass `DbRead`/`DbWrite` instead.

**Key insight**: 20 of 37 files do both reads AND writes (`query` + `execute`/`batch`).
A single "DbReader" abstraction that throws on writes would break these at runtime.

## Solution

Deploy a second Worker (**`pew`**) for reads. Writes stay on `pew-ingest`
(for CLI ingest) and on the **D1 REST API** (for web CRUD) until a future
migration moves all writes to Workers.

```
Next.js (Railway) ──POST /query──→ pew Worker (Cloudflare)
                    ^                 │
                    1x HTTPS          env.DB native binding
                    ~15-30ms          <1ms
                                      │
                                      ▼
                                   D1 (pew-db)
```

### Why a Separate Worker?

| Option | Pros | Cons |
|--------|------|------|
| Add read routes to `pew-ingest` | One Worker to manage | Mixes read/write concerns; harder to scale/rate-limit independently |
| New `pew` Worker for reads | Clean separation; independent deploy/scaling; name reflects scope | Two Workers to manage |

**Decision**: separate `pew` Worker. `pew-ingest` stays write-only.
The read Worker name is simply `pew` — it's the "main" gateway.

### Auth Model

The read Worker uses the same **shared secret** pattern as `pew-ingest`:

```
Authorization: Bearer <WORKER_READ_SECRET>
```

- `/live` — no auth (public health check)
- `POST /query` — requires `Bearer WORKER_READ_SECRET`

The Next.js app holds `WORKER_READ_SECRET` as an env var and sends
it on every request. User-level auth (`pk_*` API keys, session tokens)
remains in the Next.js layer — the Worker trusts the caller.

### Request/Response Contract

**Request** (`POST /query`):

```json
{
  "sql": "SELECT ... FROM usage_records WHERE user_id = ? AND ...",
  "params": ["usr_abc123", "2026-01-01"]
}
```

**Response** (success):

```json
{
  "results": [ { "source": "claude", "total_tokens": 42000 }, ... ],
  "meta": { "changes": 0, "duration": 1.2, "rows_read": 150 }
}
```

**Response** (error):

```json
{ "error": "D1 query failed: SQLITE_ERROR: ..." }
```

This mirrors the existing `D1Client.query()` return shape, making the
adapter swap trivial.

### Free Tier Budget

| Resource | Free Limit | pew Read Estimate | OK? |
|----------|-----------|-------------------|-----|
| Worker requests | 100K/day | ~hundreds/day (dashboard + leaderboard) | ✅ |
| Worker CPU | 10ms/invocation | Simple query passthrough ~1-2ms | ✅ |
| D1 rows read | 5M/day | ~tens of thousands | ✅ |

Combined with `pew-ingest` writes (~tens/day), total Worker usage
stays well within free tier.

---

## Phases

### Phase 1 — Extract Read/Write Abstractions

> Goal: introduce explicit `DbRead` / `DbWrite` interfaces so that
> read and write paths are decoupled at the type level. No runtime
> behavior change — both back onto `D1Client` via REST.

#### 1.1 Define Interfaces

Create `packages/web/src/lib/db.ts`:

```typescript
// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface DbQueryResult<T = Record<string, unknown>> {
  results: T[];
  meta: { changes: number; duration: number };
}

// ---------------------------------------------------------------------------
// Read interface — safe to swap out for Worker adapter
// ---------------------------------------------------------------------------

export interface DbRead {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<DbQueryResult<T>>;

  firstOrNull<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T | null>;
}

// ---------------------------------------------------------------------------
// Write interface — stays on REST API until future Worker migration
// ---------------------------------------------------------------------------

export interface DbWrite {
  execute(
    sql: string,
    params?: unknown[],
  ): Promise<{ changes: number; duration: number }>;

  batch(
    statements: Array<{ sql: string; params?: unknown[] }>,
  ): Promise<DbQueryResult[]>;
}
```

**Design rationale**:

- `DbRead` has only `query` and `firstOrNull` — no writes.
- `DbWrite` has only `execute` and `batch` — no reads.
- `batch` returns `Promise<DbQueryResult[]>` to match `D1Client.batch()`
  exactly — each statement produces `{ results, meta }`.
- No combined "DbReader" that includes write methods — this was the
  previous design's core flaw.

#### 1.2 Implement REST Adapters

```typescript
// packages/web/src/lib/db-rest.ts
import { getD1Client } from "./d1";
import type { DbRead, DbWrite } from "./db";

export function createRestDbRead(): DbRead {
  const client = getD1Client();
  return {
    query: <T>(sql: string, params?: unknown[]) =>
      client.query<T>(sql, params ?? []),
    firstOrNull: <T>(sql: string, params?: unknown[]) =>
      client.firstOrNull<T>(sql, params ?? []),
  };
}

export function createRestDbWrite(): DbWrite {
  const client = getD1Client();
  return {
    execute: (sql: string, params?: unknown[]) =>
      client.execute(sql, params ?? []),
    batch: (stmts: Array<{ sql: string; params?: unknown[] }>) =>
      client.batch(stmts),
  };
}
```

#### 1.3 Provide Singletons

```typescript
// packages/web/src/lib/db.ts (extended)

let _read: DbRead | undefined;
let _write: DbWrite | undefined;

export async function getDbRead(): Promise<DbRead> {
  if (!_read) {
    // Phase 1: REST adapter. Phase 3: swap to Worker adapter.
    const { createRestDbRead } = await import("./db-rest");
    _read = createRestDbRead();
  }
  return _read;
}

export async function getDbWrite(): Promise<DbWrite> {
  if (!_write) {
    // Stays on REST API. Future: migrate to pew-ingest Worker.
    const { createRestDbWrite } = await import("./db-rest");
    _write = createRestDbWrite();
  }
  return _write;
}
```

> **Why async?** The project uses ESM throughout (`packages/web/src` has zero
> `require()` calls). Lazy `await import()` achieves the same deferred loading
> as `require()` while staying consistent with the codebase's module style.
> Callers already `await` the query results, so adding `await` to the factory
> is a minimal diff:
> ```diff
> - const db = getDbRead();
> + const db = await getDbRead();
> ```

#### 1.4 Migrate Call Sites

**Two migration patterns** depending on file type:

**Pattern A — Read-only files** (17 files):

```diff
- import { getD1Client } from "@/lib/d1";
+ import { getDbRead } from "@/lib/db";

- const client = getD1Client();
- const result = await client.query<Row>(sql, params);
+ const db = await getDbRead();
+ const result = await db.query<Row>(sql, params);
```

**Pattern B — Mixed read+write files** (20 files):

```diff
- import { getD1Client } from "@/lib/d1";
+ import { getDbRead, getDbWrite } from "@/lib/db";

  export async function PUT(request: Request) {
-   const client = getD1Client();
+   const dbRead = await getDbRead();
+   const dbWrite = await getDbWrite();

    // reads use dbRead
-   const existing = await client.firstOrNull<Row>(selectSql, [id]);
+   const existing = await dbRead.firstOrNull<Row>(selectSql, [id]);

    // writes use dbWrite
-   await client.execute(updateSql, [name, id]);
+   await dbWrite.execute(updateSql, [name, id]);
  }
```

**Migration inventory** (37 files, 58 call sites):

| Pattern | Category | Files |
|---------|----------|-------|
| A (read-only) | Dashboard/usage routes | `usage/route.ts`, `usage/by-device/route.ts`, `sessions/route.ts`, `projects/timeline/route.ts` |
| A (read-only) | Public routes | `leaderboard/route.ts`, `users/[slug]/route.ts`, `pricing/route.ts`, `seasons/route.ts`, `seasons/[id]/leaderboard/route.ts` |
| A (read-only) | Admin read-only | `admin/check/route.ts`, `admin/storage/route.ts`, `admin/seasons/[id]/sync-rosters/route.ts` |
| A (read-only) | Auth verify | `auth/verify-invite/route.ts` |
| A (read-only) | Health | `live/route.ts` |
| A (read-only) | Lib read-only | `auth-helpers.ts`, `admin.ts` |
| A (read-only) | SSR | `u/[slug]/page.tsx` |
| B (mixed) | Auth/settings | `auth.ts`, `auth-adapter.ts`, `invite.ts`, `settings/route.ts`, `auth/cli/route.ts` |
| B (mixed) | Teams | all 5 team route files |
| B (mixed) | Admin write | `admin/invites/route.ts`, `admin/pricing/route.ts`, `admin/seasons/route.ts`, `admin/seasons/[id]/route.ts`, `admin/seasons/[id]/snapshot/route.ts`, `admin/settings/route.ts` |
| B (mixed) | Projects | `projects/route.ts`, `projects/[id]/route.ts` |
| B (mixed) | Other | `devices/route.ts`, `budgets/route.ts`, `seasons/[id]/register/route.ts` |

**Special case — `season-roster.ts`**: does not call `getD1Client()` directly;
receives `D1Client` as a parameter. Migrate its callers to pass `DbRead`/`DbWrite`
instead, then update the function signature. Handle in the same commit as its
caller (`admin/seasons/[id]/sync-rosters/route.ts`).

#### 1.5 Tests

- All existing tests must pass (zero behavior change).
- Add unit tests for `createRestDbRead()` and `createRestDbWrite()` adapters.
- Verify `getDbRead()` and `getDbWrite()` return singletons.

#### 1.6 Deliverable

At the end of Phase 1:
- `getD1Client()` is only called inside `db-rest.ts` (and transitively by `season-roster.ts` callers) — nowhere else.
- Every route file uses `getDbRead()` for SELECT, `getDbWrite()` for INSERT/UPDATE/DELETE.
- The type system enforces the split — you can't accidentally call `.execute()` on a `DbRead`.

---

### Phase 2 — Implement `pew` Read Worker

> Goal: deploy a production-ready read Worker with ≥ 95% test coverage.

#### 2.1 Scaffold `packages/worker-read/`

```
packages/worker-read/
├── package.json         # name: @pew/worker-read
├── wrangler.toml        # name: pew, D1 binding: DB
├── tsconfig.json
├── vitest.config.ts
├── src/
│   └── index.ts         # Worker entry
└── __tests__/
    └── index.test.ts
```

`wrangler.toml`:

```toml
name = "pew"
main = "src/index.ts"
compatibility_date = "2026-03-01"

[[d1_databases]]
binding = "DB"
database_name = "pew-db"
database_id = "5c00ebbf-a0ed-49d9-a64f-5712c272e96f"
```

#### 2.2 Worker Implementation

Routes:

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/live` | None | Health check + DB connectivity |
| `POST` | `/query` | `Bearer WORKER_READ_SECRET` | Execute read query |

`POST /query` handler:

```typescript
async function handleQuery(body: unknown, env: Env): Promise<Response> {
  if (typeof body !== "object" || body === null) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { sql, params } = body as { sql?: string; params?: unknown[] };

  if (typeof sql !== "string" || sql.trim().length === 0) {
    return Response.json({ error: "Missing or empty sql" }, { status: 400 });
  }

  // Safety: reject write statements
  const normalized = sql.trim().toUpperCase();
  if (/^(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|PRAGMA)\b/.test(normalized)) {
    return Response.json({ error: "Write queries not allowed" }, { status: 403 });
  }

  try {
    const stmt = env.DB.prepare(sql);
    const bound = Array.isArray(params) && params.length > 0
      ? stmt.bind(...params)
      : stmt;
    const result = await bound.all();

    return Response.json({
      results: result.results ?? [],
      meta: result.meta ?? { changes: 0, duration: 0 },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `D1 query failed: ${message}` }, { status: 500 });
  }
}
```

**Key safety guards:**
- Regex rejects write SQL (`INSERT`, `UPDATE`, `DELETE`, `DROP`, etc.)
- Shared secret auth prevents external access
- Read-only by design (no `execute` / `batch` endpoints)

#### 2.3 Test Coverage (≥ 95%)

Test matrix:

| Test | Description |
|------|-------------|
| `GET /live` | Returns 200 + version + DB status |
| `GET /live` | Returns 503 when DB is down |
| `POST /query` | Valid SELECT returns results + meta |
| `POST /query` | Parameterized query binds correctly |
| `POST /query` | Empty params array works |
| `POST /query` | Missing sql → 400 |
| `POST /query` | Empty sql → 400 |
| `POST /query` | Non-string sql → 400 |
| `POST /query` | INSERT rejected → 403 |
| `POST /query` | UPDATE rejected → 403 |
| `POST /query` | DELETE rejected → 403 |
| `POST /query` | DROP rejected → 403 |
| `POST /query` | D1 error → 500 |
| Auth | Missing Authorization → 401 |
| Auth | Wrong token → 401 |
| Auth | Valid token → passes |
| Auth | `/live` skips auth |
| Router | Unknown path → 404 |
| Router | GET on `/query` → 405 |

#### 2.4 Deploy

```bash
cd packages/worker-read
wrangler secret put WORKER_READ_SECRET   # shared secret
wrangler deploy
```

Verify:
```bash
curl https://pew.<account>.workers.dev/live
# → {"status":"ok","version":"1.0.0","db":{"connected":true,...}}
```

---

### Phase 3 — Switch Next.js to Worker Reader

> Goal: swap `getDbRead()` from REST to Worker, validate in dev.
> `getDbWrite()` stays on REST API unchanged.

#### 3.1 Implement `WorkerDbRead`

```typescript
// packages/web/src/lib/db-worker.ts
import type { DbRead, DbQueryResult } from "./db";

export function createWorkerDbRead(): DbRead {
  const url = process.env.WORKER_READ_URL;
  const secret = process.env.WORKER_READ_SECRET;

  if (!url || !secret) {
    throw new Error("WORKER_READ_URL and WORKER_READ_SECRET are required");
  }

  return {
    async query<T>(sql: string, params?: unknown[]): Promise<DbQueryResult<T>> {
      const res = await fetch(`${url}/query`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify({ sql, params: params ?? [] }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `Worker returned ${res.status}`
        );
      }

      return res.json() as Promise<DbQueryResult<T>>;
    },

    async firstOrNull<T>(sql: string, params?: unknown[]): Promise<T | null> {
      const result = await this.query<T>(sql, params);
      return result.results[0] ?? null;
    },
  };
}
```

**Note**: `WorkerDbRead` implements only `DbRead` (2 methods). It has no
`execute` or `batch` — those are on `DbWrite` which stays on REST.
No runtime throws needed.

#### 3.2 Switch `getDbRead()` Factory

```typescript
// packages/web/src/lib/db.ts (updated)

export async function getDbRead(): Promise<DbRead> {
  if (!_read) {
    if (process.env.WORKER_READ_URL) {
      const { createWorkerDbRead } = await import("./db-worker");
      _read = createWorkerDbRead();
    } else {
      const { createRestDbRead } = await import("./db-rest");
      _read = createRestDbRead();
    }
  }
  return _read;
}

// getDbWrite() is unchanged — always REST
```

**Switching logic**: if `WORKER_READ_URL` is set → Worker; otherwise → REST fallback.
This allows gradual rollout and instant rollback by removing the env var.

**`getDbWrite()` is unaffected** — it always uses `RestDbWrite` (D1 REST API).
Write path migration to Workers is out of scope for this doc.

#### 3.3 Dev Testing Checklist

```bash
# 1. Deploy worker-read to Cloudflare
cd packages/worker-read && wrangler deploy

# 2. Set env vars for dev
export WORKER_READ_URL=https://pew.<id>.workers.dev
export WORKER_READ_SECRET=<secret>

# 3. Start dev server
bun run --filter '@pew/web' dev

# 4. Verify every page
```

| Page | Check | Has writes? |
|------|-------|-------------|
| Dashboard `/` | Usage chart loads | No |
| By-device `/by-device` | Device breakdown loads | Yes (rename/delete) |
| Sessions `/sessions` | Session list loads | No |
| Leaderboard `/leaderboard` | Public rankings load | No |
| Season detail `/leaderboard/seasons/*` | Teams + countdown load | No |
| Season register `/leaderboard/seasons/*/register` | Register flow works | Yes (create team) |
| User profile `/u/*` | SSR profile renders | No |
| Admin `/admin/*` | All admin pages load + CRUD works | Yes |
| Settings `/settings` | User settings load + save works | Yes |
| Teams `/teams/*` | Team pages load + manage works | Yes |
| Projects `/projects/*` | Project CRUD works | Yes |
| Login `/login` | Auth flow works | Yes (user creation) |
| CLI sync | `pew sync --dev` completes | Yes (via pew-ingest) |

#### 3.4 Performance Comparison

Expected improvement (per query):

| Metric | REST API | Worker | Improvement |
|--------|----------|--------|-------------|
| Latency (Railway → Cloudflare) | ~50-150ms | ~15-30ms | 3-5x |
| Auth overhead | Full token validation | Simple secret check | Minimal |
| Network hops | 2 (Railway → CF API → D1) | 1 (Railway → Worker/D1) | 1 fewer |
| Failure mode | `fetch failed` on blips | More resilient (same CF network) | Stability ↑ |

---

### Phase 4 — Cleanup

> Goal: remove REST **read** adapter and related env vars.
> REST **write** adapter (`RestDbWrite`) stays — it's still needed.

#### 4.1 Delete

| File | Reason |
|------|--------|
| `packages/web/src/lib/db-rest.ts` → **`createRestDbRead()` only** | Replaced by `WorkerDbRead` |

**Keep** (still needed for writes):
- `packages/web/src/lib/d1.ts` — `D1Client` class, used by `RestDbWrite`
- `packages/web/src/lib/db-rest.ts` → `createRestDbWrite()` — wraps `D1Client` for writes

`db-rest.ts` can be renamed to `db-write-rest.ts` for clarity, with
`createRestDbRead()` deleted from it.

#### 4.2 Remove Env Vars

**Cannot remove yet** — all 3 CF env vars are still needed by `RestDbWrite`:

| Var | Still needed? | Reason |
|-----|---------------|--------|
| `CF_ACCOUNT_ID` | ✅ Yes | `D1Client` constructor (used by writes) |
| `CF_D1_API_TOKEN` | ✅ Yes | `D1Client` constructor (used by writes) |
| `CF_D1_DATABASE_ID` | ✅ Yes | `D1Client` constructor (used by writes) |

These env vars can only be removed when writes are also migrated to a Worker
(future scope, not part of this doc).

**Add** (new):

| Var | Purpose |
|-----|---------|
| `WORKER_READ_URL` | pew read Worker URL |
| `WORKER_READ_SECRET` | Shared secret for read Worker |

#### 4.3 Update Docs

- Update `CLAUDE.md` CLI dev workflow section
- Update architecture diagrams
- Add retrospective entry

---

## Final Architecture

```
                    ┌──────────────────────────────┐
                    │        Cloudflare D1          │
                    │         (pew-db)              │
                    └──────┬───────────┬────────────┘
                           │           │
                    Native D1     D1 REST API  ◄── writes only (future: migrate)
                    Binding       POST /query
                           │           │
                    ┌──────┴──┐        │
                    │ Workers │        │
                    │         │        │
                    │ pew     │        │
                    │ (read)  │        │
                    │ POST    │        │
                    │ /query  │        │
                    │         │        │
                    │ pew-    │        │
                    │ ingest  │        │
                    │ (write) │        │
                    │ POST    │        │
                    │ /ingest │        │
                    └────┬────┘        │
                    Bearer         Bearer CF_D1_API_TOKEN
                    secrets            │
                         │             │
                    ┌────┴─────────────┴───────────┐
                    │    Next.js (Railway)          │
                    │                               │
                    │  DbRead interface             │
                    │    → WorkerDbRead (via pew)   │
                    │                               │
                    │  DbWrite interface            │
                    │    → RestDbWrite (via REST)   │
                    │                               │
                    │  token/session ingest          │
                    │    → pew-ingest Worker         │
                    └────────────┬──────────────────┘
                                 │
                            Bearer pk_*
                                 │
                         ┌───────┴───────┐
                         │  CLI (pew)    │
                         └───────────────┘
```

## Rollback

At any phase, rollback is trivial:

- **Phase 1**: revert `getDbRead()`/`getDbWrite()` → `getD1Client()` (find-replace)
- **Phase 3**: unset `WORKER_READ_URL` → auto-falls back to `RestDbRead`
- **Phase 4**: if `RestDbRead` is already deleted, redeploy previous commit

The `WORKER_READ_URL` env var acts as the feature flag: present = Worker,
absent = REST fallback.

## Risks

| Risk | Mitigation |
|------|------------|
| Worker free tier limits | Read volume is low (~hundreds/day); monitor via CF dashboard |
| SQL injection via `/query` | Worker is behind shared secret; only Next.js can call it; SQL is constructed server-side |
| Worker downtime | `/live` health check; fallback to REST by removing env var |
| Complex queries timing out | D1 Worker CPU limit is 10ms; current queries are simple aggregations well within limit |
| Write leak through read Worker | Regex guard rejects `INSERT`/`UPDATE`/`DELETE`/`DROP`/`ALTER`/`CREATE`/`PRAGMA` |

## Future Work (Out of Scope)

- **Migrate writes to Worker**: move `DbWrite` from D1 REST API to `pew-ingest`
  or a new `pew-write` Worker. Only then can `CF_ACCOUNT_ID`, `CF_D1_API_TOKEN`,
  `CF_D1_DATABASE_ID` be removed.
- **Edge caching**: add Cloudflare Cache API in the read Worker for
  frequently-accessed queries (leaderboard, public profiles).
