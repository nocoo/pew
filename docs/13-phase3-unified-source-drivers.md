# 13. Phase 3+4: Unified Source Driver Architecture

> **Status**: Planning (2026-03-10). Merges the originally-separate Phase 3 (ScanPlan) and Phase 4 (SourceDriver) into a single refactor.
> **Depends on**: Phase 2 (docs/11, completed)

## Motivation

Phase 2 made hook-driven sync fully functional (token + session + run log). But the sync codebase has significant structural debt:

1. **Duplicated discovery loops** — `sync.ts` (614 lines) and `session-sync.ts` (587 lines) each contain 5+ near-identical per-source discovery-parse-cursor loops (~60-70% structural overlap).
2. **Inconsistent skip optimization** — Session sync has a unified `fileChanged(mtime, size)` gate for all sources. Token sync only has it for OpenCode JSON (triple-check); Claude/OpenClaw/Codex/Gemini open every file on every run even if nothing changed.
3. **Duplicated cursor stores** — `CursorStore` and `SessionCursorStore` are 95% character-for-character identical (39 lines each, differ by 3 tokens).
4. **No pluggable source abstraction** — Adding a new AI tool requires editing `sync.ts`, `session-sync.ts`, `sources.ts`, `notify.ts`, and `cli.ts`. There is no single place that defines "what is a source."

### Why Phase 3 and Phase 4 are merged

The original roadmap had Phase 3 (ScanPlan — shared discovery) and Phase 4 (SourceDriver — pluggable parsers) as separate steps. Code analysis revealed they are tightly coupled: ScanPlan would define per-source discovery strategies, and SourceDriver would also contain discovery strategies. Building ScanPlan first would require immediate re-architecture when SourceDriver arrives. Merging avoids this throwaway work.

## Current Architecture (Before)

```
sync.ts (614 lines)
  ├── Claude:   discoverClaudeFiles() → for-loop → parseClaudeFile() → cursor update
  ├── Gemini:   discoverGeminiFiles() → for-loop → parseGeminiFile() → cursor update
  ├── OpenCode: discoverOpenCodeFiles() → for-loop → parseOpenCodeFile() → cursor update
  ├── OpenCode SQLite: stat() → openMessageDb() → queryMessages() → cursor update
  ├── OpenClaw: discoverOpenClawFiles() → for-loop → parseOpenClawFile() → cursor update
  ├── Codex:    discoverCodexFiles() → for-loop → parseCodexFile() → cursor update
  └── Aggregation: half-hour bucket → queue write

session-sync.ts (587 lines)
  ├── Claude:   discoverClaudeFiles() → for-loop → collectClaudeSessions() → cursor update
  ├── Gemini:   discoverGeminiFiles() → for-loop → collectGeminiSessions() → cursor update
  ├── OpenCode: discoverOpenCodeSessionDirs() → for-loop → collectOpenCodeSessions() → cursor update
  ├── OpenCode SQLite: stat() → openSessionDb() → querySessions() → cursor update
  ├── OpenClaw: discoverOpenClawFiles() → for-loop → collectOpenClawSessions() → cursor update
  ├── Codex:    discoverCodexFiles() → for-loop → collectCodexSessions() → cursor update
  └── Deduplication: deduplicateSessionRecords() → queue write
```

### Overlap Analysis

| Aspect | Token Sync | Session Sync |
|--------|-----------|--------------|
| Discovery functions | Shares 4/5 from `sources.ts` | Same 4/5 + local `discoverOpenCodeSessionDirs()` |
| File skip logic | Only OpenCode JSON (triple-check) | Unified `fileChanged(mtime, size)` for 4/6 sources |
| Parsing mode | Incremental (byte offset / array index) | Full-scan on change |
| Cursor types | 5 different types with source-specific fields | Uniform `{ mtimeMs, size }` |
| Post-processing | Half-hour bucket aggregation | Session dedup |
| CursorStore class | `CursorStore` (39 lines) | `SessionCursorStore` (39 lines, 95% identical) |

### Per-Source Cursor Strategy Divergence

| Source | Token Cursor | Skip Gate | Session Cursor | Skip Gate |
|--------|-------------|-----------|----------------|-----------|
| Claude | `ByteOffsetCursor` (inode + offset) | None -- always opens | `SessionFileCursor` (mtime + size) | `fileChanged()` |
| OpenClaw | `ByteOffsetCursor` (inode + offset) | None -- always opens | `SessionFileCursor` (mtime + size) | `fileChanged()` |
| Codex | `CodexCursor` (inode + offset + lastTotals + lastModel) | None -- always opens | `SessionFileCursor` (mtime + size) | `fileChanged()` |
| Gemini | `GeminiCursor` (inode + lastIndex + lastTotals + lastModel) | None -- always opens | `SessionFileCursor` (mtime + size) | `fileChanged()` |
| OpenCode JSON | `OpenCodeCursor` (inode + size + mtime + lastTotals + messageKey) | Triple-check (inode + size + mtime) | `SessionFileCursor` (mtime only) | Inline mtime check |
| OpenCode SQLite | `OpenCodeSqliteCursor` (watermark + processedIds) | N/A (DB query) | `OpenCodeSqliteSessionCursor` (watermark + processedIds) | N/A (DB query) |

**Key insight**: `FileCursorBase` currently has `inode` + `updatedAt` but is missing `mtimeMs` + `size`. Adding those two fields enables all token-sync sources to benefit from the same fast-skip optimization that only OpenCode JSON has today.

## Target Architecture (After)

```
drivers/
├── types.ts                              # TokenDriver / SessionDriver interfaces
├── registry.ts                           # createTokenDrivers() / createSessionDrivers()
├── token/
│   ├── claude-token-driver.ts            # wraps parsers/claude.ts + discovery
│   ├── gemini-token-driver.ts            # wraps parsers/gemini.ts + discovery
│   ├── opencode-json-token-driver.ts     # wraps parsers/opencode.ts + discovery
│   ├── opencode-sqlite-token-driver.ts   # wraps parsers/opencode-sqlite.ts
│   ├── openclaw-token-driver.ts          # wraps parsers/openclaw.ts + discovery
│   └── codex-token-driver.ts             # wraps parsers/codex.ts + discovery
└── session/
    ├── claude-session-driver.ts          # wraps parsers/claude-session.ts + discovery
    ├── gemini-session-driver.ts          # wraps parsers/gemini-session.ts + discovery
    ├── opencode-json-session-driver.ts   # wraps parsers/opencode-session.ts + discovery
    ├── opencode-sqlite-session-driver.ts # wraps parsers/opencode-sqlite-session.ts
    ├── openclaw-session-driver.ts        # wraps parsers/openclaw-session.ts + discovery
    └── codex-session-driver.ts           # wraps parsers/codex-session.ts + discovery

utils/
└── file-changed.ts                       # fileUnchanged() shared utility

storage/
├── base-cursor-store.ts                  # Generic BaseCursorStore<T>
├── cursor-store.ts                       # extends BaseCursorStore<CursorState>
└── session-cursor-store.ts               # extends BaseCursorStore<SessionCursorState>

commands/
├── sync.ts                               # generic driver loop (replaces 6 inline blocks)
└── session-sync.ts                       # generic driver loop (replaces 6 inline blocks)
```

### Driver Interfaces

```ts
/** Shared file stat fingerprint for change detection */
interface FileFingerprint {
  inode: number;
  mtimeMs: number;
  size: number;
}

/** Token driver: discover files, detect changes, parse incrementally */
interface TokenDriver<TCursor extends FileCursorBase = FileCursorBase> {
  readonly source: SourceName;

  /** Discover candidate files/dirs for this source */
  discover(opts: DiscoverOpts): Promise<string[]>;

  /** Fast skip: has this file changed since last cursor? */
  shouldSkip(cursor: TCursor | undefined, fingerprint: FileFingerprint): boolean;

  /** Extract incremental resume state from cursor (offset, lastIndex, etc.) */
  resumeState(cursor: TCursor | undefined, fingerprint: FileFingerprint): ResumeState;

  /** Parse file from resume point, return deltas + new cursor data */
  parse(filePath: string, resume: ResumeState): Promise<TokenParseResult>;

  /** Build cursor to persist after successful parse */
  buildCursor(fingerprint: FileFingerprint, result: TokenParseResult, prev?: TCursor): TCursor;
}

/** Session driver: discover files, detect changes, parse full-scan */
interface SessionDriver {
  readonly source: SourceName;

  /** Discover candidate files/dirs for this source */
  discover(opts: DiscoverOpts): Promise<string[]>;

  /** Fast skip: has this file changed since last cursor? */
  shouldSkip(cursor: SessionFileCursor | undefined, fingerprint: FileFingerprint): boolean;

  /** Full-scan parse, return session snapshots */
  parse(filePath: string): Promise<SessionSnapshot[]>;

  /** Build cursor to persist after successful parse */
  buildCursor(fingerprint: FileFingerprint): SessionFileCursor;
}
```

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Phase 3/4 merge | Single refactor | ScanPlan and SourceDriver are tightly coupled; separate phases would require throwaway intermediate abstractions |
| CursorStore | Keep two files, extract `BaseCursorStore<T>` generic | Separate files preserve independent lifecycle (token cursors and session cursors have different schemas); generic base eliminates code duplication |
| Driver granularity | Separate `TokenDriver` and `SessionDriver` | Different parsing modes (incremental vs full-scan), different cursor types, different output types. Forcing them into one interface would require awkward generics |
| OpenCode sources | Two independent drivers (JSON + SQLite) | Simplest decomposition. SQLite cross-source dedup handled via orchestrator passing messageKey set |
| File skip optimization | Add `mtimeMs` + `size` to `FileCursorBase` | Aligns token sync with session sync's existing optimization; all sources gain fast-skip for free |
| Existing parsers | Unchanged | Drivers are thin wrappers; parsers retain their current signatures and tests |

## Implementation Steps

Each step is an atomic commit. Tests must pass after each step.

### Step 1: Extend `FileCursorBase` + add `fileUnchanged()` utility

**Goal**: Add the missing `mtimeMs` and `size` fields to all token cursors, and create a shared change-detection function.

**Files changed**:
- `packages/core/src/types.ts` — Add `mtimeMs: number` and `size: number` to `FileCursorBase`
- `packages/cli/src/utils/file-changed.ts` — New file: `fileUnchanged(prev: { inode, mtimeMs, size } | undefined, curr: { inode, mtimeMs, size }): boolean`
- `packages/cli/src/__tests__/file-changed.test.ts` — Tests for `fileUnchanged()`
- `packages/cli/src/commands/sync.ts` — Update cursor writes for Claude, OpenClaw, Codex, Gemini to include `mtimeMs: st.mtimeMs, size: st.size` in the persisted cursor object

**Behavior change**: None. Cursors gain new fields but skip logic is not yet wired. Old cursor files missing these fields are handled via `?? 0` defaults.

**Verification**: `bun run build && bun test`

### Step 2: Extract `BaseCursorStore<T>` generic

**Goal**: Eliminate the duplicated `load()` / `save()` logic between the two cursor stores.

**Files changed**:
- `packages/cli/src/storage/base-cursor-store.ts` — New file: generic `BaseCursorStore<T>` with shared `load()` and `save()` methods
- `packages/cli/src/storage/cursor-store.ts` — Extend `BaseCursorStore<CursorState>`, remove duplicated logic
- `packages/cli/src/storage/session-cursor-store.ts` — Extend `BaseCursorStore<SessionCursorState>`, remove duplicated logic
- `packages/cli/src/__tests__/base-cursor-store.test.ts` — Tests for the generic base class

**Behavior change**: None. Pure refactor.

**Verification**: `bun test packages/cli/src/__tests__/cursor-store.test.ts packages/cli/src/__tests__/session-cursor-store.test.ts` (existing tests must still pass)

### Step 3: Define `TokenDriver` and `SessionDriver` interfaces + internal types

**Goal**: Establish the driver contract without changing any runtime behavior.

**Files changed**:
- `packages/core/src/types.ts` — Add `TokenDriver<TCursor>`, `SessionDriver`, `FileFingerprint`, `TokenParseResult`, `ResumeState` interfaces
- `packages/cli/src/drivers/types.ts` — New file: internal types (`DiscoverOpts`, driver-specific `ResumeState` variants)

**Behavior change**: None. Types only.

**Verification**: `bun run build`

### Step 4: Implement 6 TokenDrivers

**Goal**: Wrap each source's existing discovery + parser into a `TokenDriver` implementation.

**Files created** (one per source):
- `packages/cli/src/drivers/token/claude-token-driver.ts` — ByteOffset strategy
- `packages/cli/src/drivers/token/gemini-token-driver.ts` — ArrayIndex strategy
- `packages/cli/src/drivers/token/opencode-json-token-driver.ts` — TripleCheck strategy (preserves dir-mtime optimization)
- `packages/cli/src/drivers/token/opencode-sqlite-token-driver.ts` — DB watermark strategy (accepts `messageKeys: Set<string>` for cross-source dedup)
- `packages/cli/src/drivers/token/openclaw-token-driver.ts` — ByteOffset strategy
- `packages/cli/src/drivers/token/codex-token-driver.ts` — ByteOffset + cumulative diff strategy

**Each driver**:
- Implements `TokenDriver<SourceSpecificCursor>`
- `shouldSkip()` uses `fileUnchanged()` from Step 1 (new for Claude/OpenClaw/Codex/Gemini!)
- `resumeState()` extracts source-specific incremental state from cursor
- `parse()` delegates to existing parser function
- `buildCursor()` constructs the typed cursor with all fields including new `mtimeMs`/`size`

**Tests**: `packages/cli/src/__tests__/drivers/token/*.test.ts` — Unit tests per driver

**Existing parser files**: Unchanged.

**Verification**: `bun test --filter 'drivers/token'`

### Step 5: Implement 6 SessionDrivers

**Goal**: Same as Step 4 but for session sync.

**Files created**:
- `packages/cli/src/drivers/session/claude-session-driver.ts`
- `packages/cli/src/drivers/session/gemini-session-driver.ts`
- `packages/cli/src/drivers/session/opencode-json-session-driver.ts` — Discovers directories, mtime-only check
- `packages/cli/src/drivers/session/opencode-sqlite-session-driver.ts` — DB watermark
- `packages/cli/src/drivers/session/openclaw-session-driver.ts`
- `packages/cli/src/drivers/session/codex-session-driver.ts`

**Each driver**:
- Implements `SessionDriver`
- `shouldSkip()` uses `fileUnchanged()` (replaces inline `fileChanged()` helper)
- `parse()` delegates to existing `collect*Sessions()` parser function
- `buildCursor()` returns `{ mtimeMs, size }`

**Tests**: `packages/cli/src/__tests__/drivers/session/*.test.ts`

**Verification**: `bun test --filter 'drivers/session'`

### Step 6: Driver Registry

**Goal**: Single entry point that constructs the active driver set based on runtime options.

**Files changed**:
- `packages/cli/src/drivers/registry.ts` — New file:
  - `createTokenDrivers(opts: SyncOptions): TokenDriver[]` — Returns drivers for enabled sources (based on which directories exist in opts)
  - `createSessionDrivers(opts: SessionSyncOptions): SessionDriver[]` — Same for session
- `packages/cli/src/__tests__/drivers/registry.test.ts` — Tests: correct drivers returned for various opt combinations

**Verification**: `bun test --filter 'drivers/registry'`

### Step 7: Rewrite `sync.ts` and `session-sync.ts` to consume drivers

**Goal**: Replace the 5+ inline per-source blocks with a single generic driver loop.

**Files changed**:
- `packages/cli/src/commands/sync.ts` — Rewrite `executeSync()`:
  ```ts
  const drivers = createTokenDrivers(opts);
  for (const driver of drivers) {
    const files = await driver.discover(discoverOpts);
    filesScanned[driver.source] = files.length;
    for (const filePath of files) {
      const fp = await fingerprint(filePath);
      const cursor = cursors.files[filePath] as TCursor;
      if (driver.shouldSkip(cursor, fp)) continue;   // <-- NEW for Claude/OpenClaw/Codex/Gemini
      const resume = driver.resumeState(cursor, fp);
      const result = await driver.parse(filePath, resume);
      cursors.files[filePath] = driver.buildCursor(fp, result, cursor);
      allDeltas.push(...result.deltas);
    }
  }
  // OpenCode SQLite driver called separately with messageKeys from JSON driver cursors
  ```
- `packages/cli/src/commands/session-sync.ts` — Same pattern for `executeSessionSync()`
- Delete inline `discoverOpenCodeSessionDirs()` and `fileChanged()` from `session-sync.ts` (replaced by drivers)

**Files changed (tests)**:
- `packages/cli/src/__tests__/sync.test.ts` — Update for driver-based architecture
- `packages/cli/src/__tests__/session-sync.test.ts` — Same

**Verification**: `bun test --filter 'packages/cli'`

### Step 8: Cleanup + full integration verification

**Goal**: Remove dead code, verify everything end-to-end.

**Cleanup**:
- Remove `discoverOpenCodeSessionDirs()` from `session-sync.ts` (if not already in Step 7)
- Remove `fileChanged()` helper from `session-sync.ts`
- Audit `discovery/sources.ts` — discovery functions are still used by drivers; file stays but is now only imported by drivers, not by sync commands directly

**Verification**:
```bash
bun test                          # All tests pass
bun run build                     # Full build succeeds

# Manual E2E
rm -f ~/.config/pew/cursors.json ~/.config/pew/queue.jsonl ~/.config/pew/queue.state.json
rm -f ~/.config/pew/session-cursors.json ~/.config/pew/session-queue.jsonl ~/.config/pew/session-queue.state.json
rm -rf ~/.config/pew/runs/ ~/.config/pew/last-run.json
pew notify --source=opencode
cat ~/.config/pew/last-run.json | jq '.cycles[0] | keys'
# Expected: ["sessionSync", "tokenSync"]

# Second run should skip most files (fileUnchanged optimization)
pew notify --source=opencode
cat ~/.config/pew/last-run.json | jq '.cycles[0].tokenSync.totalDeltas, .cycles[0].sessionSync.totalSnapshots'
# Expected: 0, 0 (nothing changed)
```

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| OpenCode SQLite cross-source dedup breaks driver isolation | Orchestrator (sync.ts) collects `messageKey` set from JSON driver cursors, passes to SQLite driver's `parse()` method. Dedup stays outside the driver interface. |
| OpenCode JSON dir-mtime optimization is global state | Driver's `discover()` accepts `dirMtimes` map and returns updated map. Orchestrator persists it on `CursorState`. |
| Old cursor files missing `mtimeMs`/`size` fields | `shouldSkip()` treats `undefined` prev cursor as "file changed" (no skip). `fileUnchanged()` returns `false` when prev is undefined. Gradual migration — fields populated on next successful parse. |
| Large refactor risk | Each step is independently committable and testable. Steps 1-3 are zero-behavior-change. Steps 4-6 add new code without modifying old code. Only Step 7 rewrites existing code. |

## Test Plan Summary

### Existing tests to update (Step 7)

| File | Change |
|------|--------|
| `sync.test.ts` | Update for driver-based loop |
| `session-sync.test.ts` | Update for driver-based loop, remove `fileChanged` tests |

### New tests

| Category | Approx. Count | Step |
|----------|--------------|------|
| `fileUnchanged()` utility | 5-8 | Step 1 |
| `BaseCursorStore<T>` | 4-6 | Step 2 |
| Token drivers (6 drivers) | ~30 | Step 4 |
| Session drivers (6 drivers) | ~24 | Step 5 |
| Driver registry | 6-8 | Step 6 |
| Integration (rewritten sync loops) | 8-10 | Step 7 |

Total: ~80-90 new tests.

## File Change Summary

| File | Steps | Nature |
|------|-------|--------|
| `packages/core/src/types.ts` | 1, 3 | Extend `FileCursorBase`; add driver interfaces |
| `packages/cli/src/utils/file-changed.ts` | 1 | New: `fileUnchanged()` |
| `packages/cli/src/storage/base-cursor-store.ts` | 2 | New: generic base class |
| `packages/cli/src/storage/cursor-store.ts` | 2 | Refactor: extend base |
| `packages/cli/src/storage/session-cursor-store.ts` | 2 | Refactor: extend base |
| `packages/cli/src/drivers/types.ts` | 3 | New: internal driver types |
| `packages/cli/src/drivers/token/*.ts` | 4 | New: 6 token driver files |
| `packages/cli/src/drivers/session/*.ts` | 5 | New: 6 session driver files |
| `packages/cli/src/drivers/registry.ts` | 6 | New: driver registry |
| `packages/cli/src/commands/sync.ts` | 1, 7 | Update cursor writes (Step 1); rewrite to driver loop (Step 7) |
| `packages/cli/src/commands/session-sync.ts` | 7 | Rewrite to driver loop, remove inline helpers |
| `packages/cli/src/discovery/sources.ts` | — | Unchanged (still used by drivers) |
| `packages/cli/src/parsers/*.ts` | — | Unchanged (still used by drivers) |

## Future Phases

| Phase | Focus | Depends On |
|-------|-------|-----------|
| **Phase 5** | Staged Queue + at-least-once semantics | Phase 3+4 |
| **Phase 6** | Tracker-driven default + `pew runs` / `pew doctor` | Phase 2 (run log) |
