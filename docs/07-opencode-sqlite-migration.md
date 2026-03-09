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
- [ ] `packages/core/src/types.ts` — new cursor interface
- [ ] Update `CursorState` to include sqlite cursor field

#### Commit 2: Add `openCodeDbPath` to paths
- [ ] `packages/cli/src/utils/paths.ts` — add db path

#### Commit 3: OpenCode SQLite token parser + tests
- [ ] `packages/cli/src/parsers/opencode-sqlite.ts` — new parser
- [ ] `packages/cli/src/__tests__/opencode-sqlite-parser.test.ts` — tests
- [ ] Reuses `normalizeOpenCodeTokens()` from existing parser
- [ ] No `diffTotals` needed — each SQLite row is an independent message

#### Commit 4: OpenCode SQLite session collector + tests
- [ ] `packages/cli/src/parsers/opencode-sqlite-session.ts` — new collector
- [ ] `packages/cli/src/__tests__/opencode-sqlite-session.test.ts` — tests
- [ ] Queries `session` + `message` tables directly

#### Commit 5: Integrate SQLite source into token sync
- [ ] `packages/cli/src/commands/sync.ts` — add SQLite section with dedup
- [ ] `SyncOptions` — add `openCodeDbPath`
- [ ] CLI entry point wiring

#### Commit 6: Integrate SQLite source into session sync
- [ ] `packages/cli/src/commands/session-sync.ts` — add SQLite section
- [ ] `SessionSyncOptions` — add `openCodeDbPath`

#### Commit 7: Build verification + doc progress update
- [ ] Full build passes
- [ ] All tests pass
- [ ] Update this document with completion status

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
| Commit 1: Core types | pending | |
| Commit 2: Paths | pending | |
| Commit 3: Token parser + tests | pending | |
| Commit 4: Session collector + tests | pending | |
| Commit 5: Token sync integration | pending | |
| Commit 6: Session sync integration | pending | |
| Commit 7: Build verification | pending | |
