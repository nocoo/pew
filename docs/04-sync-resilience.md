# Sync Resilience Fixes

> Fix two HIGH-severity data loss bugs in the sync pipeline.

## Status

| # | Commit | Description | Status |
|---|--------|-------------|--------|
| 1 | `docs: add sync resilience plan` | This document | ✅ done |
| 2 | `test: add tests for per-file parser error isolation` | Failing test first | ✅ done |
| 3 | `fix: wrap per-file parser calls in try/catch for error isolation` | GREEN the test | ✅ done |
| 4 | `test: add test for cursor-before-queue write order` | Failing test first | ✅ done |
| 5 | `fix: swap cursor/queue write order to prevent double-counting on crash` | GREEN the test | ✅ done |

## HIGH-1: Single File Parser Error Aborts Entire Sync

**Problem**: `sync.ts` calls `parseClaudeFile()`, `parseGeminiFile()`,
`parseOpenCodeFile()`, `parseOpenClawFile()` without try/catch. If any single
file throws (corrupt JSON, encoding error, readline exception), the entire
`executeSync` function throws. Consequences:

- All already-parsed deltas are lost (queue never written)
- Cursors are not saved (next run restarts from old state)
- If the bad file persists, sync is **permanently stuck**

**Fix**: Wrap each per-file parser call in try/catch. On error:
- Log a warning via `onProgress` callback (new `"warn"` phase)
- Skip the failed file, do NOT advance its cursor
- Continue processing remaining files

## HIGH-2: Cursor-Queue Non-Atomic Write Causes Double-Counting on Crash

**Problem**: `sync.ts:365-370` writes queue first, then cursors. If the process
crashes between the two writes:

1. Queue has the new records
2. Cursors still point to old state
3. Next sync re-parses everything → duplicate records in queue
4. Upload `aggregateRecords()` sums duplicates → 2x values
5. Worker overwrite upsert stores the doubled values

**Fix**: Swap the write order — save cursors first, then append to queue.
Worst case on crash between the two: cursors are advanced but queue is missing
the records. Result: data loss for this sync cycle (not double-counting).
This is acceptable because sync runs frequently and the lost window is tiny.
