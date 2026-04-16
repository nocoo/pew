# Autoresearch: Unit Test Speed Optimization

## Objective
Optimize unit test execution speed while maintaining:
- Test validity and meaningfulness
- Test coverage ≥ 95%

## Constraints
- Do NOT cheat on benchmarks
- Do NOT overfit to benchmarks
- Atomic commits to local (no push)

## Primary Metric
- **test_time_seconds**: Total `bun run test` duration (lower is better)

## Secondary Metrics (monitored, not optimized directly)
- **test_count**: Number of passing tests (should remain stable ~3662)
- **coverage_pct**: Overall code coverage (must stay ≥ 95%)

## Benchmark Command
```bash
bun run test 2>&1 | grep -E "Duration|Tests"
```

## Current Baseline
- 3662 tests, 211 test files
- ~108 seconds total (actual test time ~16s)
- ~95%+ coverage

## Slow Tests Identified
| Test File | Time | Notes |
|-----------|------|-------|
| login.test.ts | ~2200ms | Timeout tests (500ms each) |
| upload.test.ts | ~1050ms | 429 retry test (1000ms) |
| notify-command.test.ts | ~780ms | Cooldown sleep test (500ms) |
| sync.test.ts | ~715ms | Many tests (71), some with delays |
| coordinator-integration.test.ts | ~400ms | Serialization tests with timing |

## Optimization Ideas
1. Reduce fake timer timeouts in tests (keep test intent, mock time better)
2. Use `vi.useFakeTimers()` more aggressively for timeout tests
3. Parallelize test files better (vitest pool config)
4. Reduce redundant setup/teardown
5. Consider vitest --pool threads vs forks

## Rules
- Every change must pass all tests
- Every change must maintain coverage ≥ 95%
- Commit atomically with descriptive messages
