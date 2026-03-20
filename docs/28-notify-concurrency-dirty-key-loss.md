# Notify Concurrency: Dirty-Key Loss Under Unlocked Parallel Sync

> Concurrent `pew notify` processes running without file lock (`degradedToUnlocked`)
> race on `queue.state.json`, causing dirty keys from earlier time windows to be
> silently overwritten. The upload engine then only sends a subset of changed
> buckets, leaving hours of token data missing from the dashboard.

## Status

| # | Commit | Description | Status |
|---|--------|-------------|--------|
| 1 | `docs: add notify concurrency dirty-key loss investigation` | This document | done |
| 2 | `docs: revise fix design based on code review` | Add review findings; phased approach | done |

## Symptom

User ran `pew sync` at 9:12 AM local (UTC+8). Dashboard showed the earliest
record for today at **7:30 AM** — but the user had been actively using Claude
Code and Codex since **5:00 AM**. Two and a half hours of token data were
invisible on the dashboard.

Sync output:

```
✔ Synced 120 new events → 2 queue records
✔ Uploaded 8 token records in 1 batch(es).
✔ Uploaded 62 session records in 2 batch(es).
```

## Investigation

### 1. Raw Data Integrity — OK

The local `~/.claude/projects/` JSONL files show the first file modification
today at **05:29 local** (several Claude Code sessions across bat, neo, codo,
workflow projects). Codex sessions start at **05:20 local**. No AI tool activity
between **20:21 (Mar 19)** and **05:20 (Mar 20)** — overnight sleep gap.

**Conclusion:** Raw log files are complete. No data loss at source.

### 2. Queue Contents — OK

`queue.jsonl` contains records for all time windows:

```
2026-03-19T21:00:00.000Z (local 05:00)  claude-code + codex
2026-03-19T21:30:00.000Z (local 05:30)  claude-code × 2 + codex
2026-03-19T22:00:00.000Z (local 06:00)  claude-code + codex
2026-03-19T22:30:00.000Z (local 06:30)  claude-code + codex
2026-03-19T23:00:00.000Z (local 07:00)  claude-code
2026-03-19T23:30:00.000Z (local 07:30)  claude-code + codex
2026-03-20T00:00:00.000Z (local 08:00)  claude-code + codex
2026-03-20T00:30:00.000Z (local 08:30)  claude-code + codex
2026-03-20T01:00:00.000Z (local 09:00)  claude-code + codex
```

**18 unique bucket keys** total for the affected period.
Queue file size (897614 bytes) equals `queue.state.json` offset — all records
were written successfully.

**Conclusion:** Sync pipeline correctly parsed all log files and produced
complete aggregated records in the queue.

### 3. Upload — Only 8 of 18 Keys Sent

The upload engine uses dirty-key filtering (introduced in doc 27). It uploaded
exactly **8 records**, which correspond precisely to bucket keys from
**23:30 UTC (7:30 local) onward**:

```
claude-code|claude-opus-4.6|2026-03-19T23:30:00.000Z|14a28b16-...
claude-code|claude-opus-4.6|2026-03-20T00:00:00.000Z|14a28b16-...
claude-code|claude-opus-4.6|2026-03-20T00:30:00.000Z|14a28b16-...
claude-code|claude-opus-4.6|2026-03-20T01:00:00.000Z|14a28b16-...
codex|gpt-5.4|2026-03-19T23:30:00.000Z|14a28b16-...
codex|gpt-5.4|2026-03-20T00:00:00.000Z|14a28b16-...
codex|gpt-5.4|2026-03-20T00:30:00.000Z|14a28b16-...
codex|gpt-5.4|2026-03-20T01:00:00.000Z|14a28b16-...
```

**10 keys for the 05:00–07:00 local window were missing from dirty keys.**

**Conclusion:** The dirty-key set was incomplete at upload time. Keys from
earlier time windows were lost before the upload engine could read them.

### 4. Notify Run Logs — Every Run Degraded to Unlocked

Cursor `updatedAt` timestamps show sync runs at precise 15-minute intervals
(05:30, 05:45, 06:00, ... 09:15 local), matching the `pew notify` pattern
triggered by AI tool hooks.

Run log analysis of **all 130+ runs** between 21:15 UTC and 01:15 UTC reveals:

```
degradedToUnlocked: true   — 100% of runs
waitedForLock: false        — none ever blocked on the lock
skippedSync: false          — none were skipped by coordination
```

**The file lock in `coordinator.ts` is completely non-functional.** Every notify
process falls through to `runUnlocked()`, executing `executeSync` concurrently
with no mutual exclusion.

### 5. Concurrency Pattern

Multiple notify processes fire simultaneously (triggered by Claude Code
`PostToolUse` hooks across multiple concurrent sessions). Example from a single
15-minute window:

```
2026-03-19T22:30:07  success  d=248 r=3  degraded=True   ← Process A: 248 deltas
2026-03-19T22:30:07  partial  d=  0 r=0  degraded=True   ← Process B: 0 deltas (partial)
2026-03-19T22:30:07  partial  d=  0 r=0  degraded=True   ← Process C: 0 deltas
2026-03-19T22:30:08  partial  d=  0 r=0  degraded=True   ← ...
2026-03-19T22:30:08  partial  d=  0 r=0  degraded=True
2026-03-19T22:30:08  partial  d=  0 r=0  degraded=True
2026-03-19T22:30:13  success  d=  3 r=1  degraded=True   ← Process G: 3 deltas (late)
```

Typically one process wins the cursor race and produces deltas; the others find
files unchanged and produce 0 deltas (`partial` status because session sync
may also fail for the same reason).

## Root Cause

### The Race

`pew notify` invokes `coordinatedSync()` which **always** degrades to
`runUnlocked()` — meaning `executeSync()` runs with no mutual exclusion.

The critical section in `sync.ts` lines 551–563:

```typescript
} else if (records.length > 0) {
  // Incremental with new data: SUM with existing queue records
  const { records: oldRecords } = await queue.readFromOffset(0);
  const merged = aggregateRecords([...oldRecords, ...records]);
  await queue.overwrite(merged);
  await queue.saveOffset(0);
  // Union new bucket keys into existing dirtyKeys
  const newKeys = records.map(
    (r) => `${r.source}|${r.model}|${r.hour_start}|${r.device_id}`,
  );
  const existingDirty = (await queue.loadDirtyKeys()) ?? [];
  const unionSet = new Set([...existingDirty, ...newKeys]);
  await queue.saveDirtyKeys([...unionSet]);
}
```

When two processes (A and B) enter this block concurrently:

```
Time   Process A                        Process B
─────  ───────────────────────────────  ───────────────────────────────
t1     Load dirtyKeys = [K1, K2, K3]
t2                                      Load dirtyKeys = [K1, K2, K3]
t3     Compute union = [K1..K3, K4]
t4                                      Compute union = [K1..K3, K5]
t5     Save dirtyKeys = [K1..K4]
t6                                      Save dirtyKeys = [K1..K3, K5]  ← K4 LOST
```

Process B's write overwrites Process A's, losing K4. Over many 15-minute
windows with multiple concurrent processes, this race repeatedly drops keys
from earlier time windows. The **last writer wins**, and later time windows
are more likely to survive because they're produced by later processes.

### Why the Lock Fails

`coordinator.ts` attempts `FileHandle.lock('exclusive', { nonBlocking: true })`.
When this throws, it checks for `EAGAIN`/`EWOULDBLOCK` to decide whether to
wait. But if `lock()` is not a function (runtime doesn't support it) or throws
a different error, the coordinator falls through to `runUnlocked()`.

The run logs show `degradedToUnlocked: true` on **every single run**, meaning
the lock mechanism never engages. Most likely cause: the `pew notify` process
runs under a Node.js version where `FileHandle.lock()` is not yet available
(it was added in Node.js 22.x as experimental).

### Why This Wasn't Caught by Doc 27

Doc 27 (dirty-key tracking) was designed and tested under the assumption that
only one sync process runs at a time. The coordinator's file lock was supposed
to enforce this invariant. The doc 27 crash safety analysis covers crashes
between operations but not concurrent writers — because the lock was assumed
to work.

Additionally, `pew sync` (manual CLI command) does **not** use the coordinator
at all — it calls `executeSync()` directly. So manual testing would never
reproduce the race.

## Impact

- **Token records from 05:00–07:00 local** not uploaded to D1.
- Dashboard shows a gap: earliest record at 7:30 instead of 5:00.
- The queue.jsonl **does** contain the correct data — it's a upload-side loss.
- Server-side data is recoverable via `pew reset && pew sync`.

### Severity

Medium. Data is not permanently lost (queue is intact, source files untouched).
A `pew reset && pew sync` will re-upload everything. But the bug silently drops
data on every sync cycle where notify processes run concurrently — which is
**every cycle** given the user has multiple Claude Code sessions active.

## Evidence Summary

| Check | Result |
|---|---|
| Raw JSONL files (source) | Complete — 05:00 onward |
| queue.jsonl (local queue) | Complete — 18 unique keys |
| queue.state.json dirtyKeys (at upload time) | **Incomplete — only 8 keys** |
| D1 database (dashboard) | Missing 05:00–07:00 records |
| Coordinator lock status | 100% `degradedToUnlocked` |
| Concurrent notify processes per 15-min window | 3–10 simultaneous |

## Immediate Remediation

See "User-Facing Remediation" section below.

## User-Facing Remediation

Users who encounter missing data on the dashboard can perform a full rescan:

```bash
pew reset && pew sync
```

This clears all cursors, re-parses all source files from scratch, marks every
bucket key as dirty, and uploads the complete snapshot. The server's
`ON CONFLICT ... DO UPDATE SET` upsert is idempotent — re-uploading existing
records is safe and simply overwrites with the same values.

A minor risk exists if `pew notify` fires concurrently during the reset+sync
window, but in practice the full-scan branch uses `queue.overwrite()` (not
merge), so the complete snapshot will be written regardless.

## Code Review Findings

The initial fix design (Change 1 + Change 2) was reviewed against the codebase
and three critical risks were identified:

### Risk 1 — Cursor-After-Upload Assumes Idempotency (HIGH)

The proposed "persist cursors only after upload" relies on the assumption that
re-parsing the same file segment produces the same queue state. **This is
false.** The current token merge uses `aggregateRecords()` which is SUM-based:

```typescript
// upload.ts — aggregateRecords()
if (existing) {
  existing.input_tokens += r.input_tokens;
  // ... all fields summed
}
```

And `sync.ts:551-563` merges new deltas into old queue by SUM:

```typescript
const merged = aggregateRecords([...oldRecords, ...records]);
```

If a crash occurs after queue merge but before cursor write, the next run
re-parses the same deltas and SUMs them again → **double-count**. The code
comment at `sync.ts:568-573` acknowledges this:

> "values ≥ true (minor over-count for one sync cycle, recoverable via pew reset)"

This is tolerable for rare crash recovery, but cursor-after-upload would make
it the **normal flow** on every upload failure or timeout. The server upsert
(`ON CONFLICT DO UPDATE SET`) is an overwrite, so if the doubled values reach
the server, the dashboard shows 2× the actual usage.

**Conclusion:** Do not implement cursor-after-upload until the token queue
model is made truly idempotent (see Phase 2 below).

### Risk 2 — Simple Lockfile Drops Coordinator Semantics (HIGH)

The original design proposed replacing `FileHandle.lock()` with a simple
`O_EXCL` lockfile where losers just exit. This **drops** the existing
coordinator's signal/dedup semantics designed in doc 10b:

1. **`notify.signal` + O_APPEND**: Atomic dirty notification without
   read-modify-write race
2. **Blocking waiter**: Loser doesn't exit — it waits for the lock, ensuring
   no notification is silently dropped (doc 10b: "失败方不能直接 exit，
   否则会在最后一次 check/truncate/unlock 窗口吞掉 notify")
3. **Follow-up cycle**: Lock holder checks signal size after sync; if > 0,
   runs another cycle
4. **Waiter dedup**: After acquiring lock, waiter checks signal size; if 0
   (previous follow-up already consumed), skip sync

These semantics exist for good reason — they guarantee zero lost notifications.
A simple lockfile with "exit on contention" would regress notification
reliability.

**Conclusion:** Fix must preserve all four coordinator semantics. Only the
lock *acquisition mechanism* changes (from `FileHandle.lock()` to `O_EXCL`
lockfile), not the coordination protocol.

### Risk 3 — Age-Based Stale Lock Detection Is Unsafe (MEDIUM)

The initial design proposed stale lock detection via "PID dead OR age > 5 min".
The age check is unsafe because `fetch()` in the upload engine has no timeout
— a slow network request could still be running when another process steals
the lock based on age alone, causing concurrent execution.

**Conclusion:** Stale lock detection must use PID-only. If the PID is alive,
the lock is valid regardless of age.

## Fix Design (Revised)

The fix is split into three phases. **Phase 1 alone fixes the bug.** Phases 2
and 3 are follow-up improvements that require correctness guarantees from the
phases before them.

### Phase 1: Fix the Lock (Correctness Fix)

**Goal:** Make `coordinator.ts` actually achieve mutual exclusion, so the
existing signal/dedup protocol works as designed.

**Problem:** `FileHandle.lock()` is Node.js 22+ experimental API. When
unavailable, `coordinator.ts` falls through to `runUnlocked()` — 100% of
notify runs on this user's machine.

**Solution:** Replace `FileHandle.lock()` with an `O_EXCL` lockfile that works
on all Node.js/Bun versions, while **preserving** every existing coordinator
semantic:

| Semantic | Current (broken) | Phase 1 (fixed) |
|---|---|---|
| Mutual exclusion | `FileHandle.lock()` — fails silently | `O_EXCL` lockfile — portable |
| Signal file (`notify.signal`) | ✓ O_APPEND atomic append | ✓ Unchanged |
| Blocking waiter | `fd.lock('exclusive')` blocking call | Poll lockfile with backoff (see below) |
| Follow-up cycle | ✓ truncate → sync → check size | ✓ Unchanged |
| Waiter dedup | ✓ check signal size after lock acquired | ✓ Unchanged |
| Fail-closed on lock error | No — degrades to `runUnlocked()` | Yes — `skippedSync: true` + error, **never** run unlocked |

**Lockfile details:**

- Path: `~/.config/pew/sync.lock`
- Content: `{ "pid": <number>, "startedAt": "<ISO>" }`
- Created with `O_CREAT | O_EXCL | O_WRONLY` (atomic, fails if exists)
- Removed in `finally` block (crash leaves stale file → next run detects it)

**Stale detection (PID-only):**

```
Lockfile exists → read PID → process.kill(pid, 0)
  ├── throws (ESRCH) → PID dead → remove lockfile, retry acquire
  └── no throw → PID alive → lock is valid, enter wait loop
```

No age-based detection. A slow `fetch()` with no timeout is still a valid
lock holder.

**Blocking waiter (poll-based):**

Since `O_EXCL` doesn't support blocking wait, losers poll with exponential
backoff:

```
Acquire lockfile → EEXIST
  │
  ▼
Append signal (O_APPEND) — ensure dirty follow-up
  │
  ▼
Poll loop (up to lockTimeoutMs):
  1. Check stale (PID dead?) → if stale, remove + retry acquire
  2. sleep(backoff) — start 100ms, double each iteration, cap at 2s
  3. Try acquire lockfile (O_EXCL)
     ├── SUCCESS → waiter dedup check (signal size == 0 → skip, > 0 → sync)
     └── EEXIST → continue loop
  │
  ▼ (timeout)
Return { error: "lock timeout", skippedSync: true }
```

This preserves the blocking handoff semantic: losers don't exit, they wait for
the lock and either run sync themselves or skip if the follow-up consumed
their notification.

**Key change in coordinator.ts:**

The `runCoordinator()` function's lock acquisition is replaced:

```
BEFORE: fd.lock('exclusive', { nonBlocking: true }) → catch EAGAIN → fd.lock('exclusive')
AFTER:  writeFile(lockPath, pid, O_EXCL) → catch EEXIST → poll loop with stale check
```

Everything after lock acquisition (`runLockedCycles`,
`appendSignal`, `truncateSignal`, `readSignalSize`, `writeRunLog`) remains
**unchanged**. `runUnlocked()` is **removed** — there is no fallback to
unlocked execution. If the lockfile cannot be acquired or created, the run
returns `{ skippedSync: true, error: "..." }` and exits without executing sync.

**Lock release:**

```typescript
// In finally block
try {
  const content = await readFile(lockPath, 'utf8');
  const { pid } = JSON.parse(content);
  if (pid === process.pid) {
    await unlink(lockPath);
  }
  // If PID doesn't match, another process stole the lock (shouldn't happen
  // but defensive). Don't remove someone else's lockfile.
} catch { /* lockfile already removed or unreadable — fine */ }
```

**Failure mode analysis (Phase 1):**

| Failure point | State after restart | Behavior |
|---|---|---|
| Crash after lock, before sync | Stale lockfile on disk | Next run detects dead PID → removes lockfile → proceeds |
| Crash during sync | Stale lockfile; queue/cursors in unknown state | Next run removes stale lockfile; existing crash recovery applies |
| Normal exit | Lockfile removed in `finally` | Clean |
| PID recycled (rare) | Lockfile with live PID that's a different process | Poll loop waits until timeout; worst case = delayed sync (60s) |

### Phase 2: Idempotent Token Queue (Prerequisite for Cursor-After-Upload)

> **Status: deferred.**

**Why deferred:** Phase 2 was originally designed to enable cursor-after-upload
(persist cursors only after successful upload, preventing data loss on upload
failure). Post-Phase 1 analysis shows this is unnecessary for correctness
today, and the cost/risk of implementing it now outweighs the benefit.

**Argument for deferral:**

1. **The SUM-based merge is correct under Phase 1's lock.** The dirty-key loss
   bug (doc 28 root cause) was caused by concurrent writers racing on
   `queue.state.json` without mutual exclusion. Phase 1's O_EXCL lockfile
   guarantees single-writer semantics. With only one process modifying the
   queue at a time, the read-modify-write sequence in `sync.ts:551-563`
   (`loadDirtyKeys → union → saveDirtyKeys`) is atomic — no keys can be lost.

2. **The double-count risk is crash-only and bounded.** The current write order
   (queue first, cursor second — `sync.ts:568-575`) means a crash between
   queue write and cursor save causes the next run to re-parse the same deltas
   and SUM them into the queue again (2× inflation). But this requires:
   - A process crash at exactly the right 10ms window (between queue write and
     cursor save)
   - The user does NOT run `pew reset && pew sync` afterward
   - The doubled values reach the server before anyone notices

   In practice, `pew notify` runs complete in <500ms and crashes at this exact
   point have never been observed. The code comment at `sync.ts:572-573`
   already documents this as an accepted trade-off:
   > "values ≥ true (minor over-count for one sync cycle, recoverable via
   > pew reset)"

3. **Existing replay detection prevents the common re-parse case.** The
   `knownFilePaths` mechanism (v1.6.0) detects "cursor entry lost vs genuinely
   new file" and triggers a full rescan when a cursor is missing for a
   previously-known file. The full-scan branch uses `queue.overwrite()` (not
   SUM merge), which produces idempotent results. This covers the most likely
   real-world scenario where cursors become corrupted or truncated.

4. **Phase 2 has significant implementation cost and new failure modes.** Both
   candidate approaches (Option A: full-snapshot overwrite, Option B: staged
   delta with commit) require changing the queue write model, the cursor
   rollback logic, and the upload engine. Option B introduces a new crash
   window (between staging commit and cursor write). This complexity is not
   justified when the current model is correct under single-writer lock.

5. **Cursor-after-upload (the feature Phase 2 enables) is a nice-to-have, not
   a correctness requirement.** Today, if an upload fails, the cursors are
   already saved — the next run produces 0 new deltas (all already in queue)
   and re-uploads the existing dirty keys. Data reaches the server on retry.
   Cursor-after-upload would skip the redundant re-parse, but the redundant
   re-parse is harmless (0 deltas, no inflation) and fast (<100ms).

**When to revisit:** Phase 2 becomes necessary if any of these conditions arise:
- Upload failures become frequent enough that redundant re-parses cause
  noticeable latency (unlikely with Phase 3's 5-minute cooldown)
- A new feature requires crash-safe exactly-once queue semantics
- The queue file grows large enough (~10MB+) that full-snapshot overwrites
  on every sync become a performance bottleneck

**Goal:** Make the token merge idempotent so that re-parsing the same deltas
does not inflate values.

**Problem:** `aggregateRecords([...oldRecords, ...records])` uses SUM. If the
same deltas appear in both `oldRecords` (from a previous parse) and `records`
(from re-parsing after cursor rollback), the values double.

**Two candidate approaches:**

#### Option A: Full-Snapshot Overwrite

On each sync cycle, the queue stores a **complete snapshot** of all token data
from source files — not a delta. `queue.overwrite(records)` replaces the
entire queue with the current computed state.

- **Pro:** Simplest mental model. Any re-parse produces the same snapshot.
- **Con:** Every sync rewrites the entire queue file (currently ~900KB).
  With 5-minute intervals this is tolerable. Must also change how cursor
  rollback works (cursor must be rolled back far enough to reconstruct the
  full snapshot, not just the new deltas).

#### Option B: Staged Delta with Commit

Deltas are written to a staging area (`queue.staging.jsonl`). On upload
success, they are committed into the main queue. On failure, the staging
area is discarded and the cursor is not advanced.

- **Pro:** Only new deltas are written on each cycle. Cursor-after-upload
  becomes safe because uncommitted deltas are discarded on failure.
- **Con:** More moving parts. Must handle crash between commit and cursor
  write.

**Decision deferred** until Phase 1 is validated in production. Both options
are compatible with the server's overwrite upsert.

Once idempotency is guaranteed, cursor-after-upload becomes safe:

```
sync+upload: parse → merge queue → upload dirty → SUCCESS → write cursors
                                                → FAILURE → skip cursor write
```

Re-parsing + re-merging with an idempotent model produces the same values,
so no double-counting occurs.

### Phase 3: Cooldown Optimization

> **Status: done.**

**Goal:** Reduce the number of sync cycles from ~130 concurrent to ~48
sequential runs per 4-hour window.

**Prerequisite:** Phase 1 (lock works correctly). ✅

**Mechanism:** After acquiring the lock, the coordinator reads `last-run.json`.
If the last **successful** run completed less than 5 minutes ago, skip sync
and release the lock. The signal file is NOT consumed (no `truncateSignal`),
so accumulated signals persist for the next run after cooldown expires.

| Trigger | Cooldown check | Rationale |
|---|---|---|
| `pew notify` (hook) | Skip if last sync < 5 min ago | High-frequency hooks; data arrives in 30-min buckets anyway |
| `pew sync` (manual) | Always execute, ignore cooldown | User explicitly requested; bypasses coordinator entirely |

**Why 5 minutes:** Token data is bucketed into 30-minute windows. A 5-minute
sync interval means at most 6 syncs per bucket window — more than enough to
capture all deltas while dramatically reducing the number of sync cycles.

**Design details:**

- Cooldown check happens **inside the lock**, after acquisition, before `runLockedCycles()`
- Only **successful** runs count — error/skipped runs do NOT reset the cooldown timer
- Result: `{ skippedSync: true, skippedReason: "cooldown" }`
- `skippedReason` is added to both `CoordinatorRunResult` and `RunLogEntry.coordination`
- Default cooldown: 5 minutes (300,000 ms), configurable via `CoordinatorOptions.cooldownMs`
- `cooldownMs: 0` disables cooldown (always runs)
- Missing/corrupted `last-run.json` → no cooldown (treat as first run ever)

## Files to Modify

### Phase 1 (Fix the Lock)

| File | Change |
|---|---|
| `packages/cli/src/notifier/coordinator.ts` | Replace `FileHandle.lock()` with O_EXCL lockfile; preserve signal/dedup semantics; add PID-based stale detection |
| New: `packages/cli/src/notifier/lockfile.ts` | O_EXCL lockfile module: acquire, release, stale detection |
| `packages/cli/src/__tests__/coordinator.test.ts` | Update lock acquisition tests; add stale PID tests |
| New: `packages/cli/src/__tests__/lockfile.test.ts` | L1 tests for lockfile module |

### Phase 2 (Idempotent Queue) — future

| File | Change |
|---|---|
| `packages/cli/src/commands/sync.ts` | Replace SUM-based merge with snapshot overwrite or staged delta |
| `packages/cli/src/commands/upload.ts` | Update `aggregateRecords()` if snapshot model is chosen |
| `packages/cli/src/storage/base-queue.ts` | Add staging area if staged delta model is chosen |

### Phase 3 (Cooldown) — done

| File | Change |
|---|---|
| `packages/cli/src/notifier/coordinator.ts` | Add cooldown check after lock acquisition; `cooldownMs` option; `skippedReason` in run log |
| `packages/core/src/types.ts` | Add `skippedReason` to `CoordinatorRunResult` and `RunLogEntry.coordination` |
| `packages/cli/src/__tests__/coordinator.test.ts` | 9 cooldown unit tests |
| `packages/cli/src/__tests__/coordinator-integration.test.ts` | 4 cooldown integration tests |

## Implementation Steps

| # | Phase | Commit | Description | Status |
|---|-------|--------|-------------|--------|
| 1 | — | `docs: add notify concurrency dirty-key loss investigation` | This document | done |
| 2 | 1 | `test: add O_EXCL lockfile acquire/release/stale tests` | L1 tests for new lock module | done |
| 3 | 1 | `feat: implement O_EXCL lockfile with PID-based stale detection` | New `lockfile.ts` module | done |
| 4 | 1 | `test: update coordinator tests for O_EXCL lock` | Replace FileHandle.lock mock with lockfile mock | done |
| 5 | 1 | `feat: replace FileHandle.lock with O_EXCL lockfile in coordinator` | Core fix — working mutual exclusion | done |
| 6 | 1 | `test: integration test for concurrent notify serialization` | Simulate concurrent notify; verify dirty keys intact | done |
| 7 | 1 | `chore: remove FileHandle.lock and runUnlocked code paths` | Clean up dead code; no unlocked fallback remains | done (no dead code found in src/) |
| 8 | 2 | — | Design decision: snapshot vs staged delta | deferred |
| 9 | 2 | — | Implement idempotent token queue | deferred |
| 10 | 2 | — | Cursor-after-upload (safe after idempotent queue) | deferred |
| 11 | 3 | `docs: defer Phase 2, detail Phase 3 cooldown steps` | Update doc 28 status | done |
| 12 | 3 | `feat: add skippedReason to CoordinatorRunResult and RunLogEntry` | Core type change | done |
| 13 | 3 | `test: add cooldown coordinator unit tests` | TDD: write tests first | done |
| 14 | 3 | `feat: implement cooldown check in coordinator` | Read last-run.json, skip if < cooldownMs since last success | done |
| 15 | 3 | `test: add cooldown integration test` | Real filesystem cooldown behavior | done |
| 16 | 3 | `docs: mark Phase 3 as done in doc 28` | Update status | done |
