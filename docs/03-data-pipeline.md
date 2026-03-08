# Data Pipeline & Token Collection

> Complete reference for Pew's token collection pipeline: raw log formats,
> unified types, aggregation, upload protocol, and database schema.

## Pipeline Overview

```
Stage 1          Stage 2           Stage 3          Stage 4           Stage 5
Raw Logs    -->  ParsedDelta[]  --> QueueRecord[]  --> HTTP Upload  --> D1 Upsert
(4 formats)      (unified)         (half-hour       (batched)         (overwrite)
                                    buckets)
```

State files:
| File | Location | Purpose |
|------|----------|---------|
| `config.json` | `~/.config/pew/` | Prod API key (`pk_...`) |
| `config.dev.json` | `~/.config/pew/` | Dev API key |
| `cursors.json` | `~/.config/pew/` | Per-file parse cursors + directory mtimes |
| `queue.jsonl` | `~/.config/pew/` | Pending upload records (append-only JSONL) |
| `queue.state.json` | `~/.config/pew/` | Upload byte-offset (resume point) |

---

## Stage 1 — Raw Log Files

Each AI tool writes logs in its own format. Pew discovers and parses them
incrementally using per-file cursors.

### 1.1 Claude Code

- **Path**: `~/.claude/projects/**/*.jsonl`
- **Format**: JSONL, one JSON object per line, tokens are **absolute** per-event
- **Incremental strategy**: Byte offset (`ByteOffsetCursor`)
- **Raw record**:
  ```jsonc
  {
    "type": "assistant",
    "timestamp": "2026-03-07T10:15:30.000Z",
    "sessionId": "ses-001",
    "model": "claude-sonnet-4-20250514",       // fallback source
    "message": {
      "model": "claude-sonnet-4-20250514",     // primary source
      "stop_reason": "end_turn",
      "usage": {
        "input_tokens": 5000,
        "cache_creation_input_tokens": 100,    // billed at full input rate
        "cache_read_input_tokens": 2000,       // billed at reduced rate
        "output_tokens": 800
      }
    }
  }
  ```
- **Skip conditions**: line missing `"usage"` string (fast-path), malformed JSON,
  missing `model`/`timestamp`, all-zero tokens
- **Quirks**: `cache_creation_input_tokens` added to `inputTokens` (not cached);
  `reasoningOutputTokens` hardcoded to 0

### 1.2 Gemini CLI

- **Path**: `~/.gemini/tmp/*/chats/session-*.json`
- **Format**: Single JSON file per session with `messages[]` array, tokens are
  **cumulative** across messages
- **Incremental strategy**: Array index + cumulative diff (`GeminiCursor`)
- **Raw record** (per message in array):
  ```jsonc
  {
    "id": "msg-001",
    "timestamp": "2026-03-07T10:15:00.000Z",
    "type": "gemini",
    "model": "gemini-2.5-pro",
    "tokens": {
      "input": 5000,
      "output": 200,
      "cached": 3000,
      "thoughts": 100,        // reasoning tokens
      "tool": 50,             // merged into outputTokens
      "total": 8350
    }
  }
  ```
- **Skip conditions**: missing `tokens` object, missing `timestamp` (totals still
  advance but no delta emitted), all-zero diff
- **Quirks**: Cumulative values require `diffTotals()` to compute per-event
  deltas; if cumulative total decreases, treated as session reset (full current
  emitted as delta); model is inherited from previous message if missing

### 1.3 OpenCode

- **Path**: `~/.local/share/opencode/storage/message/ses_*/msg_*.json`
- **Format**: One standalone JSON file per message, tokens are **cumulative**
- **Incremental strategy**: File stat triple-check (inode + size + mtime) +
  cumulative diff (`OpenCodeCursor`), with directory-level mtime optimization
- **Raw record**:
  ```jsonc
  {
    "id": "msg_001",
    "sessionID": "ses_001",
    "role": "assistant",          // only "assistant" messages processed
    "modelID": "claude-opus-4.6", // primary source
    "model": "gpt-4o",            // fallback source
    "time": {
      "created": 1771120749059,   // epoch ms (auto-coerced from seconds if < 1e12)
      "completed": 1771120822000  // preferred timestamp source
    },
    "tokens": {
      "total": 15404,
      "input": 14967,
      "output": 437,
      "reasoning": 0,
      "cache": {
        "read": 0,
        "write": 0              // added to inputTokens (not cached)
      }
    }
  }
  ```
- **Skip conditions**: `role !== "assistant"`, missing `tokens` object, unchanged
  file stat (triple-check), all-zero diff, missing timestamp
- **Quirks**: Directory mtime skip avoids scanning ~66K+ files; `cache.write`
  added to `inputTokens`; `diffTotals()` shared with Gemini parser

### 1.4 OpenClaw

- **Path**: `~/.openclaw/agents/*/sessions/*.jsonl`
- **Format**: JSONL, tokens are **absolute** per-event
- **Incremental strategy**: Byte offset (`ByteOffsetCursor`)
- **Raw record**:
  ```jsonc
  {
    "type": "message",              // only "message" type processed
    "timestamp": "2026-03-07T10:15:00.000Z",
    "message": {
      "model": "claude-sonnet-4",
      "usage": {
        "input": 5000,
        "cacheRead": 1000,
        "cacheWrite": 200,          // both added to cachedInputTokens
        "output": 800,
        "totalTokens": 7000         // required for fast-path filter
      }
    }
  }
  ```
- **Skip conditions**: line missing `"usage"` OR `"totalTokens"` (dual fast-path),
  malformed JSON, `type !== "message"`, missing `timestamp`, all-zero tokens
- **Quirks**: `cacheRead + cacheWrite` both map to `cachedInputTokens`
  (different from Claude where `cacheWrite` maps to `inputTokens`);
  `reasoningOutputTokens` hardcoded to 0

### Cursor Types

```typescript
// packages/core/src/types.ts

interface FileCursorBase {
  inode: number;
  updatedAt: string;
}

// Used by: Claude Code, OpenClaw (byte-offset JSONL streaming)
interface ByteOffsetCursor extends FileCursorBase {
  offset: number;
}

// Used by: Gemini CLI (array index + cumulative totals)
interface GeminiCursor extends FileCursorBase {
  lastIndex: number;
  lastTotals: TokenDelta | null;
  lastModel: string | null;
}

// Used by: OpenCode (file stat + cumulative totals)
interface OpenCodeCursor extends FileCursorBase {
  size: number;
  mtimeMs: number;
  lastTotals: TokenDelta | null;
  messageKey: string | null;
}

type FileCursor = ByteOffsetCursor | GeminiCursor | OpenCodeCursor;

interface CursorState {
  version: 1;
  files: Record<string, FileCursor>;
  dirMtimes?: Record<string, number>;   // OpenCode directory-level optimization
  updatedAt: string | null;
}
```

---

## Stage 2 — Unified ParsedDelta

All four parsers normalize into a common intermediate structure.

```typescript
// packages/core/src/types.ts
interface TokenDelta {
  inputTokens: number;           // total input tokens consumed
  cachedInputTokens: number;     // input tokens served from cache (subset)
  outputTokens: number;          // total output tokens generated
  reasoningOutputTokens: number; // reasoning/thinking tokens (subset of output)
}

// packages/cli/src/parsers/claude.ts (shared by all parsers)
interface ParsedDelta {
  source: "claude-code" | "gemini-cli" | "opencode" | "openclaw";
  model: string;           // e.g. "claude-sonnet-4-20250514", "gemini-2.5-pro"
  timestamp: string;       // ISO 8601
  tokens: TokenDelta;
}
```

### Normalization Mapping

| Unified Field | Claude Code | Gemini CLI | OpenCode | OpenClaw |
|---------------|-------------|------------|----------|----------|
| `inputTokens` | `input_tokens` + `cache_creation` | `input` | `input` + `cache.write` | `input` |
| `cachedInputTokens` | `cache_read` | `cached` | `cache.read` | `cacheRead` + `cacheWrite` |
| `outputTokens` | `output_tokens` | `output` + `tool` | `output` | `output` |
| `reasoningOutputTokens` | 0 (hardcoded) | `thoughts` | `reasoning` | 0 (hardcoded) |

All token values pass through `toNonNegInt()`: negative -> 0, float -> `Math.floor()`.

---

## Stage 3 — Half-Hour Bucket Aggregation

`ParsedDelta[]` are bucketed by UTC half-hour boundaries, then written to the
local queue as `QueueRecord[]`.

```typescript
// packages/cli/src/utils/buckets.ts
function toUtcHalfHourStart(ts: string | number): string | null
// Floors to :00 or :30 -> "2026-03-07T10:00:00.000Z" or "...T10:30:00.000Z"

function bucketKey(source, model, hourStart): string
// Returns "source|model|hourStart"
```

Bucket key = `source|model|hourStart`. Tokens within the same bucket are summed.

```typescript
// packages/core/src/types.ts
interface QueueRecord {
  source: Source;
  model: string;
  hour_start: string;                // ISO 8601 half-hour boundary
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;              // = input + output + reasoning (NOT cached)
}
```

Written to `~/.config/pew/queue.jsonl` (append-only JSONL).
Upload progress tracked in `queue.state.json` as byte offset.

---

## Stage 4 — Upload Protocol

### CLI -> Next.js

```
POST /api/ingest
Content-Type: application/json
Authorization: Bearer <api_key>

Body: QueueRecord[]  (max 50 per request)
Response: { "ingested": 50 }
```

Pre-upload, `aggregateRecords()` merges any `QueueRecord`s sharing the same
`(source, model, hour_start)` key by summing all token fields.

Retry logic: exponential backoff on 5xx (max 3 attempts), honor `Retry-After`
on 429, no retry on 4xx.

### Next.js -> Cloudflare Worker

```
POST <WORKER_INGEST_URL>
Content-Type: application/json
Authorization: Bearer <WORKER_SECRET>

Body: {
  "userId": "auth-user-id",
  "records": [QueueRecord, ...]
}
```

Next.js validates all records before forwarding:
- Source must be one of the 4 valid values
- Model must be non-empty string
- `hour_start` must match ISO 8601 prefix pattern
- Token fields must be non-negative finite numbers
- **All-or-nothing**: one invalid record rejects the entire batch

---

## Stage 5 — Database Schema (Cloudflare D1)

### `usage_records` table

```sql
CREATE TABLE usage_records (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id                 TEXT NOT NULL REFERENCES users(id),
  source                  TEXT NOT NULL,
  model                   TEXT NOT NULL,
  hour_start              TEXT NOT NULL,       -- ISO 8601 half-hour boundary
  input_tokens            INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens     INTEGER NOT NULL DEFAULT 0,
  output_tokens           INTEGER NOT NULL DEFAULT 0,
  reasoning_output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens            INTEGER NOT NULL DEFAULT 0,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, source, model, hour_start)   -- upsert key
);

CREATE INDEX idx_usage_user_time ON usage_records(user_id, hour_start);
CREATE INDEX idx_usage_source ON usage_records(source);
```

### Upsert SQL (Worker)

```sql
INSERT INTO usage_records
  (user_id, source, model, hour_start,
   input_tokens, cached_input_tokens, output_tokens,
   reasoning_output_tokens, total_tokens)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (user_id, source, model, hour_start) DO UPDATE SET
   input_tokens = excluded.input_tokens,
   cached_input_tokens = excluded.cached_input_tokens,
   output_tokens = excluded.output_tokens,
   reasoning_output_tokens = excluded.reasoning_output_tokens,
   total_tokens = excluded.total_tokens
```

**Overwrite upsert** — last upload wins. Idempotency guaranteed by CLI-side
pre-aggregation: multiple syncs of the same source data always produce the same
aggregated totals.

### `users` table

```sql
CREATE TABLE users (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  name       TEXT,
  image      TEXT,
  slug       TEXT UNIQUE,           -- public profile (e.g. "nocoo")
  api_key    TEXT UNIQUE,           -- CLI auth (pk_* prefix)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## End-to-End Flow Diagram

```
~/.claude/projects/**/*.jsonl          ByteOffsetCursor    (absolute tokens)
~/.gemini/tmp/*/chats/session-*.json   GeminiCursor        (cumulative -> diffed)
~/.local/share/opencode/.../msg_*.json OpenCodeCursor      (cumulative -> diffed)
~/.openclaw/agents/*/sessions/*.jsonl  ByteOffsetCursor    (absolute tokens)
        |
        v  parsers (per-file, incremental)
    ParsedDelta[]  { source, model, timestamp, tokens: TokenDelta }
        |
        v  toUtcHalfHourStart() + bucket aggregation
    QueueRecord[]  { source, model, hour_start, 5 token fields }
        |
        v  append to ~/.config/pew/queue.jsonl
    Local Queue (JSONL, byte-offset tracked)
        |
        v  aggregateRecords() + batches of <= 50
    POST /api/ingest  [QueueRecord[]]  (Bearer api_key)
        |
        v  Next.js validates, resolves userId
    POST <Worker URL>  { userId, records }  (Bearer WORKER_SECRET)
        |
        v  env.DB.batch() -- atomic overwrite upsert
    D1: usage_records  (UNIQUE on user_id, source, model, hour_start)
        |
        v  Dashboard queries via D1 REST API
    Web UI: charts, leaderboard, public profiles
```

### Design Properties

1. **Four incremental strategies** adapt to different log formats (byte offset /
   array index diff / file stat diff)
2. **Half-hour window aggregation** compresses data volume
3. **Overwrite upsert + client-side pre-aggregation** = natural idempotency;
   repeated sync is safe
4. **Append-only local queue** decouples parsing from uploading; offline-capable
