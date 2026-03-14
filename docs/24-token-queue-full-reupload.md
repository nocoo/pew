# Token Queue Full Re-upload Fix

> Eliminate wasteful full re-uploads on every incremental sync by tracking which
> bucket keys were modified since the last successful upload.

## Status

| # | Commit | Description | Status |
|---|--------|-------------|--------|
| 1 | `docs: add token queue full re-upload plan` | This document | pending |
| 2 | `test: add dirty-keys tracking tests for sync` | L1 failing tests | pending |
| 3 | `feat: add dirtyKeys to queue state schema` | Extend state | pending |
| 4 | `feat: track dirty bucket keys during sync` | Modify sync.ts merge logic | pending |
| 5 | `test: add dirty-keys filtering tests for upload-engine` | L1 failing tests | pending |
| 6 | `feat: upload only dirty records in upload-engine` | Filter by dirtyKeys | pending |
| 7 | `test: verify reset triggers full re-upload` | Ensure reset marks all dirty | pending |
| 8 | `refactor: remove offset-reset-to-0 in sync.ts` | Clean up legacy offset | pending |

## Problem

Every `pew sync` re-uploads the **entire** token queue (~3057 records / 62
batches) even when only a handful of new deltas exist. This wastes bandwidth,
D1 write operations, and makes sync unnecessarily slow.

### Symptoms

```
Uploading records batch 1/62 (50 records)...
Uploading records batch 2/62 (50 records)...
...
Uploading records batch 62/62 (7 records)...
Uploaded 3057 records in 62 batch(es).
```

Every single run. Even when the user only had 2-3 new conversation turns since
the last sync.

## Root Cause

`sync.ts:536-541` -- the incremental merge branch:

```typescript
} else if (records.length > 0) {
  // Incremental with new data: SUM with existing queue records
  const { records: oldRecords } = await queue.readFromOffset(0);
  const merged = aggregateRecords([...oldRecords, ...records]);
  await queue.overwrite(merged);
  await queue.saveOffset(0);  // BUG: resets offset to byte 0
}
```

The `queue.saveOffset(0)` call resets the upload cursor to the beginning of
the file. The upload engine (`upload-engine.ts:115-117`) then reads from offset
0 and uploads everything:

```typescript
const currentOffset = await queue.loadOffset();
const { records: rawRecords, newOffset } =
  await queue.readFromOffset(currentOffset);  // currentOffset = 0, reads ALL
```

### Why It Triggers Every Run

Between syncs, the user uses AI tools which append to log files. The
`fileUnchanged(inode, mtimeMs, size)` check detects changes, incremental
parse produces >=1 delta, merge-and-reset branch fires, full re-upload.

The server uses `ON CONFLICT ... DO UPDATE SET col = excluded.col` (overwrite
upsert at `packages/worker/src/index.ts:62-72`), so this is **idempotent but
wasteful**: 3000+ records re-sent when only 5-10 changed.

## Design Constraints (User-Specified)

1. `pew reset` MUST trigger a full re-upload (rebuild from source files)
2. During healthy operation, upload only incremental changes
3. Must maintain idempotency (safe to re-upload)
4. No duplicate counting (server upsert is overwrite, not additive)
5. **No server-side changes** to Worker SQL

## Solution: Dirty-Bucket Tracking

### Concept

Extend `queue.state.json` with a `dirtyKeys` set that tracks which bucket keys
(`source|model|hour_start|device_id`) were modified since the last successful
upload. The upload engine filters the queue to only send records matching dirty
keys.

The queue file (`queue.jsonl`) still holds the **complete snapshot** of all
aggregated buckets for crash recovery. But the upload engine only sends the
subset that changed.

### Data Structures

**Current `queue.state.json`:**
```json
{ "offset": 0 }
```

**New `queue.state.json`:**
```json
{
  "offset": 0,
  "dirtyKeys": [
    "claude-code|claude-sonnet-4-20250514|2026-03-14T10:00:00.000Z|7f2bdbdb",
    "opencode|claude-sonnet-4-20250514|2026-03-14T10:30:00.000Z|7f2bdbdb"
  ]
}
```

The bucket key format matches `aggregateRecords()` at `upload.ts:63`:
```typescript
const key = `${r.source}|${r.model}|${r.hour_start}|${r.device_id}`;
```

### Modified Flows

#### Sync (sync.ts)

**Full scan** (empty cursors / after reset):
1. Overwrite queue with complete snapshot
2. Set `dirtyKeys` = ALL keys in the snapshot (marks everything for upload)
3. Set `offset` = 0

**Incremental** (cursors exist, records.length > 0):
1. Read existing queue from offset 0
2. Compute keys of new `records` (the delta)
3. Merge old + new via `aggregateRecords()`
4. Overwrite queue with merged result
5. **Append** new delta keys to existing `dirtyKeys` (union, deduplicated)
6. Set `offset` = 0 (queue was rewritten, byte offsets are invalid)

**Incremental with no new data** (records.length === 0):
- No change to queue or dirtyKeys (preserve existing state)

#### Upload (upload-engine.ts)

1. Load `dirtyKeys` from state
2. If `dirtyKeys` is undefined/null (legacy state), fall back to current
   behavior (upload everything from offset -- backward compatible)
3. If `dirtyKeys` is empty array `[]`, skip upload (nothing changed)
4. If `dirtyKeys` has entries:
   a. Read ALL records from queue (offset 0)
   b. Filter to only records whose key is in `dirtyKeys`
   c. Upload filtered records in batches
   d. On success: set `dirtyKeys = []` and save offset = end of file

#### Reset

`pew reset` deletes `cursors.json`, `queue.jsonl`, and `queue.state.json`.
Next sync is a full scan -> all keys marked dirty -> full upload. No special
handling needed -- the existing reset behavior already clears all state files.

### Crash Safety Analysis

| Crash point | State after restart | Behavior |
|---|---|---|
| After queue overwrite, before dirtyKeys save | Queue has merged data, dirtyKeys stale (may be empty from last upload) | Next sync re-parses deltas, re-merges, re-adds dirty keys. Worst case: one sync cycle where changed buckets aren't uploaded. Self-healing on next run. |
| After dirtyKeys save, before cursor save | Queue + dirtyKeys correct, cursors stale | Next sync re-parses from old cursors, produces superset of deltas. aggregateRecords() with overwrite upsert = idempotent. dirtyKeys union includes all changed keys. Safe. |
| During upload, after some batches sent | dirtyKeys still contains all keys (cleared only after ALL batches succeed) | Next upload re-sends all dirty records. Server overwrite upsert = idempotent. Safe. |

### Expected Improvement

| Metric | Before | After |
|---|---|---|
| Records per sync (typical) | ~3057 (full queue) | ~5-50 (dirty buckets only) |
| HTTP batches per sync | ~62 | ~1 |
| D1 write operations | ~3057 | ~5-50 |
| Sync duration | ~30s | ~1-2s |

## Files to Modify

| File | Change |
|---|---|
| `packages/cli/src/storage/base-queue.ts` | Add `saveDirtyKeys()`, `loadDirtyKeys()`, `clearDirtyKeys()` methods |
| `packages/cli/src/commands/sync.ts` | Track dirty keys during merge; save after queue overwrite |
| `packages/cli/src/commands/upload-engine.ts` | Filter by dirty keys; clear after successful upload |
| `packages/cli/src/commands/upload.ts` | Pass dirty key extraction logic to engine (bucket key function) |
| `packages/cli/src/__tests__/upload.test.ts` | Add dirty-key filtering tests |
| `packages/cli/src/__tests__/upload-engine.test.ts` | Add dirty-key filtering tests |
| New: `packages/cli/src/__tests__/sync-dirty-keys.test.ts` | Dedicated dirty-keys tracking tests for sync |

## Implementation Notes

- `dirtyKeys` is stored as a JSON array (not Set) for serialization simplicity.
  Deduplicated via `new Set()` during union operations in memory.
- The `offset` field is kept for backward compatibility but becomes less
  important -- the primary upload control is now `dirtyKeys`.
- Legacy state files without `dirtyKeys` field are handled gracefully:
  `loadDirtyKeys()` returns `undefined` (not empty array), signaling the
  upload engine to use the legacy offset-based behavior.
- The dirty key format exactly matches the aggregation key in `upload.ts:63`
  to avoid any mismatch bugs.
