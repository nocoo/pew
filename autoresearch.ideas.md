# Autoresearch Ideas: Unit Test Optimization

## Completed ✅
- [x] Reduce timeout delays (500ms → 50ms, etc.)
- [x] Fix Retry-After header causing real 1s delay
- [x] Reduce mtime delays (50ms → 1ms)
- [x] Enable vitest threads pool

## Attempted but Not Viable ❌
- [x] vmThreads pool — faster (1.4s vs 2.8s) but causes test isolation failures
- [x] sequence.shuffle — no improvement
- [x] typecheck.enabled: false — already default behavior

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
