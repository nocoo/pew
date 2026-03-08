# Worker Ingest Migration Plan

> Migrate the ingest D1 writes from REST API (60 sequential HTTP calls) to a
> Cloudflare Worker with native D1 bindings (`env.DB.batch()`).

## Status

| # | Commit | Description | Status |
|---|--------|-------------|--------|
| 1 | `docs: add worker ingest migration plan` | This document | ✅ done |
| 2 | `chore: add packages/worker workspace with wrangler config` | Scaffold worker package | ✅ done |
| 3 | `feat: implement worker ingest endpoint with batch D1` | Worker entry point | ✅ done |
| 4 | `test: add L1 unit tests for worker ingest` | Worker tests | ✅ done |
| 5 | `refactor: replace D1 REST API with worker proxy in ingest route` | Next.js route rewrite | ✅ done |
| 6 | `test: rewrite ingest route tests for worker proxy` | Ingest test rewrite | ✅ done |
| 7 | `feat: reduce CLI batch size from 300 to 50` | CLI + server limit change | ✅ done |
| 8 | `docs: update CLAUDE.md retrospective` | Lessons learned | pending |

## Problem

The current ingest pipeline uses the **Cloudflare D1 REST API** from Next.js on
Railway. For a batch of N records, the server must make `ceil(N / 5)` sequential
HTTP round-trips to `api.cloudflare.com`. With the max batch of 300 records,
that is **60 HTTP calls** taking 3-6 seconds.

```
CLI ──POST /api/ingest (≤300)──→ Next.js (Railway)
     → for (i=0; i<60; i++) {
         buildMultiRowUpsert(5 rows)
         fetch → D1 REST API               ← 60x cross-network HTTP
       }
```

### Root Causes

| Issue | Impact |
|-------|--------|
| D1 REST API has no batch endpoint | `d1.ts` `batch()` is a fake loop |
| REST API rejects multi-row INSERT beyond ~5-7 rows | Forces `CHUNK_SIZE=5` |
| No transaction wrapping | Partial failures leave inconsistent state |
| SQLite param limit 999 (not 3400 as originally assumed) | Further constrains chunk size |

## Solution

Deploy a lightweight **Cloudflare Worker** (`zebra-ingest`) that uses **native
D1 bindings** to perform batch upserts. Next.js delegates writes to this Worker
via a single HTTP call.

```
CLI ──POST /api/ingest (≤50)──→ Next.js (Railway)
     → resolveUser() (unchanged)
     → validate records (unchanged)
     → single fetch → Worker (Cloudflare)      ← 1x cross-network HTTP
         → env.DB.batch([                       ← native FFI, zero network
             prepare(UPSERT).bind(...) × 50
           ])
         → implicit transaction, atomic commit
```

### Why 50?

D1 Free plan limits: **50 queries per Worker invocation**. Each prepared
statement in `db.batch()` counts as one query. With 50 records × 1
statement/record = 50 queries, we stay exactly within the free tier limit.

The CLI's `aggregateRecords()` deduplicates by `(source, model, hour_start)`,
so a typical sync produces far fewer than 50 unique records. If aggregated
records exceed 50, the CLI automatically sends multiple HTTP batches.

## Free Tier Budget

| Resource | Free Limit | Zebra Estimate | OK? |
|----------|-----------|---------------|-----|
| Worker requests | 100K/day | ~tens/day | yes |
| Worker CPU | 10ms/invocation | batch 50 → ~1-2ms | yes |
| D1 queries/invocation | **50** | 50 statements | yes |
| D1 rows written | 100K/day | 50 × few batches/day | yes |
| D1 bound params/query | 100 | 9 params/stmt | yes |
| D1 storage | 5 GB | tiny | yes |

## Architecture

### New Package: `packages/worker/`

```
packages/worker/
├── package.json           # @zebra/worker, wrangler devDep
├── wrangler.toml          # Worker config + D1 binding
├── tsconfig.json
└── src/
    ├── index.ts           # Worker entry: POST /ingest → batch upsert
    └── index.test.ts      # L1 unit tests (mock env.DB)
```

### Worker API

```
POST /ingest
Headers:
  Authorization: Bearer <WORKER_SECRET>

Body:
{
  "userId": "uuid",
  "records": [
    {
      "source": "claude-code",
      "model": "opus-4",
      "hour_start": "2026-03-08T10:00:00",
      "input_tokens": 1000,
      "cached_input_tokens": 200,
      "output_tokens": 500,
      "reasoning_output_tokens": 100,
      "total_tokens": 1800
    }
  ]
}

Responses:
  200: { "ingested": 50 }
  400: { "error": "Invalid request body" }
  401: { "error": "Unauthorized" }
  405: { "error": "Method not allowed" }
  500: { "error": "<D1 error message>" }
```

### Worker Implementation

- **Auth**: shared secret via `env.WORKER_SECRET` (set with `wrangler secret put`)
- **Validation**: lightweight — checks userId present, records is non-empty array, length ≤ 50
- **SQL**: single prepared statement reused via `env.DB.prepare(UPSERT).bind(...)`
- **Execution**: `env.DB.batch(stmts)` — native binding, implicit transaction
- **Upsert**: same `ON CONFLICT (user_id, source, model, hour_start) DO UPDATE SET` semantics

### Next.js Ingest Route Changes

**Removed**:
- `CHUNK_SIZE` constant
- `buildMultiRowUpsert()` function
- `getD1Client()` usage in ingest route
- D1 chunking for-loop

**Added**:
- `fetch(WORKER_INGEST_URL)` with shared secret
- New env vars: `WORKER_INGEST_URL`, `WORKER_SECRET`

**Unchanged**:
- `resolveUser()` authentication
- Request validation (source, model, hour_start, token fields)
- Response format `{ ingested: N }`

### CLI Changes

`packages/cli/src/commands/upload.ts`:
- `DEFAULT_BATCH_SIZE`: 300 → 50
- Server-side max also 300 → 50
- All other logic (aggregation, retry, offset) unchanged

### Unaffected Files

- `packages/web/src/lib/d1.ts` — still used by read routes (usage, leaderboard, etc.)
- `packages/web/src/lib/auth-helpers.ts` — auth unchanged
- All other API routes — read-only, still use REST API
- `packages/core/*` — pure types
- CLI upload structure — only batch size constant changes

## Commits

### Commit 1: `docs: add worker ingest migration plan`

Files: `docs/02-worker-ingest.md`

### Commit 2: `chore: add packages/worker workspace with wrangler config`

Files:
- `package.json` (root) — add `packages/worker` to workspaces (if needed)
- `packages/worker/package.json`
- `packages/worker/wrangler.toml`
- `packages/worker/tsconfig.json`

### Commit 3: `feat: implement worker ingest endpoint with batch D1`

Files:
- `packages/worker/src/index.ts`

### Commit 4: `test: add L1 unit tests for worker ingest`

Files:
- `packages/worker/src/index.test.ts`

Test cases:
- Rejects non-POST methods (405)
- Rejects missing/wrong Authorization header (401)
- Rejects missing userId (400)
- Rejects empty records array (400)
- Rejects batch > 50 records (400)
- Constructs correct prepared statements and calls `env.DB.batch()`
- Returns `{ ingested: N }` on success
- Returns 500 on D1 error

### Commit 5: `refactor: replace D1 REST API with worker proxy in ingest route`

Files:
- `packages/web/src/app/api/ingest/route.ts`
- `packages/web/.env.example`

### Commit 6: `test: rewrite ingest route tests for worker proxy`

Files:
- `packages/web/src/__tests__/ingest.test.ts`

Changes:
- Remove `buildMultiRowUpsert` tests (function deleted)
- Remove `CHUNK_SIZE` import
- Mock `fetch` for Worker URL instead of `D1Client.execute`
- Keep all auth and validation tests unchanged

### Commit 7: `feat: reduce CLI batch size from 300 to 50`

Files:
- `packages/cli/src/commands/upload.ts` — `DEFAULT_BATCH_SIZE = 50`
- `packages/web/src/app/api/ingest/route.ts` — max records 300 → 50
- `packages/cli/src/__tests__/upload.test.ts` — update batch size assertions

### Commit 8: `docs: update CLAUDE.md retrospective`

Files:
- `CLAUDE.md` — add retrospective entry about Worker migration

## Performance Comparison

| Metric | Before | After |
|--------|--------|-------|
| Network calls (50 records) | 10× Railway→CF REST API | 1× Railway→Worker |
| DB operations | 10× independent INSERT | 1× batch (implicit txn) |
| Atomicity | No transaction | All-or-nothing |
| Latency (50 records) | ~500ms-1s | ~50-100ms |
| Latency (300 records, if needed) | ~3-6s (60 HTTP) | ~300-600ms (6 batches × 1 HTTP) |

## Rollback Plan

If the Worker has issues, revert the ingest route to use `D1Client` directly
with the old `CHUNK_SIZE=5` loop. The CLI batch size can remain at 50 since the
server-side validation is the bottleneck, not the CLI.

## Deployment

1. `wrangler secret put WORKER_SECRET` — set shared secret
2. `wrangler deploy` — deploy Worker to Cloudflare
3. Railway env vars: add `WORKER_INGEST_URL`, `WORKER_SECRET`
4. Deploy Next.js to Railway
5. Publish new CLI version with `DEFAULT_BATCH_SIZE=50`
