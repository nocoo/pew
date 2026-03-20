# Worker Read Migration — D1 REST API → Worker Native Binding

> Migrate all D1 reads from the Cloudflare REST API (`api.cloudflare.com`)
> to a dedicated **pew** Worker with native D1 bindings, eliminating the
> cross-network REST bottleneck and achieving a uniform Worker-based data layer.

## Status

| # | Commit | Description | Status |
|---|--------|-------------|--------|
| 1 | `docs: add worker read migration plan` | This document | ✅ done |
| 2 | | Phase 1: extract `DbReader` interface + adapter | |
| 3 | | Phase 1: migrate all route files to `DbReader` | |
| 4 | | Phase 2: implement pew read Worker | |
| 5 | | Phase 2: Worker tests (≥ 95% coverage) | |
| 6 | | Phase 3: add `WorkerDbReader` adapter + dev switching | |
| 7 | | Phase 3: E2E validation against dev Worker | |
| 8 | | Phase 4: delete D1 REST client + env vars | |
| 9 | | docs: retrospective | |

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

### Current Read Surface

**27 API route files** + **1 SSR page** + **5 lib modules** call `getD1Client()`.
~63 call sites total. All SQL is constructed in the Next.js layer and sent
verbatim to `api.cloudflare.com/client/v4/accounts/{id}/d1/database/{id}/query`.

## Solution

Deploy a second Worker (**`pew`**) for reads. Writes stay on `pew-ingest`.

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

### Phase 1 — Extract `DbReader` Abstraction

> Goal: decouple all route files from `D1Client` without changing runtime behavior.

#### 1.1 Define `DbReader` Interface

Create `packages/web/src/lib/db-reader.ts`:

```typescript
export interface DbQueryResult<T = Record<string, unknown>> {
  results: T[];
  meta: { changes: number; duration: number };
}

export interface DbReader {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<DbQueryResult<T>>;

  firstOrNull<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T | null>;

  execute(
    sql: string,
    params?: unknown[],
  ): Promise<{ changes: number; duration: number }>;

  batch(
    statements: Array<{ sql: string; params?: unknown[] }>,
  ): Promise<void>;
}
```

#### 1.2 Implement `RestDbReader`

Wrap the existing `D1Client` behind the `DbReader` interface:

```typescript
// packages/web/src/lib/db-reader-rest.ts
import { getD1Client } from "./d1";
import type { DbReader } from "./db-reader";

export function createRestDbReader(): DbReader {
  const client = getD1Client();
  return {
    query: (sql, params) => client.query(sql, params ?? []),
    firstOrNull: (sql, params) => client.firstOrNull(sql, params ?? []),
    execute: (sql, params) => client.execute(sql, params ?? []),
    batch: (stmts) => client.batch(stmts),
  };
}
```

#### 1.3 Provide Singleton via `getDbReader()`

```typescript
// packages/web/src/lib/db-reader.ts (extended)

let _reader: DbReader | undefined;

export function getDbReader(): DbReader {
  if (!_reader) {
    // Phase 1: REST adapter. Phase 3: swap to Worker adapter.
    const { createRestDbReader } = require("./db-reader-rest");
    _reader = createRestDbReader();
  }
  return _reader;
}
```

#### 1.4 Migrate All Call Sites

Replace every `getD1Client()` call with `getDbReader()`:

```diff
- import { getD1Client } from "@/lib/d1";
+ import { getDbReader } from "@/lib/db-reader";

- const client = getD1Client();
- const result = await client.query<Row>(sql, params);
+ const db = getDbReader();
+ const result = await db.query<Row>(sql, params);
```

**Files to migrate** (~33 files, ~63 call sites):

| Category | Files | Call Sites |
|----------|-------|------------|
| API routes — dashboard/usage | 4 | ~8 |
| API routes — public (leaderboard, profile, pricing, seasons) | 6 | ~10 |
| API routes — auth/settings | 5 | ~10 |
| API routes — teams | 5 | ~10 |
| API routes — admin | 7 | ~15 |
| Lib modules (auth, auth-adapter, auth-helpers, invite, admin, season-roster) | 6 | ~8 |
| SSR page (`/u/[slug]`) | 1 | ~2 |

#### 1.5 Tests

- Existing tests should continue to pass (no behavior change).
- Add unit test for `RestDbReader` adapter.
- Verify `getDbReader()` returns singleton.

#### 1.6 Deliverable

At the end of Phase 1, the codebase compiles and all tests pass.
`getD1Client()` is only called inside `db-reader-rest.ts` — nowhere else.

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

> Goal: swap `getDbReader()` from REST to Worker, validate in dev.

#### 3.1 Implement `WorkerDbReader`

```typescript
// packages/web/src/lib/db-reader-worker.ts
import type { DbReader, DbQueryResult } from "./db-reader";

export function createWorkerDbReader(): DbReader {
  const url = process.env.WORKER_READ_URL;    // e.g. https://pew.<id>.workers.dev
  const secret = process.env.WORKER_READ_SECRET;

  if (!url || !secret) {
    throw new Error("WORKER_READ_URL and WORKER_READ_SECRET are required");
  }

  async function query<T>(sql: string, params?: unknown[]): Promise<DbQueryResult<T>> {
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
      throw new Error((body as { error?: string }).error ?? `Worker returned ${res.status}`);
    }

    return res.json() as Promise<DbQueryResult<T>>;
  }

  return {
    query,
    firstOrNull: async (sql, params) => {
      const result = await query(sql, params);
      return (result.results[0] as T | undefined) ?? null;
    },
    execute: async (sql, params) => {
      // Writes still go through pew-ingest or D1 REST (Phase 4 cleanup)
      throw new Error("WorkerDbReader is read-only; writes should use pew-ingest");
    },
    batch: async () => {
      throw new Error("WorkerDbReader is read-only; batch writes should use pew-ingest");
    },
  };
}
```

#### 3.2 Switch `getDbReader()` Factory

```typescript
export function getDbReader(): DbReader {
  if (!_reader) {
    if (process.env.WORKER_READ_URL) {
      const { createWorkerDbReader } = require("./db-reader-worker");
      _reader = createWorkerDbReader();
    } else {
      const { createRestDbReader } = require("./db-reader-rest");
      _reader = createRestDbReader();
    }
  }
  return _reader;
}
```

**Switching logic**: if `WORKER_READ_URL` is set → Worker; otherwise → REST fallback.
This allows gradual rollout and instant rollback by removing the env var.

#### 3.3 Handle Remaining Write Calls

Audit shows a few `getD1Client()` call sites that do `execute()` (writes):
- `auth.ts` — invite code consumption
- `auth-adapter.ts` — user CRUD for NextAuth
- Various admin routes — season CRUD, settings, etc.

These write paths can't go through the read-only Worker.
Options (in migration order):

1. **Phase 3**: keep a separate `getD1WriteClient()` for writes
   using the existing REST API — only ~5 files need it.
2. **Future**: migrate these writes to `pew-ingest` Worker with new endpoints.

#### 3.4 Dev Testing Checklist

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

| Page | Check |
|------|-------|
| Dashboard `/` | Usage chart loads |
| By-device `/by-device` | Device breakdown loads |
| Sessions `/sessions` | Session list loads |
| Leaderboard `/leaderboard` | Public rankings load |
| Season detail `/leaderboard/seasons/*` | Teams + countdown load |
| User profile `/u/*` | SSR profile renders |
| Admin `/admin/*` | All admin pages load |
| Settings `/settings` | User settings load |
| Teams `/teams/*` | Team pages load |
| Login `/login` | Auth flow works |
| CLI sync | `pew sync --dev` completes |

#### 3.5 Performance Comparison

Expected improvement (per query):

| Metric | REST API | Worker | Improvement |
|--------|----------|--------|-------------|
| Latency (Railway → Cloudflare) | ~50-150ms | ~15-30ms | 3-5x |
| Auth overhead | Full token validation | Simple secret check | Minimal |
| Network hops | 2 (Railway → CF API → D1) | 1 (Railway → Worker/D1) | 1 fewer |
| Failure mode | `fetch failed` on blips | More resilient (same CF network) | Stability ↑ |

---

### Phase 4 — Cleanup

> Goal: remove dead code and unused dependencies.

#### 4.1 Delete

| File | Reason |
|------|--------|
| `packages/web/src/lib/d1.ts` | Replaced by `db-reader-worker.ts` |
| `packages/web/src/lib/db-reader-rest.ts` | No longer needed after Worker switch |

#### 4.2 Remove Env Vars

Remove from Railway / `.env.local`:

| Var | Reason |
|-----|--------|
| `CF_ACCOUNT_ID` | Only used by D1 REST client |
| `CF_D1_API_TOKEN` | Only used by D1 REST client |
| `CF_D1_DATABASE_ID` | Only used by D1 REST client |

Keep (new):

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
                    Native D1     Native D1
                    Binding       Binding
                           │           │
                    ┌──────┴──┐  ┌─────┴──────────┐
                    │ Worker  │  │    Worker       │
                    │ pew-    │  │    pew          │
                    │ ingest  │  │                 │
                    │         │  │  POST /query    │
                    │ WRITES  │  │  GET  /live     │
                    │         │  │                 │
                    │ POST    │  │  READS ONLY     │
                    │ /ingest │  │  (rejects       │
                    │ /tokens │  │   INSERT/UPDATE │
                    │ /ingest │  │   /DELETE/DROP) │
                    │ /sessions  │                 │
                    └────┬────┘  └────────┬────────┘
                    Bearer            Bearer
                    WORKER_           WORKER_READ_
                    SECRET            SECRET
                         │                 │
                    ┌────┴─────────────────┴────┐
                    │    Next.js (Railway)       │
                    │                            │
                    │  DbReader interface        │
                    │    → WorkerDbReader        │
                    │                            │
                    │  writes → pew-ingest       │
                    │  reads  → pew              │
                    └────────────┬───────────────┘
                                 │
                            Bearer pk_*
                                 │
                         ┌───────┴───────┐
                         │  CLI (pew)    │
                         └───────────────┘
```

## Rollback

At any phase, rollback is trivial:

- **Phase 1**: revert `getDbReader()` → `getD1Client()` (find-replace)
- **Phase 3**: unset `WORKER_READ_URL` → auto-falls back to REST adapter
- **Phase 4**: if REST code is already deleted, redeploy previous commit

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
