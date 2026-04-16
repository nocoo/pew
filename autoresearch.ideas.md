# Autoresearch Ideas: Unit Test Optimization

## Potential Future Optimizations

### Low Effort, High Impact (Not Yet Tried)
- [ ] Use `vitest --reporter=basic` to reduce output overhead
- [ ] Consider `--no-file-parallelism` if memory is an issue

### Medium Effort
- [ ] Module mocking optimization - some tests import heavy modules that could be mocked
- [ ] Shared test fixtures - reduce per-test setup overhead for similar tests

### High Effort / Risky
- [ ] Test sharding across CI workers (for CI, not local dev)
- [ ] Lazy module imports in test files
- [ ] Pre-compile test files to reduce transform time

## Completed Optimizations
- ✅ Reduce timeout delays (500ms → 50ms, etc.)
- ✅ Fix Retry-After header causing real 1s delay
- ✅ Reduce mtime delays (50ms → 1ms)
- ✅ Enable vitest threads pool (Duration 4.2s → 2.75s)

## Measurements
- Baseline: Duration ~4.2s, tests ~10.5s
- Current: Duration ~2.75s, tests ~6.9s
- Improvement: ~35% faster
