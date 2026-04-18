# Autoresearch Ideas: Pre-commit Performance Optimization

## Completed ✅
- [x] Run L1 tests and G1a typecheck in parallel — saves ~1.5s by overlapping 5-6s tests with 4-5s typecheck

## Attempted but Not Viable ❌
- [x] Enable incremental tsc for cli/worker/worker-read — lockfile overhead negates typecheck gains
- [x] Limit vitest threads to 4-8 — doubled test time due to pool contention
- [x] Remove json+html coverage reporters — no measurable improvement, high variance
- [x] Run tsc in parallel (5 concurrent) — slower than sequential (4.2s vs 2.75s) due to CPU contention
- [x] Text-only coverage reporter — actually slower than text+json+html (5.5s vs 4.8s)

## Potential Future Optimizations (Not Yet Tried)

### Low Effort
- [ ] Use `vitest --reporter=basic` for CI (no improvement in local tests)
- [ ] Consider `--no-file-parallelism` if memory becomes an issue

### Medium Effort
- [ ] Module mocking optimization — some tests import heavy modules
- [ ] Shared test fixtures — reduce per-test setup overhead for similar tests
- [ ] Pre-compute test data instead of generating inline

### High Effort / Risky
- [ ] Test sharding across CI workers (for CI, not local dev)
- [ ] Lazy module imports in test files
- [ ] Pre-compile test files to reduce transform time
- [ ] Use esbuild-register for faster TypeScript compilation

## Measurements Summary
| State | Duration | tests time |
|-------|----------|------------|
| Baseline | ~4.2s | ~10.5s |
| After timeout reductions | ~4.2s | ~7.0s |
| After threads pool | ~2.8s | ~6.8s |
| **Final** | **~2.8s** | **~6.8s** |

## Notes
- Tests are highly parallelized (Duration < tests time due to parallel execution)
- collect time (~7.5s) is dominated by module loading — hard to optimize
- transform time (~4s) is esbuild, already very fast
- The main wins came from removing unnecessary real-time delays
