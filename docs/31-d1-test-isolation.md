# 31 — D1 Test Isolation (Quality System → Tier S)

> Add the D1 Test Isolation dimension to complete the six-dimension quality system, upgrading pew from Tier B to Tier S.

## Context

doc 30 upgraded five dimensions (L1+L2+L3+G1+G2), but the sixth — **D1 Test Isolation** — was left at ❌. Per the quality system rules, D1 is a **Tier A prerequisite**: without it, the project caps at Tier B regardless of other dimensions.

Currently **all E2E tests directly hit the production D1 database** (`pew-db`, ID `5c00ebbf-...`). The API E2E suite both reads AND writes (seed user, ingest records, create API keys, cleanup). This violates the core D1 principle: "E2E 测试必须物理隔离于生产资源".

pew is a **Variant B: External Application** (Next.js on Railway, connecting to Cloudflare D1 via HTTP API + Workers). It has 2 Workers:
- `pew-ingest` (writes) → `WORKER_INGEST_URL` / `WORKER_SECRET`
- `pew` (reads) → `WORKER_READ_URL` / `WORKER_READ_SECRET`

### Target State

| Dimension | Before | After |
|-----------|--------|-------|
| D1 Test Isolation | ❌ E2E hits prod D1 | ✅ E2E hits `pew-db-test` via test Workers |
| **Tier** | **B** | **S** (all 6 dimensions green) |

---

## Architecture: Test Resource Topology

```
Production (unchanged)
┌──────────────────────────────────────────────┐
│  pew-db (5c00ebbf-...)                       │
│  ├── pew-ingest Worker (/ingest)             │
│  └── pew Worker (/api/query)                 │
└──────────────────────────────────────────────┘

Test (new)
┌──────────────────────────────────────────────┐
│  pew-db-test (new D1 database)               │
│  ├── pew-ingest-test Worker (/ingest)        │
│  ├── pew-test Worker (/api/query)            │
│  └── _test_marker table (env='test')         │
└──────────────────────────────────────────────┘

E2E Runner (modified)
┌──────────────────────────────────────────────┐
│  run-e2e.ts / run-e2e-ui.ts                  │
│  1. Load .env.test (test D1 + Worker creds)  │
│  2. Verify test DB ID ≠ prod DB ID           │
│  3. Verify test Worker URLs ≠ prod URLs      │
│  4. Verify _test_marker in test DB           │
│  5. Override env vars → test resources        │
│  6. Run tests                                │
└──────────────────────────────────────────────┘
```

### Env Var Mapping

| Purpose | Prod Var (`.env.local`) | Test Var (`.env.test`) |
|---------|------------------------|----------------------|
| D1 direct access | `CF_D1_DATABASE_ID` | `CF_D1_DATABASE_ID_TEST` |
| Worker ingest | `WORKER_INGEST_URL` | `WORKER_INGEST_URL_TEST` |
| Worker read | `WORKER_READ_URL` | `WORKER_READ_URL_TEST` |
| Worker secrets | `WORKER_SECRET` / `WORKER_READ_SECRET` | Same secrets (shared) |

---

## Implementation — 7 Atomic Commits

### Commit 1: `docs: add D1 test isolation upgrade plan (doc 31)` ✅

Create `docs/31-d1-test-isolation.md` (this document). Update `docs/README.md` index.

**Files:**
- `docs/31-d1-test-isolation.md` (new)
- `docs/README.md` (add row)

---

### Commit 2: `chore: create test D1 database and deploy test Workers`

Manual Cloudflare operations (executed via `wrangler` CLI), then committed config changes.

**Step 2a — Create test D1 database:**
```bash
cd packages/worker
npx wrangler d1 create pew-db-test
# → Records the database_id
```

**Step 2b — Apply schema to test DB:**

Export schema from prod (data-free) and apply to test:
```bash
npx wrangler d1 export pew-db --remote --output=/tmp/prod-schema.sql --no-data
npx wrangler d1 execute pew-db-test --remote --file /tmp/prod-schema.sql
```

**Step 2c — Insert `_test_marker`:**
```bash
npx wrangler d1 execute pew-db-test --remote --command "
  CREATE TABLE IF NOT EXISTS _test_marker (key TEXT PRIMARY KEY, value TEXT);
  INSERT OR REPLACE INTO _test_marker (key, value) VALUES ('env', 'test');
"
```

**Step 2d — Add `[env.test]` to both Workers:**

`packages/worker/wrangler.toml`:
```toml
[env.test]
name = "pew-ingest-test"

[[env.test.d1_databases]]
binding = "DB"
database_name = "pew-db-test"
database_id = "<test-d1-id>"

[[env.test.routes]]
pattern = "pew-ingest-test.worker.hexly.ai"
custom_domain = true
```

`packages/worker-read/wrangler.toml`:
```toml
[env.test]
name = "pew-test"

[[env.test.d1_databases]]
binding = "DB"
database_name = "pew-db-test"
database_id = "<test-d1-id>"

[[env.test.routes]]
pattern = "pew-test.worker.hexly.ai"
custom_domain = true
```

**Step 2e — Deploy test Workers and set secrets:**
```bash
# Deploy ingest Worker (test env)
cd packages/worker
npx wrangler deploy --env test
npx wrangler secret put WORKER_SECRET --env test

# Deploy read Worker (test env)
cd ../worker-read
npx wrangler deploy --env test
npx wrangler secret put WORKER_READ_SECRET --env test
```

> **Note**: Each `secret put` must run from the matching package directory
> (`packages/worker` for `WORKER_SECRET`, `packages/worker-read` for
> `WORKER_READ_SECRET`) so wrangler reads the correct `wrangler.toml`.

**Step 2f — Create `.env.test`:**

`packages/web/.env.test` (gitignored, manually created):
```
# Test D1 database (pew-db-test) — NEVER point to production!
CF_D1_DATABASE_ID_TEST=<test-d1-id>

# Test Workers
WORKER_INGEST_URL_TEST=https://pew-ingest-test.worker.hexly.ai/ingest
WORKER_READ_URL_TEST=https://pew-test.worker.hexly.ai
```

**Files:**
- `packages/worker/wrangler.toml` (add `[env.test]` section)
- `packages/worker-read/wrangler.toml` (add `[env.test]` section)
- `.gitignore` (add `.env.test`)
- `packages/web/.env.test.example` (new — template without real IDs)

---

### Commit 3: `feat: add D1 test isolation guard utilities`

Create `scripts/d1-test-guard.ts` — reusable functions for test isolation verification.

Four-layer defense (covers all three data paths: D1 direct, Worker ingest, Worker read):
1. **Existence check**: all test env vars must be set (`CF_D1_DATABASE_ID_TEST`, `WORKER_INGEST_URL_TEST`, `WORKER_READ_URL_TEST`)
2. **Non-equality check — DB**: test DB ID ≠ prod DB ID
3. **Non-equality check — Workers**: test Worker URLs ≠ prod Worker URLs (prevents `.env.test` accidentally pointing test Workers at production endpoints; this is the primary data path for reads via `db-worker.ts` and writes via `ingest-handler.ts`)
4. **Marker check**: test DB must contain `_test_marker` table with `env='test'`

> **Why Worker URL validation matters**: The app's normal read/write paths do NOT use
> `CF_D1_DATABASE_ID` directly. Writes go through `WORKER_INGEST_URL` →
> `ingest-handler.ts`, reads go through `WORKER_READ_URL` → `db-worker.ts`.
> The direct D1 REST API (`CF_D1_DATABASE_ID`) is only used by the E2E seed/cleanup
> path in `api-e2e.test.ts`. If the guard only checked DB ID but `.env.test` had a
> prod Worker URL, all real test traffic would still hit production.

Core function `validateAndOverride(envLocal, envTest)`:
- Takes prod env (from `.env.local`) and test env (from `.env.test`)
- Validates all four layers
- Returns overridden env dict with `CF_D1_DATABASE_ID` / `WORKER_INGEST_URL` / `WORKER_READ_URL` pointing to test resources
- Throws on any failure (hard gate)

**Files:**
- `scripts/d1-test-guard.ts` (new)

---

### Commit 4: `refactor: integrate test isolation into E2E runners`

Modify both E2E runners to load `.env.test`, validate isolation, and override env vars.

**`scripts/e2e-utils.ts`** — add `loadEnvTest()` (same parser as `loadEnvLocal`, different file path).

**`scripts/run-e2e.ts`** — insert before server start:
```diff
  const envLocal = loadEnvLocal();
+ const envTest = loadEnvTest();
+ const isolatedEnv = await validateAndOverride(envLocal, envTest);
+ console.log("🔒 D1 test isolation verified");
- const mergedEnv = { ...process.env, ...envLocal };
+ const mergedEnv = { ...process.env, ...isolatedEnv };
```

**`scripts/run-e2e-ui.ts`** — same pattern.

`api-e2e.test.ts` requires **no changes** — its `getD1()` reads `CF_D1_DATABASE_ID` from `process.env`, which is now overridden to the test DB ID by the runner.

**Files:**
- `scripts/e2e-utils.ts` (add `loadEnvTest`)
- `scripts/run-e2e.ts` (add isolation flow)
- `scripts/run-e2e-ui.ts` (add isolation flow)

---

### Commit 5: `test: add D1 test guard unit tests`

L1 tests for the guard utilities — mock-based, no real Cloudflare calls.

- Existence check: throws when `CF_D1_DATABASE_ID_TEST` missing
- Existence check: throws when `WORKER_INGEST_URL_TEST` or `WORKER_READ_URL_TEST` missing
- Non-equality check: throws when test DB ID === prod DB ID
- Non-equality check: throws when test Worker URL === prod Worker URL
- Happy path: returns overridden env vars with correct mapping for all three keys
- Marker verification: mock HTTP response

**Files:**
- `scripts/__tests__/d1-test-guard.test.ts` (new)

---

### Commit 6: `docs: update CLAUDE.md and doc 30 with D1 dimension`

**`CLAUDE.md`** — Testing section: add D1 isolation note.

**`docs/30-quality-system-upgrade.md`** — append D1 cross-reference to doc 31.

**Files:**
- `CLAUDE.md`
- `docs/30-quality-system-upgrade.md`

---

### Commit 7: `docs: finalize doc 31 with verification record`

Run full verification and record results:

```bash
# Verify test DB has _test_marker
npx wrangler d1 execute pew-db-test --remote --command "SELECT * FROM _test_marker"

# Run L2 (should use test DB now)
bun run test:e2e

# Run L3 (should use test DB now)
bun run test:e2e:ui

# Verify prod DB has no e2e-test-user-id
```

**Files:**
- `docs/31-d1-test-isolation.md`

---

## Tier S Verification Checklist

After all commits, verify all 6 dimensions:

```bash
# L1 Unit/Component
bun run test:coverage              # ≥2,170 tests, ≥90% coverage

# G1 Static Analysis
bun run lint                       # 0 errors, 0 warnings

# L2 Integration/API (now isolated)
bun run test:e2e                   # 19+ tests pass, using pew-db-test

# G2 Security
bun run test:security              # osv-scanner + gitleaks clean

# L3 System/E2E (now isolated)
bun run test:e2e:ui                # 10+ specs pass, using pew-db-test

# D1 Test Isolation
# - Test DB ID ≠ prod DB ID ✅
# - _test_marker exists ✅
# - E2E writes go to test DB only ✅
# - Prod DB has no e2e-test-user-id ✅
```

| Dimension | Status | Evidence |
|-----------|--------|----------|
| L1 | ✅ | 2,170+ tests, 93%+ coverage |
| L2 | ✅ | 19 API E2E tests, real HTTP, **now on test DB** |
| L3 | ✅ | 10 Playwright specs, **now on test DB** |
| G1 | ✅ | tsc×5 + eslint --max-warnings=0 |
| G2 | ✅ | osv-scanner + gitleaks |
| D1 | ✅ | pew-db-test + test Workers + _test_marker + guards |
| **Tier** | **S** | All 6 dimensions green |

---

## Verification Record (2026-03-23)

### Infrastructure

| Resource | ID / URL | Status |
|----------|----------|--------|
| pew-db-test (D1) | `aa08a894-6a65-4baf-b756-2e611dff437d` | ✅ 22 tables + _test_marker |
| pew-ingest-test (Worker) | `pew-ingest-test.worker.hexly.ai` | ✅ Deployed |
| pew-test (Worker) | `pew-test.worker.hexly.ai` | ✅ Deployed |
| _test_marker | `key='env', value='test'` | ✅ Verified |

### Guard Verification

```
D1 test guard: 14 unit tests passed (4 layers × edge cases)
  Layer 1 — existence: 3 tests
  Layer 2 — DB non-equality: 1 test
  Layer 3 — Worker URL non-equality: 2 tests
  Layer 4 — _test_marker: 5 tests
  Happy path: 3 tests
```

### Production Safety

```
Prod DB check: SELECT * FROM users WHERE id = 'e2e-test-user-id' → [] (empty)
Test DB ID (aa08a894) ≠ Prod DB ID (5c00ebbf) ✅
Test Worker URLs ≠ Prod Worker URLs ✅
```

### Commit Log

| # | Hash | Message |
|---|------|---------|
| 1 | `7a60e88` | docs: add D1 test isolation upgrade plan (doc 31) |
| 2 | `2a804c8` | chore: create test D1 database and deploy test Workers |
| 3 | `a3acc0a` | feat: add D1 test isolation guard utilities |
| 4 | `26d4807` | refactor: integrate test isolation into E2E runners |
| 5 | `7aa4c44` | test: add D1 test guard unit tests |
| 6 | `07911fd` | docs: update CLAUDE.md and doc 30 with D1 dimension |
| 7 | — | docs: finalize doc 31 with verification record |
