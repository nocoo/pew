# 07 — OpenCode SQLite Storage Migration

> OpenCode v1.1.65 migrated from JSON files to SQLite around Feb 15, 2026.
> Both pew and vibeusage only read JSON files, causing a data cliff post-migration.

## Problem

### Symptom

Dashboard shows a severe drop in OpenCode session count and token usage starting Feb 15-17, 2026, despite actual daily usage being consistent (~100-200 sessions/day).

| Date | JSON sessions | SQLite sessions | Combined | Input Tokens |
|------|:---:|:---:|:---:|:---:|
| Feb 13 | 196 | 0 | **196** | 30.4M |
| Feb 15 | 117 | 19 | **136** | ~17.8M |
| Feb 17 | **2** | **87** | **89** | 10.0M |
| Feb 18 | 0 | 113 | **113** | 18.2M |

### Root Cause

OpenCode migrated its storage backend from individual JSON files to a SQLite database (`opencode.db`) around version 1.1.65, cutover on Feb 15, 2026 ~17:00.

| Period | Storage | Location |
|--------|---------|----------|
| <= Feb 15 17:00 | JSON files | `~/.local/share/opencode/storage/message/ses_*/msg_*.json` |
| >= Feb 15 17:00 | SQLite DB | `~/.local/share/opencode/opencode.db` -> `message` table |

Both **pew** and **vibeusage** only walk the `storage/message/` directory. Neither reads the SQLite database.

The `message.data` column JSON structure is **identical** to the old `msg_*.json` files.

### Affected Projects

| Project | Parser Code | Fix Approach |
|---------|------------|--------------|
| **pew** (this repo) | `discovery/sources.ts`, `parsers/opencode.ts` | Add `bun:sqlite` parser |
| **vibeusage** (../vibeusage) | `rollout.js` `walkOpencodeMessages()` | Add `better-sqlite3` parser (separate PR) |

## SQLite Schema

Database: `~/.local/share/opencode/opencode.db` (Drizzle ORM)

### `message` table (67,810 rows as of Mar 9, 2026)

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | e.g. `msg_c609513f6001sbC1nT5FNB69i9` |
| `session_id` | TEXT | e.g. `ses_39f6aec68ffed8CWmFjgab8vqK` |
| `time_created` | INTEGER | Epoch ms |
| `time_updated` | INTEGER | Epoch ms |
| `data` | TEXT | JSON blob — same structure as old `msg_*.json` |

Sample `data` JSON for an assistant message:

```json
{
  "role": "assistant",
  "time": { "created": 1771146908662, "completed": 1771146917090 },
  "parentID": "msg_...",
  "modelID": "glm-4.7",
  "providerID": "zai-coding-plan",
  "tokens": {
    "total": 13651, "input": 12989, "output": 185,
    "reasoning": 144, "cache": { "read": 477, "write": 0 }
  },
  "finish": "tool-calls"
}
```

### `session` table (3,332 rows)

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Session ID |
| `project_id` | TEXT | Project hash |
| `parent_id` | TEXT | Parent session (subagents) |
| `title` | TEXT | Session title |
| `version` | TEXT | OpenCode version |
| `time_created` | INTEGER | Epoch ms |
| `time_updated` | INTEGER | Epoch ms |

## Fix Plan — pew (this repo)

### Design: Dual-source with message-key dedup

- Keep existing JSON file parser (historical data + un-migrated users)
- Add new SQLite reader for `opencode.db`
- Deduplicate by message key (`sessionID|messageID`) during overlap window (~Feb 15-17)
- Use `bun:sqlite` (zero dependencies, read-only mode)

### Atomic Commits

#### Commit 1: Add `OpenCodeSqliteCursor` type to `@pew/core`
- [x] `packages/core/src/types.ts` — new cursor interface
- [x] Update `CursorState` to include sqlite cursor field

#### Commit 2: Add `openCodeDbPath` to paths
- [x] `packages/cli/src/utils/paths.ts` — add db path

#### Commit 3: OpenCode SQLite token parser + tests
- [x] `packages/cli/src/parsers/opencode-sqlite.ts` — new parser
- [x] `packages/cli/src/parsers/opencode-sqlite-db.ts` — runtime `bun:sqlite` adapter (DI pattern)
- [x] `packages/cli/src/__tests__/opencode-sqlite-parser.test.ts` — 18 tests
- [x] Reuses `normalizeOpenCodeTokens()` from existing parser
- [x] No `diffTotals` needed — each SQLite row is an independent message

#### Commit 4: OpenCode SQLite session collector + tests
- [x] `packages/cli/src/parsers/opencode-sqlite-session.ts` — new collector
- [x] `packages/cli/src/__tests__/opencode-sqlite-session.test.ts` — 10 tests
- [x] Queries `session` + `message` tables directly

#### Commit 5: Integrate SQLite source into token sync
- [x] `packages/cli/src/commands/sync.ts` — add SQLite section with dedup
- [x] `SyncOptions` — add `openCodeDbPath` + `openMessageDb` (DI factory)
- [x] CLI entry point wiring (dynamic import in `cli.ts`)
- [x] `packages/cli/src/__tests__/sync.test.ts` — 5 new tests (24 total)

#### Commit 6: Integrate SQLite source into session sync
- [x] `packages/cli/src/commands/session-sync.ts` — add SQLite section
- [x] `SessionSyncOptions` — add `openCodeDbPath` + `openSessionDb` (DI factory)
- [x] `packages/cli/src/__tests__/session-sync.test.ts` — 4 new tests (17 total)
- [x] `packages/core/src/types.ts` — add `OpenCodeSqliteSessionCursor` + field on `SessionCursorState`

#### Commit 7: Build verification + doc progress update
- [x] Full build passes (core, cli, web, worker)
- [x] All 44 test files, 581 tests pass
- [x] Update this document with completion status

## Fix Plan — vibeusage (separate PR)

Same logical fix, adapted to vibeusage's architecture:

| Aspect | pew | vibeusage |
|--------|-----|-----------|
| Language | TypeScript | JavaScript |
| SQLite lib | `bun:sqlite` | `better-sqlite3` |
| Parser structure | Separate files | Single `rollout.js` |
| Cursor format | Typed `@pew/core` interfaces | Plain objects |

Changes needed:
1. Add `parseOpencodeSqliteIncremental()` to `rollout.js`
2. Wire up in `sync.js` alongside JSON parser
3. Message-key dedup between JSON and SQLite sources

## Progress

| Step | Status | Commit |
|------|--------|--------|
| Commit 1: Core types | done | `4cc8e11` |
| Commit 2: Paths | done | `f58ca65` |
| Commit 3: Token parser + tests | done | `d245744` |
| Commit 4: Session collector + tests | done | `9d1ef4a` |
| Commit 5: Token sync integration | done | `b270f37` |
| Commit 6: Session sync integration | done | `2eb5e3b` |
| Commit 7: Build verification | done | see below |

### Build Verification (Commit 7)

- **Tests**: 44 files, 581 tests — all passing
- **TypeScript**: `tsc --noEmit` clean for core, cli, web, worker
- **Build**: `bun run build` — all packages compile, Next.js production build succeeds
