# 11. Phase 2: Run Log + Notify Session Sync Fix (COMPLETED)

> **Status**: All 6 steps completed (2026-03-10). Run log writing, session sync gap fix, and full integration verified.
> **Tests**: 30 coordinator tests + 7 notify tests + session-sync tests. 503 CLI tests + 87 core tests pass. Full build succeeds.

## Overview

Phase 1 (docs/10, docs/10b) established the coordinator and notifier hooks. Two gaps remain before the hook-driven sync path is fully functional:

1. **No persistent Run Log** — coordinator results vanish after `pew notify` exits
2. **`pew notify` skips session sync** — only token data is synced via hooks

This document is the implementation plan for closing both gaps.

## Problem Statement

### Gap 1: No Run Log

The coordinator returns a `CoordinatorRunResult` (runId, triggers, hadFollowUp, waitedForLock, skippedSync, error) to the caller, but this data is never persisted. There is no way to answer:

- When was the last hook-triggered sync?
- How many files were scanned? How many deltas/records produced?
- Why did a notify produce zero output?
- Was the sync skipped because another process already handled it?
- Did a dirty follow-up occur?

Additionally, the coordinator's `executeSyncFn` signature is `(triggers: SyncTrigger[]) => Promise<void>`, which **discards** the `SyncResult` and `SessionSyncResult` returned by the sync functions. Even if we added run log writing, there would be no business data to log.

### Gap 2: Notify Skips Session Sync

`executeNotify` in `commands/notify.ts` constructs a default `executeSyncFn` that only calls `executeSync` (token sync). It does not call `executeSessionSync`. The `pew sync` CLI command calls both.

This means hook-driven sync (all 5 AI tool hooks) only produces token queue records. Session data is only synced when the user manually runs `pew sync`.

The `notifyCommand` in `cli.ts` also only dynamically imports `openMessageDb` but not `openSessionDb`, so even if session sync were added to `executeNotify`, the OpenCode SQLite session adapter would be missing.

### Why Fix Together

Run log needs complete sync results (both token and session). Fixing Gap 2 is a prerequisite for Gap 1 to produce meaningful data. Both changes touch the same `executeSyncFn` signature and `notify.ts` wrapper.

## Design

### Run Log Schema

Each coordinator run writes a structured JSON file at `~/.config/pew/runs/<runId>.json`, plus a convenience copy at `~/.config/pew/last-run.json`.

```ts
/** Persisted to ~/.config/pew/runs/<runId>.json */
export interface RunLogEntry {
  /** Unique run identifier (ISO-timestamp-randomSuffix) */
  runId: string;
  /** pew CLI version (e.g. "0.7.0") */
  version: string;
  /** Original trigger that initiated this run */
  trigger: SyncTrigger;

  /** ISO 8601 timestamps */
  startedAt: string;
  completedAt: string;
  durationMs: number;

  /** Coordinator lifecycle metadata */
  coordination: {
    waitedForLock: boolean;
    skippedSync: boolean;
    hadFollowUp: boolean;
    followUpCount: number;
    degradedToUnlocked: boolean;
  };

  /**
   * Sync results per cycle.
   * Array because dirty follow-ups produce multiple cycles.
   * Empty array if skippedSync is true.
   *
   * Each cycle independently records token and session results.
   * Either sub-result may be absent if that phase failed or was skipped,
   * with the corresponding error field explaining why.
   */
  cycles: SyncCycleResult[];

  /** Overall run outcome */
  status: "success" | "partial" | "error" | "skipped";
  error?: string;
}

/** Result of a single sync execution within a coordinator run.
 *
 * Token and session results are independently optional. This allows
 * partial success to be recorded: e.g. token sync succeeds but session
 * sync fails. The cycle is never all-or-nothing.
 */
export interface SyncCycleResult {
  /** Token sync results (absent if token sync failed or was skipped) */
  tokenSync?: {
    totalDeltas: number;
    totalRecords: number;
    filesScanned: Record<string, number>;
    sources: Record<string, number>;
  };
  /** Error from token sync phase, if it failed */
  tokenSyncError?: string;

  /** Session sync results (absent if session sync failed or was skipped) */
  sessionSync?: {
    totalSnapshots: number;
    totalRecords: number;
    filesScanned: Record<string, number>;
    sources: Record<string, number>;
  };
  /** Error from session sync phase, if it failed */
  sessionSyncError?: string;
}
```

**Design decisions:**

- **`cycles` array** instead of flat aggregate: one run can execute multiple sync cycles (dirty follow-up), and each cycle's results should be individually visible.
- **Token and session are independently optional** within each cycle: if token sync succeeds but session sync throws, the cycle records the full token result plus `sessionSyncError`. This avoids the all-or-nothing problem where partial success data is lost.
- **`status: "partial"`**: a new status for when at least one cycle had a mix of success and failure across token/session phases.
- **`version` via `CoordinatorOptions`**: injected by the caller (e.g. `notify.ts`), not read from package.json at runtime. Simple, testable, no I/O.
- **`degradedToUnlocked`**: tracked because it indicates the lock API was unavailable, which is important for debugging cross-process coordination.
- **`filesScanned` on both token and session sync**: session sync performs its own file discovery, so tracking scan counts is equally important for diagnosing "why no sessions?" questions.
- **Run log write failures are non-fatal**: catch and swallow errors. The run log is a debugging aid, not a critical path.
- **No auto-cleanup**: files are ~500 bytes each. Even 100 syncs/day = ~50KB/day. Cleanup can be added later via `pew runs --prune`.

### executeSyncFn Signature Change

Current:
```ts
executeSyncFn: (triggers: SyncTrigger[]) => Promise<void>
```

New:
```ts
executeSyncFn: (triggers: SyncTrigger[]) => Promise<SyncCycleResult>
```

The function always returns a `SyncCycleResult`. It never throws — errors from individual sync phases are captured inside the result as `tokenSyncError` / `sessionSyncError`. This means:

- The coordinator does not need try/catch around `executeSyncFn` for result collection
- Partial success (token OK, session failed) is naturally represented
- Each cycle in the `cycles` array is always a valid `SyncCycleResult`, never null

The coordinator's existing error handling for unexpected failures (e.g. the entire function crashes due to a bug, not a sync-phase error) still uses try/catch, recording the error in `CoordinatorRunResult.error` and producing a cycle with both phases absent.

### Notify Upload Policy

**`pew notify` does NOT run upload.** This is by design:
- Notify runs in a background process spawned by AI tool hooks
- Upload requires network I/O and may be slow/unreliable
- Upload is triggered by `pew sync --upload` (default behavior) when the user explicitly syncs

## Implementation Steps

Each step is an atomic commit. Tests must pass after each step.

### Step 1: Add types to `@pew/core`

**Files changed**: `packages/core/src/types.ts`

Add:
- `SyncCycleResult` interface (with independently optional `tokenSync` / `sessionSync` + per-phase error fields)
- `RunLogEntry` interface
- Update `CoordinatorRunResult` to include:
  - `cycles: SyncCycleResult[]`
  - `followUpCount: number`
  - `degradedToUnlocked: boolean`

Existing `CoordinatorRunResult` fields (`runId`, `triggers`, `hadFollowUp`, `waitedForLock`, `skippedSync`, `error`) remain unchanged.

**Verification**: `bun run build` (types only, no runtime change)

### Step 2: Add `filesScanned` to `SessionSyncResult`

**Files changed**: `packages/cli/src/commands/session-sync.ts`

- Add `filesScanned: { claude: number; codex: number; gemini: number; opencode: number; openclaw: number }` to `SessionSyncResult`
- Track file counts during discovery (same pattern as token sync's existing `filesScanned`)
- Return them in the result

**Files changed**: `packages/cli/src/__tests__/session-sync.test.ts`

- Add assertions for `filesScanned` on existing tests
- Add a targeted test: verify filesScanned counts match discovered files

**Files changed**: `packages/cli/src/cli.ts`

- Display session filesScanned in the sync command output (matching the existing token filesScanned display)

**Verification**: `bun test packages/cli/src/__tests__/session-sync.test.ts`

### Step 3: Update `executeSyncFn` signature in coordinator

**Files changed**: `packages/cli/src/notifier/coordinator.ts`

- Change `executeSyncFn` type from `Promise<void>` to `Promise<SyncCycleResult>`
- In `runLockedCycles`: collect each cycle's return value into a `cycles: SyncCycleResult[]` array. On unexpected throw (not a sync-phase error but a crash), record a cycle with both phases absent and the error in `CoordinatorRunResult.error`.
- In `runUnlocked`: collect the single cycle result, same error handling
- Add `version` to `CoordinatorOptions`
- Track `degradedToUnlocked` boolean through all code paths
- Return `cycles`, `followUpCount`, and `degradedToUnlocked` in `CoordinatorRunResult`

**No run log writing yet** — just signature change and result collection.

**Files changed**: `packages/cli/src/__tests__/coordinator.test.ts`

- Update all 16 existing test mocks: `executeSyncFn` now returns `{}` (empty `SyncCycleResult` — both phases absent, which is the minimal valid value)
- Add assertions for new fields (`cycles`, `followUpCount`, `degradedToUnlocked`) on existing tests
- New tests:
  - executeSyncFn returns a full SyncCycleResult → appears in `result.cycles[0]`
  - Follow-up produces multiple cycles → `result.cycles.length` matches execution count
  - executeSyncFn throws unexpectedly → cycle is `{}` (empty), error captured in `result.error`
  - Partial success cycle (tokenSync present, sessionSyncError present) → correctly stored

**Verification**: `bun test packages/cli/src/__tests__/coordinator.test.ts`

### Step 4: Add run log writer to coordinator

**Files changed**: `packages/cli/src/notifier/coordinator.ts`

Add internal `writeRunLog` function:
- Creates `runs/` directory under `stateDir`
- Writes `runs/<runId>.json` with `RunLogEntry`
- Writes `last-run.json` (overwrite) in `stateDir`
- Uses existing `fs.mkdir` and `fs.writeFile` from `FsOps` (already injected)
- All errors caught and silently swallowed (non-fatal)
- Determines `status` field: `"skipped"` if skippedSync, `"error"` if all cycles failed, `"partial"` if any cycle has mixed success/failure, `"success"` otherwise

Call `writeRunLog` at the end of `coordinatedSync`, after all code paths (locked, unlocked, skipped, timeout, error).

**Files changed**: `packages/cli/src/__tests__/coordinator.test.ts`

New tests:
- Run log file written to `runs/<runId>.json` with correct schema
- `last-run.json` written with same content
- `runs/` directory created via `fs.mkdir`
- Skipped sync → run log has `status: "skipped"`, empty `cycles`
- Error during sync → run log has `status: "error"`, `error` field populated
- Lock timeout → run log has `status: "skipped"`, `error: "lock timeout"`
- Follow-up → run log has multiple entries in `cycles`
- Unlocked degradation → run log has `coordination.degradedToUnlocked: true`
- Partial success (tokenSync OK, sessionSyncError) → run log has `status: "partial"`
- Run log write failure → coordinatedSync still returns normally (non-fatal)

**Verification**: `bun test packages/cli/src/__tests__/coordinator.test.ts`

### Step 5: Fix session sync gap in `executeNotify`

**Files changed**: `packages/cli/src/commands/notify.ts`

- Add `openSessionDb` field to `NotifyOptions` (explicit field, NOT extending `SessionSyncOptions` — the two option interfaces have conflicting `onProgress` event types)
- Update default `executeSyncFn` to:
  1. Call `executeSync` in a try/catch → populate `tokenSync` or `tokenSyncError`
  2. Call `executeSessionSync` in a try/catch → populate `sessionSync` or `sessionSyncError`
  3. Return composed `SyncCycleResult` (never throws, partial success is natural)

**Files changed**: `packages/cli/src/cli.ts`

- In `notifyCommand`: dynamically import `openSessionDb` alongside `openMessageDb`
- Pass `openSessionDb` to `executeNotify`

**Files changed**: `packages/cli/src/__tests__/notify-command.test.ts`

- Update mocks for new `executeSyncFn` signature (returns `SyncCycleResult`)
- New tests:
  - Default executeSyncFn calls both token sync and session sync
  - Token sync succeeds + session sync fails → SyncCycleResult has `tokenSync` + `sessionSyncError`
  - Both succeed → SyncCycleResult has both `tokenSync` + `sessionSync`

**Verification**: `bun test packages/cli/src/__tests__/notify-command.test.ts`

### Step 6: Full integration verification

Run all tests:
```bash
bun test --filter 'packages/cli'
```

Build:
```bash
bun run build
```

Manual verification:
```bash
# Reset ALL state (token + session cursors, queues, and run logs)
rm -f ~/.config/pew/cursors.json ~/.config/pew/queue.jsonl ~/.config/pew/queue.state.json
rm -f ~/.config/pew/session-cursors.json ~/.config/pew/session-queue.jsonl ~/.config/pew/session-queue.state.json
rm -rf ~/.config/pew/runs/ ~/.config/pew/last-run.json

# Run notify
NODE_TLS_REJECT_UNAUTHORIZED=0 bun packages/cli/dist/bin.js notify --source=opencode

# Check run log exists and has correct structure
cat ~/.config/pew/last-run.json | jq .
ls ~/.config/pew/runs/

# Verify both token AND session data present (the core Gap 2 fix)
cat ~/.config/pew/last-run.json | jq '.cycles[0] | keys'
# Expected: ["sessionSync", "tokenSync"] (or with error variants)

# Verify non-zero counts (confirms session sync actually ran with fresh cursors)
cat ~/.config/pew/last-run.json | jq '.cycles[0].tokenSync.totalDeltas, .cycles[0].sessionSync.totalSnapshots'
```

## Test Plan Summary

### Existing tests to update (Step 2 + Step 3 + Step 5)

| File | Tests | Change |
|------|-------|--------|
| `session-sync.test.ts` | existing | Add `filesScanned` assertions |
| `coordinator.test.ts` | 16 tests | Mock returns `{}`, add assertions for new fields |
| `notify-command.test.ts` | 3 tests | Mock returns `SyncCycleResult` |

### New tests (Step 2 + Step 3 + Step 4 + Step 5)

| Category | Tests | Step |
|----------|-------|------|
| Session filesScanned | 1-2 | Step 2 |
| Cycle result collection | 4 | Step 3 |
| Run log file writing | 10 | Step 4 |
| Session sync in notify + partial success | 3 | Step 5 |

Total: ~18 new tests + 19+ updated tests.

## File Change Summary

| File | Steps | Nature |
|------|-------|--------|
| `packages/core/src/types.ts` | 1 | Add `SyncCycleResult`, `RunLogEntry`, update `CoordinatorRunResult` |
| `packages/cli/src/commands/session-sync.ts` | 2 | Add `filesScanned` to `SessionSyncResult` |
| `packages/cli/src/notifier/coordinator.ts` | 3, 4 | Signature change, result collection, run log writer |
| `packages/cli/src/commands/notify.ts` | 5 | Add session sync (explicit `openSessionDb` field, no interface extension), return `SyncCycleResult` |
| `packages/cli/src/cli.ts` | 2, 5 | Session filesScanned display; import `openSessionDb`, pass to notify |
| `packages/cli/src/__tests__/session-sync.test.ts` | 2 | Add `filesScanned` assertions |
| `packages/cli/src/__tests__/coordinator.test.ts` | 3, 4 | Update mocks, ~14 new tests |
| `packages/cli/src/__tests__/notify-command.test.ts` | 5 | Update mocks, ~3 new tests |

## Future Phases

See `docs/13-phase3-unified-source-drivers.md` (Phase 3+4 merged into a single refactor).
