# Session Statistics

> Parallel data pipeline for collecting session-level metadata (duration,
> message counts, working hours) from 4 AI coding tools and displaying
> them on the dashboard.

## Overview

Sessions are **snapshots** (overwritten on each sync), not additive events
(summed like tokens). Each sync produces the full current state of every
session found in the raw log files.

### What It Tracks Per Session

- Duration (wall-clock: first message → last message)
- Message counts (user, assistant, total)
- Session kind: `"human"` (Claude Code, Gemini CLI, OpenCode) vs `"automated"` (OpenClaw)
- Project reference (raw hash, resolved to names later)
- Primary model used

### Pipeline Independence

Fully independent from the token pipeline:

| Concern | Token Pipeline | Session Pipeline |
|---------|---------------|-----------------|
| Queue file | `queue.jsonl` | `session-queue.jsonl` |
| Cursor file | `cursors.json` | `session-cursors.json` |
| API endpoint | `POST /api/ingest` | `POST /api/ingest/sessions` |
| DB table | `usage_records` | `session_records` |
| Aggregation | Sum (additive) | Dedup (latest snapshot wins) |
| File strategy | Byte-offset incremental | Full-scan, mtime+size skip |

---

## Core Types

```typescript
// packages/core/src/types.ts (additions)

/** Session kind: human-driven vs automated agent */
export type SessionKind = "human" | "automated";

/** A snapshot of a single session's metadata */
export interface SessionSnapshot {
  /** Stable key: source-specific, survives re-scan */
  sessionKey: string;
  /** Which AI tool */
  source: Source;
  /** "human" for Claude/Gemini/OpenCode, "automated" for OpenClaw */
  kind: SessionKind;
  /** ISO 8601 timestamp of first message */
  startedAt: string;
  /** ISO 8601 timestamp of last message */
  lastMessageAt: string;
  /** Wall-clock seconds: lastMessageAt - startedAt */
  durationSeconds: number;
  /** Number of user messages */
  userMessages: number;
  /** Number of assistant messages */
  assistantMessages: number;
  /** Total messages (user + assistant + system + tool + other) */
  totalMessages: number;
  /** Raw project reference (hash or path-derived) */
  projectRef: string | null;
  /** Primary model used (most frequent or last seen) */
  model: string | null;
  /** ISO 8601 — when this snapshot was generated */
  snapshotAt: string;
}

/** A session record ready for the upload queue */
export interface SessionQueueRecord {
  session_key: string;
  source: Source;
  kind: SessionKind;
  started_at: string;
  last_message_at: string;
  duration_seconds: number;
  user_messages: number;
  assistant_messages: number;
  total_messages: number;
  project_ref: string | null;
  model: string | null;
  snapshot_at: string;
}

/** Session-specific file cursor (mtime + size dual-check) */
export interface SessionFileCursor {
  /** File mtime in ms */
  mtimeMs: number;
  /** File size in bytes */
  size: number;
}

/** Top-level session cursor state */
export interface SessionCursorState {
  version: 1;
  /** Per-file cursors, keyed by absolute file path */
  files: Record<string, SessionFileCursor>;
  /** ISO 8601 timestamp of last update */
  updatedAt: string | null;
}
```

---

## Session Key Derivation

Each tool needs a stable, deterministic key that survives re-scans:

| Tool | Session Key | Rationale |
|------|-------------|-----------|
| Claude Code | `claude:{sessionId}` | JSONL records contain `sessionId` field |
| Gemini CLI | `gemini:{sessionId}` or `gemini:sha256(path)` | Session JSON has `sessionId` at top level |
| OpenCode | `opencode:{sessionID}` | `msg_*.json` files contain `sessionID` (e.g. `ses_xxx`) |
| OpenClaw | `openclaw:sha256(absolutePath)` | No native sessionId; one session per file |

---

## Session Collectors

Each collector **full-scans** the file and returns `SessionSnapshot[]`.
The mtime+size dual-check at the orchestrator level skips unchanged files.

### Claude Session Collector

`collectClaudeSessions(filePath: string): Promise<SessionSnapshot[]>`

- Reads entire JSONL file line by line
- Groups lines by `sessionId`
- Per session: counts `type: "user"` / `type: "assistant"` / total,
  finds min/max `timestamp`
- `projectRef`: directory name after `projects/` in file path
- `model`: last seen model in the session
- `kind: "human"`

### Gemini Session Collector

`collectGeminiSessions(filePath: string): Promise<SessionSnapshot[]>`

- Reads JSON, extracts top-level `sessionId`
- Iterates `messages[]`: counts `type: "user"` / `type: "gemini"` / total
- `startedAt`/`lastMessageAt`: from message timestamps (min/max)
- `projectRef`: `session.projectHash` or null
- `model`: last model seen in messages
- `kind: "human"`
- Returns 1 snapshot per file

### OpenCode Session Collector

`collectOpenCodeSessions(sessionDir: string): Promise<SessionSnapshot[]>`

- Takes a session directory (`ses_xxx/`), reads all `msg_*.json` files
- Counts `role: "user"` / `role: "assistant"` / total
- Finds min/max of `time.created` across all messages
- `projectRef`: null (no project info in OpenCode messages)
- `model`: last seen `modelID` or `model`
- `kind: "human"`
- Returns 1 snapshot per session directory

### OpenClaw Session Collector

`collectOpenClawSessions(filePath: string): Promise<SessionSnapshot[]>`

- Reads entire JSONL file
- `userMessages: 0` (no user messages observable)
- `assistantMessages`: count of `type: "message"` entries
- `totalMessages`: count of all entries (message + system + tool)
- `projectRef`: agent name from path (`agents/{name}/sessions/`)
- `model`: last seen model
- `kind: "automated"`
- Returns 1 snapshot per file

---

## Session Sync Orchestrator

```typescript
export interface SessionSyncOptions {
  stateDir: string;
  claudeDir?: string;
  geminiDir?: string;
  openCodeMessageDir?: string;
  openclawDir?: string;
  onProgress?: (event: ProgressEvent) => void;
}

export interface SessionSyncResult {
  totalSnapshots: number;
  totalRecords: number;
  sources: { claude: number; gemini: number; opencode: number; openclaw: number };
}
```

**Flow:**

1. Load `SessionCursorState` from `~/.config/pew/session-cursors.json`
2. Discover files (reuse existing `discovery/sources.ts`)
3. For each file: **mtime + size dual-check** → skip if unchanged
4. Call appropriate collector → `SessionSnapshot[]`
5. Update cursor
6. Collect all snapshots, convert to `SessionQueueRecord[]`
7. **Deduplicate**: keep only latest `snapshotAt` per `sessionKey`
8. Save cursors FIRST, then append to session queue

---

## Session Queue & Upload

### Queue

- File: `~/.config/pew/session-queue.jsonl`
- State: `~/.config/pew/session-queue.state.json`
- Same append-only JSONL with byte-offset upload tracking

### Upload Dedup

```typescript
/**
 * Unlike token's aggregateRecords() which SUMS, session dedup
 * keeps only the LATEST snapshot per session_key.
 */
export function deduplicateSessionRecords(
  records: SessionQueueRecord[]
): SessionQueueRecord[] {
  const map = new Map<string, SessionQueueRecord>();
  for (const r of records) {
    const existing = map.get(r.session_key);
    if (!existing || r.snapshot_at > existing.snapshot_at) {
      map.set(r.session_key, r);
    }
  }
  return [...map.values()];
}
```

---

## Database Schema

```sql
CREATE TABLE session_records (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             TEXT NOT NULL REFERENCES users(id),
  session_key         TEXT NOT NULL,
  source              TEXT NOT NULL,
  kind                TEXT NOT NULL DEFAULT 'human',
  started_at          TEXT NOT NULL,
  last_message_at     TEXT NOT NULL,
  duration_seconds    INTEGER NOT NULL DEFAULT 0,
  user_messages       INTEGER NOT NULL DEFAULT 0,
  assistant_messages  INTEGER NOT NULL DEFAULT 0,
  total_messages      INTEGER NOT NULL DEFAULT 0,
  project_ref         TEXT,
  model               TEXT,
  snapshot_at         TEXT NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, session_key)
);

CREATE INDEX idx_session_user_time ON session_records(user_id, started_at);
CREATE INDEX idx_session_source ON session_records(source);
CREATE INDEX idx_session_kind ON session_records(kind);
```

### Upsert SQL (Worker)

```sql
INSERT INTO session_records
  (user_id, session_key, source, kind, started_at, last_message_at,
   duration_seconds, user_messages, assistant_messages, total_messages,
   project_ref, model, snapshot_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
ON CONFLICT (user_id, session_key) DO UPDATE SET
  source = excluded.source,
  kind = excluded.kind,
  started_at = excluded.started_at,
  last_message_at = excluded.last_message_at,
  duration_seconds = excluded.duration_seconds,
  user_messages = excluded.user_messages,
  assistant_messages = excluded.assistant_messages,
  total_messages = excluded.total_messages,
  project_ref = excluded.project_ref,
  model = excluded.model,
  snapshot_at = excluded.snapshot_at,
  updated_at = datetime('now')
WHERE excluded.snapshot_at >= session_records.snapshot_at
```

The `WHERE` clause ensures monotonic forward progress: stale snapshots
from retries never overwrite newer data.

---

## Server Routes

### Worker Extension

Extend `packages/worker/src/index.ts` with URL-path-based routing:
- `POST /ingest/tokens` — existing token handler (rename from root POST)
- `POST /ingest/sessions` — new session handler

### Next.js Routes

- `POST /api/ingest/sessions` — validate + forward to Worker
- `GET /api/sessions` — read API with filters (`from`, `to`, `source`, `kind`)

---

## Dashboard Components (Phase 4)

| Component | Description |
|-----------|-------------|
| **SessionOverview** | Stat cards: total sessions, total hours, avg duration, avg messages |
| **WorkingHoursHeatmap** | Hour-of-day × day-of-week grid showing session activity |
| **MessageStats** | Bar chart: user vs assistant messages by day |

---

## Implementation Plan

### Phase 1: Core Types + Session Collectors (Commits 1-10)

| # | Type | Description | Status |
|---|------|-------------|--------|
| 1 | `docs` | Add session statistics design document | ✅ |
| 2 | `feat` | Add session types to `@pew/core` | ✅ |
| 3 | `test` | RED: Claude session collector tests | ✅ |
| 4 | `feat` | GREEN: Implement Claude session collector | ✅ |
| 5 | `test` | RED: Gemini session collector tests | ✅ |
| 6 | `feat` | GREEN: Implement Gemini session collector | ✅ |
| 7 | `test` | RED: OpenCode session collector tests | ✅ |
| 8 | `feat` | GREEN: Implement OpenCode session collector | ✅ |
| 9 | `test` | RED: OpenClaw session collector tests | ✅ |
| 10 | `feat` | GREEN: Implement OpenClaw session collector | ✅ |

### Phase 2: Session Sync + Queue (Commits 11-18) ✅

| # | Type | Description | Status |
|---|------|-------------|--------|
| 11 | `feat` | Add SessionQueue class | ✅ |
| 12 | `feat` | Add SessionCursorStore class | ✅ |
| 13 | `test` | RED: session dedup tests | ✅ |
| 14 | `feat` | GREEN: Implement deduplicateSessionRecords | ✅ |
| 15 | `test` | RED: session-sync orchestrator tests | ✅ |
| 16 | `feat` | GREEN: Implement executeSessionSync | ✅ |
| 17 | `test` | RED: session-upload tests | ✅ |
| 18 | `feat` | GREEN: Implement executeSessionUpload | ✅ |

### Phase 3: Server-side (Commits 19-26)

| # | Type | Description | Status |
|---|------|-------------|--------|
| 19 | `feat` | D1 schema: add session_records table | |
| 20 | `test` | RED: Worker session ingest tests | |
| 21 | `feat` | GREEN: Extend Worker with session handler | |
| 22 | `test` | RED: Next.js session ingest route tests | |
| 23 | `feat` | GREEN: Implement POST /api/ingest/sessions | |
| 24 | `test` | RED: GET /api/sessions tests | |
| 25 | `feat` | GREEN: Implement GET /api/sessions | |
| 26 | `feat` | Wire session sync into CLI pew sync command | |

### Phase 4: Dashboard (Commits 27-33)

| # | Type | Description | Status |
|---|------|-------------|--------|
| 27 | `test` | RED: SessionOverview component tests | |
| 28 | `feat` | GREEN: Implement SessionOverview stat cards | |
| 29 | `test` | RED: WorkingHoursHeatmap tests | |
| 30 | `feat` | GREEN: Implement WorkingHoursHeatmap | |
| 31 | `test` | RED: MessageStats chart tests | |
| 32 | `feat` | GREEN: Implement MessageStats | |
| 33 | `feat` | Add Sessions page to dashboard | |

---

## Open Items / Deferred

- **Project name resolution**: `projectRef` stores raw hashes; resolve to
  human-readable names later
- **Active time vs wall-clock**: `durationSeconds` is wall-clock span;
  calculating "active time" (sum of gaps < threshold) is deferred
- **Session filtering by project**: Requires project name resolution first
- **Rate limiting**: Session ingest shares the same concerns as token ingest
