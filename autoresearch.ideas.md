# Autoresearch Ideas Backlog

## UT speed/stability/meaningfulness session (2026-04-21)

### Wins (committed)
- [x] **Restrict `test.include` glob** to `packages/*/src/**/*.test.{ts,tsx}` + `scripts/**/*.test.{ts,tsx}` — vitest no longer scans `dist/`, `.next/`, `node_modules/` at startup. 4.30s → 4.14s (-3.7%).
- [x] **`coverage.include` = `.ts` only** (drop `.tsx` since all tsx files are in coverage.exclude anyway) — reduces v8 instrumentation discovery. 4.14s → 4.02s (-2.9%) AND stddev 0.10 → 0.04 (-58%) — dual win on speed and stability.
- [x] **Drop `json` coverage reporter** — no consumers in repo (grep verified). 4.02s → 3.92s (-2.5%).
- [x] **Exclude `**/__tests__/**` from coverage** — test helpers (`test-utils.ts`) no longer dilute coverage stats. Pure meaningfulness fix; speed unchanged.

### Net session result
- Cold UT (low load): **4.30s → 3.92s (-8.8%)**
- Stddev: **0.10s → 0.04s (-58% — major stability win)**
- Coverage: maintained at 98.05/92.20/98.31/98.97 (stmts/branches/funcs/lines)
  - 3 of 4 floors well above 95; **branches 92.20 < 95** is a structural gap, not a regression.


### Confirmed dead ends (this session)
- [x] `pool: "vmThreads"` — crashes (incompatible with mocking patterns).
- [x] `pool: "forks"` — 2x slower (process startup overhead).
- [x] `poolOptions.threads.useAtomics: true` — 2x slower in vitest 3.x.
- [x] `poolOptions.threads.minThreads/maxThreads: 8/12` — slower than default 15.
- [x] `coverage.experimentalAstAwareRemapping: false` — faster but artificially inflates coverage (98.05→99.04, 92.2→94.13). **Rejected as cheating** — less accurate source mapping should not be used to chase the 95% floor.
- [x] `isolate: false` — fails (achievements-privacy.test.ts state leakage); 66 files use vi.mock, refactor too invasive.
- [x] Drop html reporter — within noise.
- [x] `coverage.cleanOnRerun: false` — within noise.
- [x] `coverage.processingConcurrency: 16` — within noise.

### Still worth trying (not done — load was too noisy)
- [ ] Identify the file(s) leaking module state under `isolate: false` and fix (potentially huge speedup if isolation can be disabled). Confirmed pollution surface: `achievements-privacy.test.ts` failures point at vi.mock('@/lib/db') collisions across 66 files.
- [ ] Strengthen weak assertions (`toBeDefined()`, `toBeTruthy()` without value checks) — top offenders: sync.test.ts (19), user-achievements-api.test.ts (12), achievements-api.test.ts (11). Pure meaningfulness improvement, no speed effect.
- [ ] Investigate the 5 `it.skipIf(!!process.env.CI)` tests in sync.test.ts/hermes-sqlite.test.ts/notify-command.test.ts — all rely on real-FS inode behavior. Refactor with mocked `fs.stat` to remove CI skip and increase meaningful test count from 3659 → 3664.
- [ ] Push branch coverage above 95 (currently 92.20). Top low-branch files: cli/commands/session-sync.ts (71), api/admin/check (60), api/achievements (73). Add tests for error/edge paths.
- [ ] esbuild target tuning (`esbuild.target: "esnext"`) — tested under load, no clear effect; retry under quiet system.
- [ ] Pre-bundle heavy deps via `server.deps.optimizer` / `optimizeDeps`.
- [ ] Switch primary metric to `min` of N runs (not median) — more robust against background load on dev machines.

## Pre-commit Performance Optimization (prior session)

### Completed ✅ — overlaps all three processes
- [x] Skip bun install --frozen-lockfile when no package.json/bun.lock changes staged — saves ~0.2s on most commits
- [x] Enable vitest caching in node_modules/.cache/vitest — reduces variance
- [x] Parallel tsc via bash script with proper exit code handling — typecheck dropped from ~4s to ~1.3s
- [x] **Pre-commit fast-path for docs-only commits** — 5.5s → 0.3s (17x) when no .ts/.tsx/.js/.json staged
- [x] **Parallel pre-push (E2E + G2 security)** — saves max(E2E,G2) instead of sum
- [x] **Parallel osv-scanner + gitleaks within G2** — small win, gitleaks=50ms
- [x] **Cache osv-scanner by bun.lock hash** — G2 3.5s → 0.15s when deps unchanged
- [x] **Cache L1 vitest by .ts/.tsx + vitest-version hash** — 5s → 0.04s when nothing relevant changed
- [x] **Cache G1a typecheck by .ts/.tsx + tsconfig + tsc-version hash** — 1.3s → 0.04s when cached

## Attempted but Not Viable ❌
- [x] Enable incremental tsc for cli/worker/worker-read — lockfile overhead negates typecheck gains
- [x] Limit vitest threads to 4-8 — doubled test time due to pool contention
- [x] Remove json+html coverage reporters — no measurable improvement, high variance
- [x] Text-only coverage reporter — actually slower than text+json+html (5.5s vs 4.8s)
- [x] Parallel tsc using & wait in npm script — doesn't propagate exit codes (typecheck passes with errors)
- [x] vitest --poolOptions.threads.isolate=false — 5 tests fail due to shared state

## Potential Future Optimizations (Not Yet Tried)

### Low Effort
- [ ] Use `vitest --reporter=basic` for CI output (less verbose)
- [ ] Move heavy test setup into shared fixtures to amortize "prepare" time across tests

### Medium Effort  
- [ ] Module mocking optimization — some tests import heavy modules
- [ ] Shared test fixtures — reduce per-test setup overhead for similar tests
- [ ] Pre-compute test data instead of generating inline
- [ ] Adopt tsgo (@typescript/native-preview) for typecheck once GA — ~10x faster but currently dev-preview only
- [ ] Switch coverage provider to istanbul if v8 v8 ESM remap continues to add transform overhead

### High Effort / Risky
- [ ] Test sharding across CI workers (for CI, not local dev)
- [ ] Lazy module imports in test files  
- [ ] Pre-compile test files to reduce transform time
- [ ] Disable vitest isolation per-file via opt-in tag (need to enumerate safe files)
- [ ] Replace vitest with bun:test for non-mocking-heavy unit tests

## Measurements Summary
| State | Duration |
|-------|----------|
| Baseline (sequential, original) | ~8.0s |
| Parallel L1+G1a+G1b | ~4.9s |
| Combined pre-commit + G2 security baseline | ~9.1s |
| Cold pre-commit + G2 (with G2 cache populated) | ~4.5s |
| **Warm (all caches hit, no source changes)** | **~0.26s** |
| **Docs-only commit (early-exit)** | **~0.3s** |

**Total improvement: 35x faster on warm runs (9.1s → 0.26s)**

## Cache Architecture
All caches stored under `.git/info/` (gitignored, local-only):
- `g2-cache.json` — osv-scanner (key: SHA256(bun.lock) + tool version)
- `l1-cache.json` — vitest (key: SHA256(.ts/.tsx mtime+size) + vitest version)
- `g1a-cache.json` — tsc (key: SHA256(.ts/.tsx + tsconfig mtime+size) + tsc version)

Environment overrides: `PEW_G2_NO_CACHE=1`, `PEW_L1_NO_CACHE=1`, `PEW_G1A_NO_CACHE=1`.

## Notes
- Tests are highly parallelized (Duration < tests time due to parallel execution)
- collect time (~7.5s) is dominated by module loading — hard to optimize
- transform time (~4s) is esbuild, already very fast
- The main wins came from:
  1. Running independent tasks in parallel
  2. Skipping unnecessary checks (lockfile when no deps changed)
  3. Parallel TypeScript compilation across packages

## File-size refactor backlog (>400 LOC, deferred from coverage session 2026-05-17)

Coverage now sits at 95.07% branches / 99.41% lines (was 94.19/98.98 at session start). The 24
oversized files / 41 oversized functions remain. Refactor proposals (atomic, test-preserving):

- [ ] `packages/web/src/lib/usage-helpers.ts` (1237 LOC) — split by domain:
      `usage-helpers/timeline.ts` (timeline aggregation),
      `usage-helpers/hourly.ts` (24-hour buckets / `aggregateHourlyTokens`),
      `usage-helpers/devices.ts` (device summary / cost details),
      `usage-helpers/index.ts` (re-exports). Verify each consumer's import path migrates cleanly.
- [ ] `packages/cli/src/commands/sync.ts` (763 LOC) — extract source-discovery,
      cursor-migration, and per-source rescan logic into `sync/discovery.ts`,
      `sync/cursor-upgrade.ts`, `sync/orchestrator.ts`. Keep `executeSync` as a thin glue layer.
- [ ] `packages/worker-read/src/rpc/seasons.ts` (742 LOC) — one handler per file under
      `rpc/seasons/{list,get,member-snapshots,team-tokens,session-stats,...}.ts` + index router.
- [ ] `packages/worker-read/src/rpc/projects.ts` (657 LOC) — similar handler-per-file split.
- [ ] `packages/web/src/lib/db.ts` (737 LOC) — separate `db-read.ts` (DbRead impls) and
      `db-write.ts` (DbWrite impls); keep `db.ts` as the singleton factory façade.
- [ ] `packages/web/src/app/api/achievements/[id]/members/route.ts` (661 LOC) — extract
      validation helpers (`validate-paging.ts`) and query-builder (`members-query.ts`).
- [ ] Functions >100 LOC (41) — most are giant handler bodies inside the files above; splitting
      the file usually reduces these to <100 LOC each.

### Coverage gaps that are dead/defensive code (don't chase)
- `usage-helpers.ts` lines 1047/1143/1217: `if (bucket)` false-branch — `hourly` is a 24-element
  pre-initialized array; `localDate.getUTCHours()` is always [0,23]; the false branch is
  structurally unreachable.
- `cli/commands/sync.ts` 137-138: exhaustiveness `never` check — provably unreachable.

## Session 2026-05-17 results (Refactor + Coverage Push)

### Achievements
- **Branch coverage**: 94.19% → 95.49% (+1.30%, locked-in via threshold bump)
- **Line coverage**: 98.98% → 99.48% (+0.50%)
- **Statements**: 98.29% → 98.89% (+0.60%)
- **Functions**: 98.67% → 98.93% (+0.26%)
- **Files > 400 LOC**: 24 → 18 (-6 via extract-and-re-export refactors)
- **Tests**: 4004 → 4086 (+82)
- **Experiments**: 53 (51 keep + 2 discard, ~96% acceptance)

### Vitest thresholds raised
`vitest.config.ts` thresholds tightened (`branches: 90→95`) to prevent regression.

### Refactors landed (extract pure helpers; re-export for back-compat)
1. `cli/notifier/coordinator.ts`: 457 → 395 LOC (extracted `deriveStatus` + signal helpers to `coordinator-helpers.ts`)
2. `cli/parsers/vscode-copilot.ts`: 406 → 305 LOC (extracted `normalizeModelId` + `estimateToolRoundTokens` + `estimateV3InputTokens` + `extractRequestMeta` + `RequestMeta` type to `vscode-copilot-helpers.ts`)
3. `web/src/lib/date-helpers.ts`: 451 → 354 LOC (extracted `detectPeakHours` + `PeakSlot` + 12-hour formatters to `date-helpers-peaks.ts`)
4. `worker-read/src/rpc/badges.ts`: 427 → 329 LOC (extracted types to `badges-types.ts` + `deriveAssignmentStatus` to `badges-helpers.ts`)
5. `worker-read/src/rpc/achievements.ts`: 422 → 336 LOC (extracted types to `achievements-types.ts`)
6. `cli/commands/session-sync.ts`: 408 → 359 LOC (extracted `toQueueRecord` + `sourceKey` to `session-sync-helpers.ts`)

### Test-only wins (no production code touched)
- `query-params.ts`: new test file (had no tests at all)
- `fetcher.ts`: 0% → 100% (had no tests at all)
- 30+ small "missing-branch" tests across rpc handlers, parsers, validation, login, upload-engine, etc.

### Remaining file-size backlog
13 files still > 400 LOC; biggest are `db-worker.ts` (1253), `usage-helpers.ts` (1237), `cli.ts` (958),
`types.ts` (765), `sync.ts` (763), `rpc-types.ts` (762), `seasons.ts` (742), `db.ts` (737),
plus 5 more 400-660 LOC files. These need bigger refactors (handler-per-file splits, multi-module
extractions) and are queued as "高 effort" items.

### Vitest exclusions
- Added `**/__test-helpers__/**` to coverage exclude (test utility, not production code).


## Final session 2026-05-17 — Extended pass

After the initial milestone push, additional iterations landed:
- **Branches**: 95.49 → 95.50 (small additional coverage)
- **files_over_400**: 18 → 15 (extracted types from users/teams/leaderboard rpc handlers)
- **Tests**: 4083 → 4087

### Additional refactors (extract types → `*-types.ts`, re-export with `export type *`)
7. `worker-read/src/rpc/users.ts` (523 → 384 LOC)
8. `worker-read/src/rpc/teams.ts` (509 → 385 LOC)
9. `worker-read/src/rpc/leaderboard.ts` (504 → 398 LOC)

### Attempted refactors that didn't fit
- `worker-read/src/rpc/seasons.ts` (742 → 522 after types-only): handlers are too dense; needs further per-handler splits. Reverted.
- `worker-read/src/rpc/projects.ts` (657 → 543 after types-only): same shape. Reverted.
- `worker-read/src/index.ts` SQL validator extraction (496 → 355 + 153): branches dropped 0.05% due to per-file dilution. Reverted; targeted tests for the 4 uncovered branches turned out to already be covered by existing escape-quote / comment tests. Worth re-attempting after adding **new** uncovered-branch tests first.

### Final scoreboard
- Branches  : **94.19% → 95.50% (+1.31%)** ✅ threshold raised to ≥95
- Lines     : 98.98% → 99.48% (+0.50%)
- Statements: 98.29% → 98.89% (+0.60%)
- Functions : 98.67% → 98.93% (+0.26%)
- files_over_400 : **24 → 15 (-9, -38%)** ✅
- funcs_over_100 : 41 (unchanged — these are inside the not-yet-split files)
- Tests     : 4004 → 4087 (+83)
- Experiments: 62 total (~94% acceptance rate)
- Atomic commits: 50+ pushed to origin/main

