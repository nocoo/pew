# 13. Phase 3+4: Unified Source Driver Architecture

> **Status**: Complete (2026-03-10). All 8 steps implemented and verified.
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

## Design Constraints

Three hard constraints shaped the driver interface split:

### Constraint 1: File-based vs DB-query sources are fundamentally different

File-based sources (Claude, Gemini, Codex, OpenClaw, OpenCode JSON) follow a uniform model:
```
discover files → for each file: stat → skip check → parse → update cursor
```

DB-query sources (OpenCode SQLite) follow a completely different model:
```
stat DB file → open DB handle → query with watermark → dedup against processed IDs → close
```

There is no `discover() → string[]` step for SQLite — it queries a single DB file. There is no `FileFingerprint`-based skip — the watermark IS the skip mechanism. `FileCursorBase` (inode + mtimeMs + size) does not extend to `OpenCodeSqliteCursor` (lastTimeCreated + lastProcessedIds + inode). Forcing both into one interface would require every method to branch on "am I a file or a DB?" — which is worse than having two interfaces.

### Constraint 2: OpenCode session discovery targets directories, not files

Most file-based session drivers discover files and check `mtime + size`. But OpenCode JSON session sync discovers **directories** (each `ses_xxx/` dir is a session). Directory `size` is unreliable across filesystems, so the current code explicitly uses mtime-only with `size: 0` as a sentinel value.

This means `FileSessionDriver.shouldSkip()` cannot assume a uniform `{ mtime, size }` comparison. The driver must own its skip logic via its own cursor type.

### Constraint 3: Cross-driver state (messageKeys, dirMtimes)

Two pieces of state cross driver boundaries:
- **messageKeys**: Token sync's OpenCode SQLite driver needs `messageKey` values from the OpenCode JSON driver's cursors to deduplicate.
- **dirMtimes**: Token sync's OpenCode JSON driver uses a directory-level mtime cache stored on `CursorState`, not on individual file cursors.

Rather than the orchestrator knowing OpenCode internals, drivers read/write from a shared `SyncContext` bag. The orchestrator creates the context, passes it to every driver, and persists any context state that drivers deposited. Drivers that don't need cross-driver state simply ignore the context.

## Target Architecture (After)

```
drivers/
├── types.ts                              # FileTokenDriver / FileSessionDriver / DbTokenDriver / DbSessionDriver
├── context.ts                            # SyncContext (shared state bag)
├── registry.ts                           # createTokenDrivers() / createSessionDrivers()
├── token/
│   ├── claude-token-driver.ts            # FileTokenDriver — ByteOffset
│   ├── gemini-token-driver.ts            # FileTokenDriver — ArrayIndex
│   ├── opencode-json-token-driver.ts     # FileTokenDriver — TripleCheck + dirMtimes via context
│   ├── opencode-sqlite-token-driver.ts   # DbTokenDriver — watermark + messageKeys via context
│   ├── openclaw-token-driver.ts          # FileTokenDriver — ByteOffset
│   └── codex-token-driver.ts             # FileTokenDriver — ByteOffset + cumulative diff
└── session/
    ├── claude-session-driver.ts          # FileSessionDriver — mtime + size
    ├── gemini-session-driver.ts          # FileSessionDriver — mtime + size
    ├── opencode-json-session-driver.ts   # FileSessionDriver — mtime-only (directory scan)
    ├── opencode-sqlite-session-driver.ts # DbSessionDriver — watermark
    ├── openclaw-session-driver.ts        # FileSessionDriver — mtime + size
    └── codex-session-driver.ts           # FileSessionDriver — mtime + size

utils/
└── file-changed.ts                       # fileUnchanged() shared utility

storage/
├── base-cursor-store.ts                  # Generic BaseCursorStore<T>
├── cursor-store.ts                       # extends BaseCursorStore<CursorState>
└── session-cursor-store.ts               # extends BaseCursorStore<SessionCursorState>

commands/
├── sync.ts                               # file driver loop + db driver calls
└── session-sync.ts                       # file driver loop + db driver calls
```

### Driver Interfaces

```ts
/** Shared file stat fingerprint for change detection */
interface FileFingerprint {
  inode: number;
  mtimeMs: number;
  size: number;
}

/**
 * Shared state bag passed to all drivers in a sync run.
 *
 * Drivers may read or write entries. The orchestrator creates the context
 * before the driver loop, passes it to every driver, and persists any
 * state that drivers deposited (e.g. dirMtimes → CursorState).
 *
 * This replaces the previous pattern where sync.ts had hard-coded
 * knowledge of OpenCode internals (messageKey collection, dirMtimes).
 */
interface SyncContext {
  /**
   * Message keys deposited by OpenCode JSON token driver.
   * Read by OpenCode SQLite token driver for cross-source dedup.
   */
  messageKeys?: Set<string>;

  /**
   * Directory mtime cache for OpenCode JSON discovery optimization.
   * Read/written by the OpenCode JSON token driver.
   * Persisted to CursorState.dirMtimes by the orchestrator.
   */
  dirMtimes?: Record<string, number>;
}

// ─── File-based drivers ─────────────────────────────────────────────

/**
 * Token driver for file-based sources.
 *
 * The generic loop is: discover → for each file: stat → shouldSkip → resumeState → parse → buildCursor.
 * TCursor is source-specific (ByteOffsetCursor, GeminiCursor, etc.) and must extend FileCursorBase.
 */
interface FileTokenDriver<TCursor extends FileCursorBase = FileCursorBase> {
  readonly kind: "file";
  readonly source: SourceName;

  /** Discover candidate files/dirs for this source */
  discover(opts: DiscoverOpts, ctx: SyncContext): Promise<string[]>;

  /** Fast skip: has this file changed since last cursor? Uses fileUnchanged() internally. */
  shouldSkip(cursor: TCursor | undefined, fingerprint: FileFingerprint): boolean;

  /** Extract incremental resume state from cursor (offset, lastIndex, etc.) */
  resumeState(cursor: TCursor | undefined, fingerprint: FileFingerprint): ResumeState;

  /** Parse file from resume point, return deltas + new cursor data */
  parse(filePath: string, resume: ResumeState): Promise<TokenParseResult>;

  /** Build cursor to persist after successful parse */
  buildCursor(fingerprint: FileFingerprint, result: TokenParseResult, prev?: TCursor): TCursor;

  /**
   * Optional post-parse hook. Called after all files are processed.
   * Used by OpenCode JSON to deposit messageKeys into context.
   */
  afterAll?(cursors: Record<string, FileCursorBase>, ctx: SyncContext): void;
}

/**
 * Session driver for file-based sources.
 *
 * TCursor defaults to SessionFileCursor but can be narrowed.
 * OpenCode JSON session driver uses { mtimeMs } only (directory scan, size unreliable).
 */
interface FileSessionDriver<TCursor = SessionFileCursor> {
  readonly kind: "file";
  readonly source: SourceName;

  /** Discover candidate files/dirs for this source */
  discover(opts: DiscoverOpts): Promise<string[]>;

  /** Fast skip: driver owns comparison logic for its cursor type */
  shouldSkip(cursor: TCursor | undefined, fingerprint: FileFingerprint): boolean;

  /** Full-scan parse, return session snapshots */
  parse(filePath: string): Promise<SessionSnapshot[]>;

  /** Build cursor to persist after successful parse */
  buildCursor(fingerprint: FileFingerprint): TCursor;
}

// ─── DB-based drivers ───────────────────────────────────────────────

/**
 * Token driver for DB-query sources (OpenCode SQLite).
 *
 * NOT part of the generic file loop. The orchestrator calls run() directly.
 * The driver manages its own DB handle lifecycle, watermark, and dedup.
 */
interface DbTokenDriver<TCursor = unknown> {
  readonly kind: "db";
  readonly source: SourceName;

  /**
   * Execute the full DB sync cycle: open → query → parse → return results + new cursor.
   * Reads cross-driver state (messageKeys) from ctx for dedup.
   */
  run(prevCursor: TCursor | undefined, ctx: SyncContext): Promise<DbTokenResult<TCursor>>;
}

interface DbTokenResult<TCursor> {
  deltas: ParsedDelta[];
  cursor: TCursor;
  /** Number of raw rows queried (for filesScanned/progress reporting) */
  rowCount: number;
}

/**
 * Session driver for DB-query sources (OpenCode SQLite).
 * Same pattern as DbTokenDriver but produces SessionSnapshot[].
 */
interface DbSessionDriver<TCursor = unknown> {
  readonly kind: "db";
  readonly source: SourceName;

  run(prevCursor: TCursor | undefined, ctx: SyncContext): Promise<DbSessionResult<TCursor>>;
}

interface DbSessionResult<TCursor> {
  snapshots: SessionSnapshot[];
  cursor: TCursor;
  rowCount: number;
}

// ─── Union types for the registry ───────────────────────────────────

type TokenDriver = FileTokenDriver | DbTokenDriver;
type SessionDriver = FileSessionDriver | DbSessionDriver;
```

### Why Two Driver Kinds

| | File-based (Claude, Gemini, Codex, OpenClaw, OpenCode JSON) | DB-based (OpenCode SQLite) |
|---|---|---|
| Discovery | `discover() → string[]` of files/dirs | N/A — single DB file |
| Skip mechanism | `shouldSkip(cursor, fingerprint)` — inode/mtime/size | Watermark query (`WHERE time >= ?`) |
| Parsing | Per-file: `parse(path, resume)` | Single `run()` — open DB, query, close |
| Cursor base | `FileCursorBase` (inode + mtimeMs + size) | Own type (watermark + processedIds + inode) |
| Generic loop? | Yes — orchestrator runs the same loop for all file drivers | No — orchestrator calls `run()` directly |

Attempting to force both into one interface would require:
- `discover()` returning `["<db-path>"]` as a fake single-element array
- `shouldSkip()` ignoring the fingerprint and internally checking the watermark
- `parse()` opening a DB handle, which contradicts the "parse a file" semantic

This is worse than having two clean interfaces. The `kind: "file" | "db"` discriminant lets the orchestrator dispatch with a simple `if (driver.kind === "file")` check.

### How SyncContext Replaces Hard-Coded OpenCode Knowledge

**Before** (sync.ts knows OpenCode internals):
```ts
// sync.ts line 310 — hard-coded dirMtimes persistence
cursors.dirMtimes = discovery.dirMtimes;

// sync.ts lines 361-375 — hard-coded messageKey collection
const jsonMessageKeys = new Set<string>();
for (const [, cursor] of Object.entries(cursors.files)) {
  if (isOpenCodeCursor(cursor) && cursor.messageKey) {
    jsonMessageKeys.add(cursor.messageKey);
  }
}
// ...pass to SQLite section for dedup
```

**After** (drivers use context, orchestrator is source-agnostic):
```ts
// Orchestrator (sync.ts) — no OpenCode-specific code
const ctx: SyncContext = { dirMtimes: cursors.dirMtimes };

for (const driver of fileDrivers) {
  // ... generic file loop ...
  driver.afterAll?.(cursors.files, ctx);  // OpenCode JSON deposits messageKeys here
}
for (const driver of dbDrivers) {
  const result = await driver.run(prevCursor, ctx);  // SQLite reads messageKeys from ctx
  // ...
}

cursors.dirMtimes = ctx.dirMtimes;  // Persist whatever drivers deposited
```

The orchestrator treats `ctx.dirMtimes` and `ctx.messageKeys` as opaque state — it doesn't know what they mean, only that they need to be persisted / passed through.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Phase 3/4 merge | Single refactor | ScanPlan and SourceDriver are tightly coupled; separate phases would require throwaway intermediate abstractions |
| CursorStore | Keep two files, extract `BaseCursorStore<T>` generic | Separate files preserve independent lifecycle (token cursors and session cursors have different schemas); generic base eliminates code duplication |
| Driver granularity | Separate token and session drivers | Different parsing modes (incremental vs full-scan), different cursor types, different output types. Forcing them into one interface would require awkward generics |
| File vs DB drivers | Explicit `kind: "file" \| "db"` split | SQLite sources have no file discovery, no fingerprint-based skip, no per-file parse. A single interface would degenerate into "implement discover/shouldSkip/parse as no-ops and put everything in run()" |
| OpenCode JSON session | `FileSessionDriver<{ mtimeMs: number }>` (custom cursor) | Directory scan — size unreliable across filesystems. Driver owns its skip logic; `shouldSkip` only compares mtimeMs |
| Cross-driver state | `SyncContext` shared bag | Orchestrator stays source-agnostic. OpenCode JSON deposits `messageKeys`/`dirMtimes` into context; SQLite reads them. Adding a new source that needs cross-driver state only requires adding a field to SyncContext |
| File skip optimization | Add `mtimeMs` + `size` to `FileCursorBase` | Aligns token sync with session sync's existing optimization; all file-based sources gain fast-skip for free |
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

### Step 3: Define driver interfaces + `SyncContext` + internal types

**Goal**: Establish the driver contracts without changing any runtime behavior.

**Files changed**:
- `packages/core/src/types.ts` — Add interfaces:
  - `FileFingerprint`
  - `SyncContext`
  - `FileTokenDriver<TCursor>`, `FileSessionDriver<TCursor>`
  - `DbTokenDriver<TCursor>`, `DbTokenResult<TCursor>`, `DbSessionDriver<TCursor>`, `DbSessionResult<TCursor>`
  - `TokenDriver` (union), `SessionDriver` (union)
  - `TokenParseResult`, `ResumeState`
- `packages/cli/src/drivers/types.ts` — New file: internal types (`DiscoverOpts`, driver-specific `ResumeState` variants)

**Behavior change**: None. Types only.

**Verification**: `bun run build`

### Step 4: Implement 5 FileTokenDrivers + 1 DbTokenDriver

**Goal**: Wrap each source's existing discovery + parser into the appropriate driver implementation.

**File-based drivers** (one per source):
- `packages/cli/src/drivers/token/claude-token-driver.ts` — `FileTokenDriver<ByteOffsetCursor>`, ByteOffset strategy. `shouldSkip` uses `fileUnchanged()` (new — was missing).
- `packages/cli/src/drivers/token/gemini-token-driver.ts` — `FileTokenDriver<GeminiCursor>`, ArrayIndex strategy. `shouldSkip` uses `fileUnchanged()` (new).
- `packages/cli/src/drivers/token/opencode-json-token-driver.ts` — `FileTokenDriver<OpenCodeCursor>`, TripleCheck strategy. `discover()` reads/writes `ctx.dirMtimes`. `afterAll()` deposits `messageKeys` into `ctx`.
- `packages/cli/src/drivers/token/openclaw-token-driver.ts` — `FileTokenDriver<ByteOffsetCursor>`, ByteOffset strategy. `shouldSkip` uses `fileUnchanged()` (new).
- `packages/cli/src/drivers/token/codex-token-driver.ts` — `FileTokenDriver<CodexCursor>`, ByteOffset + cumulative diff strategy. `shouldSkip` uses `fileUnchanged()` (new).

**DB-based driver**:
- `packages/cli/src/drivers/token/opencode-sqlite-token-driver.ts` — `DbTokenDriver<OpenCodeSqliteCursor>`. `run()` opens DB handle, queries with watermark, reads `ctx.messageKeys` for cross-source dedup, returns deltas + new cursor. Owns its full lifecycle.

**Tests**: `packages/cli/src/__tests__/drivers/token/*.test.ts` — Unit tests per driver

**Existing parser files**: Unchanged.

**Verification**: `bun test --filter 'drivers/token'`

### Step 5: Implement 5 FileSessionDrivers + 1 DbSessionDriver

**Goal**: Same as Step 4 but for session sync.

**File-based drivers**:
- `packages/cli/src/drivers/session/claude-session-driver.ts` — `FileSessionDriver<SessionFileCursor>`. `shouldSkip` compares mtime + size.
- `packages/cli/src/drivers/session/gemini-session-driver.ts` — Same pattern.
- `packages/cli/src/drivers/session/opencode-json-session-driver.ts` — `FileSessionDriver<{ mtimeMs: number }>`. Discovers **directories** via `discoverOpenCodeSessionDirs()`. `shouldSkip` compares **mtime only** (size unreliable for dirs). `buildCursor` returns `{ mtimeMs }`.
- `packages/cli/src/drivers/session/openclaw-session-driver.ts` — `FileSessionDriver<SessionFileCursor>`.
- `packages/cli/src/drivers/session/codex-session-driver.ts` — `FileSessionDriver<SessionFileCursor>`.

**DB-based driver**:
- `packages/cli/src/drivers/session/opencode-sqlite-session-driver.ts` — `DbSessionDriver<OpenCodeSqliteSessionCursor>`. `run()` opens DB, queries sessions + messages, returns snapshots + new cursor.

**Tests**: `packages/cli/src/__tests__/drivers/session/*.test.ts`

**Verification**: `bun test --filter 'drivers/session'`

### Step 6: Driver Registry

**Goal**: Single entry point that constructs the active driver set based on runtime options.

**Files changed**:
- `packages/cli/src/drivers/registry.ts` — New file:
  - `createTokenDrivers(opts): { fileDrivers: FileTokenDriver[], dbDrivers: DbTokenDriver[] }`
  - `createSessionDrivers(opts): { fileDrivers: FileSessionDriver[], dbDrivers: DbSessionDriver[] }`
  - Returns drivers for enabled sources (based on which directories/DB paths exist in opts)
- `packages/cli/src/__tests__/drivers/registry.test.ts` — Tests: correct drivers returned for various opt combinations, file and db drivers separated correctly

**Verification**: `bun test --filter 'drivers/registry'`

### Step 7: Rewrite `sync.ts` and `session-sync.ts` to consume drivers

**Goal**: Replace the 5+ inline per-source blocks with generic driver dispatch.

**Files changed**:
- `packages/cli/src/commands/sync.ts` — Rewrite `executeSync()`:
  ```ts
  const { fileDrivers, dbDrivers } = createTokenDrivers(opts);
  const ctx: SyncContext = { dirMtimes: cursors.dirMtimes };

  // Phase 1: File-based drivers (generic loop)
  for (const driver of fileDrivers) {
    const files = await driver.discover(discoverOpts, ctx);
    filesScanned[driver.source] = files.length;
    for (const filePath of files) {
      const fp = await fingerprint(filePath);
      const cursor = cursors.files[filePath];
      if (driver.shouldSkip(cursor, fp)) continue;
      const resume = driver.resumeState(cursor, fp);
      const result = await driver.parse(filePath, resume);
      cursors.files[filePath] = driver.buildCursor(fp, result, cursor);
      allDeltas.push(...result.deltas);
    }
    driver.afterAll?.(cursors.files, ctx);
  }

  // Phase 2: DB-based drivers (each manages own lifecycle)
  for (const driver of dbDrivers) {
    const prevCursor = cursors.openCodeSqlite; // or looked up by driver.source
    const result = await driver.run(prevCursor, ctx);
    cursors.openCodeSqlite = result.cursor;
    allDeltas.push(...result.deltas);
    filesScanned[driver.source] += result.rowCount;
  }

  // Persist context state
  cursors.dirMtimes = ctx.dirMtimes;
  ```
- `packages/cli/src/commands/session-sync.ts` — Same two-phase pattern for `executeSessionSync()`
- Delete inline `discoverOpenCodeSessionDirs()` and `fileChanged()` from `session-sync.ts` (replaced by drivers)

**Source-agnostic orchestrator**: `sync.ts` no longer contains any source-specific code. It doesn't know what `messageKeys` or `dirMtimes` mean — it just passes `ctx` through and persists `ctx.dirMtimes` because it came from the cursor state.

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

## Adding a New Source (Post-Refactor)

To add a hypothetical "Cursor" AI tool, you need:

1. **Parser files**: `parsers/cursor.ts` + `parsers/cursor-session.ts` (business logic)
2. **Discovery function**: add `discoverCursorFiles()` to `discovery/sources.ts`
3. **Token driver**: `drivers/token/cursor-token-driver.ts` implementing `FileTokenDriver<CursorCursor>`
4. **Session driver**: `drivers/session/cursor-session-driver.ts` implementing `FileSessionDriver`
5. **Registry**: add to `createTokenDrivers()` and `createSessionDrivers()`

You do NOT need to edit `sync.ts`, `session-sync.ts`, `notify.ts`, or `cli.ts`. The generic driver loop handles it automatically.

If the new source uses a DB instead of files, implement `DbTokenDriver` / `DbSessionDriver` and add to the registry's `dbDrivers` list. The orchestrator's Phase 2 loop picks it up with zero changes.

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Cross-driver state (messageKeys, dirMtimes) couples drivers | `SyncContext` is a typed bag — drivers only access fields they need. Adding a new context field is additive (no existing driver changes). Orchestrator persists context state generically. |
| OpenCode JSON session uses mtime-only (no size) | `FileSessionDriver` is generic over cursor type. OpenCode JSON session driver uses `<{ mtimeMs: number }>` and its `shouldSkip` only compares mtime. No special-case in orchestrator. |
| Old cursor files missing `mtimeMs`/`size` fields | `shouldSkip()` treats `undefined` prev cursor as "file changed" (no skip). `fileUnchanged()` returns `false` when prev is undefined. Gradual migration — fields populated on next successful parse. |
| Large refactor risk | Each step is independently committable and testable. Steps 1-3 are zero-behavior-change. Steps 4-6 add new code without modifying old code. Only Step 7 rewrites existing code. |
| DB driver cursor persistence assumes single DB source | Currently only OpenCode SQLite exists. If a second DB source appears, `CursorState` needs a `dbCursors: Record<SourceName, unknown>` field instead of `openCodeSqlite`. Deferred — YAGNI until then. |

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
| File token drivers (5 drivers) | ~25 | Step 4 |
| DB token driver (1 driver) | ~6 | Step 4 |
| File session drivers (5 drivers) | ~20 | Step 5 |
| DB session driver (1 driver) | ~5 | Step 5 |
| Driver registry | 6-8 | Step 6 |
| Integration (rewritten sync loops) | 8-10 | Step 7 |

Total: ~80-90 new tests.

## File Change Summary

| File | Steps | Nature |
|------|-------|--------|
| `packages/core/src/types.ts` | 1, 3 | Extend `FileCursorBase`; add driver interfaces, `SyncContext` |
| `packages/cli/src/utils/file-changed.ts` | 1 | New: `fileUnchanged()` |
| `packages/cli/src/storage/base-cursor-store.ts` | 2 | New: generic base class |
| `packages/cli/src/storage/cursor-store.ts` | 2 | Refactor: extend base |
| `packages/cli/src/storage/session-cursor-store.ts` | 2 | Refactor: extend base |
| `packages/cli/src/drivers/types.ts` | 3 | New: internal driver types |
| `packages/cli/src/drivers/context.ts` | 3 | New: `SyncContext` runtime helpers |
| `packages/cli/src/drivers/token/*.ts` | 4 | New: 5 file + 1 db token driver |
| `packages/cli/src/drivers/session/*.ts` | 5 | New: 5 file + 1 db session driver |
| `packages/cli/src/drivers/registry.ts` | 6 | New: driver registry |
| `packages/cli/src/commands/sync.ts` | 1, 7 | Update cursor writes (Step 1); rewrite to two-phase driver dispatch (Step 7) |
| `packages/cli/src/commands/session-sync.ts` | 7 | Rewrite to two-phase driver dispatch, remove inline helpers |
| `packages/cli/src/discovery/sources.ts` | — | Unchanged (still used by file drivers) |
| `packages/cli/src/parsers/*.ts` | — | Unchanged (still used by drivers) |

## Future Phases

| Phase | Focus | Depends On |
|-------|-------|-----------|
| **Phase 5** | Staged Queue + at-least-once semantics | Phase 3+4 |
| **Phase 6** | Tracker-driven default + `pew runs` / `pew doctor` | Phase 2 (run log) |
