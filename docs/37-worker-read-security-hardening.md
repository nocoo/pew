# 37. Worker-Read Security Hardening

## Problem Statement

`worker-read` is a generic SQL proxy that accepts arbitrary SELECT queries from the Next.js dashboard. The current write-statement guard uses a simple regex that only checks the SQL first word:

```typescript
const WRITE_RE = /^(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|PRAGMA)\b/i;
```

This can be bypassed via:
- **Comment prefix**: `-- DELETE FROM users;` or `/* */ DELETE FROM users`
- **CTE**: `WITH x AS (SELECT 1) DELETE FROM users`
- **Multi-statement**: `SELECT 1; DELETE FROM users`
- **Whitespace**: Leading spaces/newlines before the statement

While the endpoint requires a shared secret (`WORKER_READ_SECRET`) between Next.js and the Worker, a compromised Next.js instance or leaked secret could allow arbitrary write operations.

## Scope

### In Scope
- `packages/worker-read/src/index.ts` — SQL validation logic
- `packages/web/src/lib/db-worker.ts` — DbRead adapter
- `packages/web/src/lib/db.ts` — DbRead interface
- All consumers of `getDbRead()` (~30+ files, ~179 query calls):
  - API routes (`packages/web/src/app/api/**/*.ts`)
  - Auth layer (`packages/web/src/auth.ts`)
  - Lib modules (`packages/web/src/lib/invite.ts`, `admin.ts`, etc.)
  - SSR pages (`packages/web/src/app/u/[slug]/page.tsx`, etc.)

### Out of Scope
- `packages/worker/` (write Worker) — already uses explicit INSERT statements
- `packages/web/src/lib/db-rest.ts` — DbWrite adapter (stays on REST API)
- CLI package — no D1 interaction

## Current Query Patterns

Analysis of 179 `dbRead.query/firstOrNull` calls:

| Category | Count | Example |
|----------|-------|---------|
| Existence check | ~50 | `SELECT id FROM x WHERE ...` |
| Single row fetch | ~60 | `SELECT * FROM users WHERE id = ?` |
| List query | ~40 | `SELECT * FROM x ORDER BY ...` |
| Aggregate stats | ~20 | `SELECT COUNT(*) FROM ...` |
| Complex JOIN | ~10 | Cross-table queries |

## Solution

Two-phase approach:

### Phase 1: SQL Tokenizer/Validator (Immediate)

Harden the SQL validation in `worker-read` using a minimal SQL tokenizer (not regex) to:
1. Strip comments (`--`, `/* */`) while preserving string literals
2. Reject semicolons outside string literals (multi-statement)
3. Detect CTE write patterns (`WITH...DELETE/UPDATE/INSERT`)
4. Require query to start with `SELECT` or `WITH` (for CTE SELECT)

**Note**: This is a tokenizer-based approach, not pure regex. Functions `stripComments()` and `containsMultiStatement()` scan character-by-character to correctly handle string literals like `'-- not a comment'` and `'value; with semicolon'`.

### Phase 2: Business-Level RPC (Incremental)

Replace generic SQL proxy with typed query functions. Group by domain:

| Domain | Methods | Priority |
|--------|---------|----------|
| `users` | `getUserById`, `getUserBySlug`, `checkSlugExists` | P0 |
| `projects` | `getProject`, `listProjects`, `getProjectAliases` | P0 |
| `teams` | `getTeam`, `listTeamMembers`, `checkMembership` | P1 |
| `seasons` | `getSeason`, `getLeaderboard`, `getSnapshot` | P1 |
| `usage` | `getUsageStats`, `getDeviceUsage` | P1 |
| `achievements` | `getAchievement`, `listAchievements`, `getAchievementMembers` | P1 |
| `devices` | `getDevice`, `listDevices`, `getDeviceAliases` | P1 |
| `organizations` | `getOrg`, `listOrgMembers` | P2 |
| `showcases` | `getShowcase`, `listShowcases` | P2 |
| `settings` | `getAppSetting`, `getUserSettings` | P2 |
| `auth` | `getInviteCode`, `verifyInvite`, `getAuthCode` | P2 |
| `sessions` | `getSessionStats` | P2 |
| `leaderboard` | `getLeaderboardData` | P2 |
| `pricing` | `getPricing`, `listPricing` | P3 |
| `admin` | `listInviteCodes`, `getAdminStats` | P3 |
| `live` | `healthCheck` (proxy to worker-read `/api/live`) | P3 |

**Note on `live`**: The current `/api/live` route uses `getDbRead().query("SELECT 1")` for DB connectivity check. Migration option: proxy directly to worker-read's `/api/live` endpoint which already performs the same check with native D1 binding.

**Goal**: Once all domains are migrated, the generic `/api/query` endpoint can be removed entirely. Until then, Phase 1 validation provides defense-in-depth.

## Atomic Commits Plan

### Phase 1: SQL Tokenizer/Validator

```
P1-1: Add SQL validation and bypass rejection tests (RED)
P1-2: Implement tokenizer-based SQL validation (GREEN)
P1-3: Deploy worker-read, verify in production
```

### Phase 2: RPC Migration (per domain)

Each domain follows the same pattern:

```
P2-{domain}-1: Define typed query interface in worker-read (types only)
P2-{domain}-2: Add RPC endpoint tests (RED)
P2-{domain}-3: Implement RPC endpoint (GREEN)
P2-{domain}-4: Add DbRead adapter methods
P2-{domain}-5: Migrate API routes to use new methods
P2-{domain}-6: Remove raw SQL from migrated routes
```

## Quality System (6DQ) Plan

### L1: Unit Tests
- `worker-read`: SQL validation edge cases (comments, CTE, multi-statement)
- `worker-read`: Each RPC method with mock D1
- `db-worker.ts`: Adapter method tests

### L2: Integration Tests
- Worker RPC endpoints against test D1 database
- End-to-end query flow through DbRead adapter

### L3: E2E Tests

Current `api-e2e.test.ts` coverage is limited to:
- `GET /api/usage`
- `GET /api/auth/cli`
- Showcase endpoints

**Gap**: Most read domains (achievements, devices, teams, seasons, organizations, etc.) lack L3 coverage.

**Plan**: Add minimal L3 regression tests for each domain during Phase 2 migration:
```
P2-{domain}-L3: Add E2E smoke test for critical read path
```

This ensures RPC migration doesn't break production behavior.

### G1: Static Analysis
- TypeScript strict mode (already enabled)
- No new lint rules needed

### G2: Security
- SQL injection test cases in L1
- Bypass attempt test cases (comments, CTE, semicolons)

### D1: Test Isolation
- Worker tests use in-memory mock
- Integration tests use `pew-db-test` binding

## File Changes Summary

### Phase 1 (Completed)

| File | Change | Status |
|------|--------|--------|
| `packages/worker-read/src/index.ts` | Tokenizer-based SQL validation | ✅ Done |
| `packages/worker-read/src/index.test.ts` | Bypass attempt test cases | ✅ Done |

**Note**: Tests were added to the existing `index.test.ts` rather than a separate file.

### Phase 2 (Planned, per domain)

| File | Change |
|------|--------|
| `packages/worker-read/src/rpc/{domain}.ts` | New RPC handlers |
| `packages/worker-read/src/__tests__/rpc-{domain}.test.ts` | New test file |
| `packages/web/src/lib/db.ts` | Extended DbRead interface |
| `packages/web/src/lib/db-worker.ts` | RPC method implementations |
| `packages/web/src/app/api/**/*.ts` | Replace raw SQL with RPC calls |

## Progress Tracking

### Phase 1: SQL Tokenizer/Validator
- [x] P1-1: SQL validation tests
- [x] P1-2: Implement tokenizer-based validation
- [x] P1-3: Deploy and verify

### Phase 2: RPC Migration
- [x] users (P0) — RPC handlers, DbRead interface, adapter methods, partial route migration
- [x] projects (P0)
- [x] teams (P1)
- [ ] seasons (P1)
- [ ] usage (P1)
- [ ] achievements (P1)
- [ ] devices (P1)
- [ ] organizations (P2)
- [ ] showcases (P2)
- [ ] settings (P2)
- [ ] auth (P2)
- [ ] sessions (P2)
- [ ] leaderboard (P2)
- [ ] pricing (P3)
- [ ] admin (P3)
- [ ] live (P3)

## References

- [29-worker-read-migration.md](./29-worker-read-migration.md) — Original Worker migration
- [30-quality-system-upgrade.md](./30-quality-system-upgrade.md) — 6DQ methodology
- [31-d1-test-isolation.md](./31-d1-test-isolation.md) — Test database isolation
