# Autoresearch Ideas: Pre-commit Performance Optimization

## Completed ✅
- [x] Run L1 tests, G1a typecheck, and G1b lint-staged in parallel — overlaps all three processes
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

### Medium Effort  
- [ ] Module mocking optimization — some tests import heavy modules
- [ ] Shared test fixtures — reduce per-test setup overhead for similar tests
- [ ] Pre-compute test data instead of generating inline

### High Effort / Risky
- [ ] Test sharding across CI workers (for CI, not local dev)
- [ ] Lazy module imports in test files  
- [ ] Pre-compile test files to reduce transform time

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
