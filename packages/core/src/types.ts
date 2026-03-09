/**
 * Core type definitions for the Pew token usage tracking system.
 *
 * Architecture:
 *   CLI (Parsers) → UsageRecord → HourBucket → Upload to SaaS
 *   SaaS (API)    → Store in D1  → Dashboard / Leaderboard
 */

// ---------------------------------------------------------------------------
// Source: Supported AI coding tools
// ---------------------------------------------------------------------------

/** The 4 supported AI coding tools */
export type Source =
  | "claude-code"
  | "gemini-cli"
  | "opencode"
  | "openclaw";

// ---------------------------------------------------------------------------
// Token types
// ---------------------------------------------------------------------------

/** Token count breakdown for a single interaction */
export interface TokenDelta {
  /** Total input tokens consumed */
  inputTokens: number;
  /** Input tokens served from cache (subset of inputTokens) */
  cachedInputTokens: number;
  /** Total output tokens generated */
  outputTokens: number;
  /** Output tokens used for reasoning/thinking (subset of outputTokens) */
  reasoningOutputTokens: number;
}

// ---------------------------------------------------------------------------
// Usage record
// ---------------------------------------------------------------------------

/**
 * A single normalized usage record.
 *
 * Represents token consumption from one AI tool + model combo
 * within a specific hour bucket.
 */
export interface UsageRecord {
  /** Which AI tool produced this usage */
  source: Source;
  /** Model identifier (e.g. "claude-sonnet-4-20250514", "o3", "gemini-2.5-pro") */
  model: string;
  /** ISO 8601 hour boundary (e.g. "2026-03-07T10:00:00Z") */
  hourStart: string;
  /** Token count breakdown */
  tokens: TokenDelta;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/** A collection of usage records within the same hour */
export interface HourBucket {
  /** ISO 8601 hour boundary */
  hourStart: string;
  /** All records aggregated into this bucket */
  records: UsageRecord[];
}

// ---------------------------------------------------------------------------
// Sync cursor (incremental parsing)
// ---------------------------------------------------------------------------

/** Base fields shared by all per-file cursors */
export interface FileCursorBase {
  /** File inode for detecting file rotation/replacement */
  inode: number;
  /** ISO 8601 timestamp of last update */
  updatedAt: string;
}

/** Cursor for byte-offset-based JSONL files (Claude, Codex, OpenClaw) */
export interface ByteOffsetCursor extends FileCursorBase {
  /** Byte offset where we last stopped reading */
  offset: number;
}

/** Cursor for Gemini (array-index-based JSON files) */
export interface GeminiCursor extends FileCursorBase {
  /** Index of last processed message in the messages array */
  lastIndex: number;
  /** Last seen cumulative token totals (for diff computation) */
  lastTotals: TokenDelta | null;
  /** Last seen model identifier */
  lastModel: string | null;
}

/** Cursor for OpenCode (individual message files with change detection) */
export interface OpenCodeCursor extends FileCursorBase {
  /** File size in bytes (for unchanged detection) */
  size: number;
  /** File mtime in ms (for unchanged detection) */
  mtimeMs: number;
  /** Last seen cumulative token totals (for diff computation) */
  lastTotals: TokenDelta | null;
  /** Composite key "sessionId|messageId" */
  messageKey: string | null;
}

/** Cursor for OpenCode SQLite database (incremental by time_created) */
export interface OpenCodeSqliteCursor {
  /** Max time_created seen from message table (epoch ms) */
  lastTimeCreated: number;
  /** IDs of messages at exactly lastTimeCreated (for >= dedup on next query) */
  lastProcessedIds?: string[];
  /** Max time_updated seen from session table (epoch ms) */
  lastSessionUpdated: number;
  /** DB file inode (detect replacement/recreation) */
  inode: number;
  /** ISO 8601 timestamp of last update */
  updatedAt: string;
}

/** Union of all cursor types, keyed by absolute file path */
export type FileCursor = ByteOffsetCursor | GeminiCursor | OpenCodeCursor;

/** Top-level cursor store persisted to disk */
export interface CursorState {
  version: 1;
  /** Per-file cursors, keyed by absolute file path */
  files: Record<string, FileCursor>;
  /** Directory-level mtimeMs cache for fast skip (OpenCode JSON optimization) */
  dirMtimes?: Record<string, number>;
  /** OpenCode SQLite database cursor (separate from per-file cursors) */
  openCodeSqlite?: OpenCodeSqliteCursor;
  /** ISO 8601 timestamp of last cursor update */
  updatedAt: string | null;
}

// ---------------------------------------------------------------------------
// Queue record (JSONL format for local queue)
// ---------------------------------------------------------------------------

/** A single row in the local queue.jsonl file */
export interface QueueRecord {
  source: Source;
  model: string;
  /** ISO 8601 half-hour boundary (e.g. "2026-03-07T10:30:00.000Z") */
  hour_start: string;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
}

// ---------------------------------------------------------------------------
// Session statistics
// ---------------------------------------------------------------------------

/** Session kind: human-driven vs automated agent */
export type SessionKind = "human" | "automated";

/**
 * A snapshot of a single session's metadata.
 *
 * Sessions are snapshots (overwritten), not additive events (summed).
 * Each sync produces the full current state of every session.
 */
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

/** A session record ready for the upload queue (snake_case for DB compat) */
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

/** Cursor for OpenCode SQLite session data */
export interface OpenCodeSqliteSessionCursor {
  /** Max time_updated seen from session table (epoch ms) */
  lastTimeUpdated: number;
  /** IDs of sessions at exactly lastTimeUpdated (for >= dedup on next query) */
  lastProcessedIds?: string[];
  /** DB file inode (detect replacement/recreation) */
  inode: number;
  /** ISO 8601 timestamp of last update */
  updatedAt: string;
}

/** Top-level session cursor state */
export interface SessionCursorState {
  version: 1;
  /** Per-file cursors, keyed by absolute file path */
  files: Record<string, SessionFileCursor>;
  /** OpenCode SQLite session cursor (separate from per-file cursors) */
  openCodeSqlite?: OpenCodeSqliteSessionCursor;
  /** ISO 8601 timestamp of last update */
  updatedAt: string | null;
}

// ---------------------------------------------------------------------------
// CLI Config
// ---------------------------------------------------------------------------

/** Persisted CLI configuration (stored at ~/.config/pew/config.json) */
export interface PewConfig {
  /** Auth token obtained via `pew login` */
  token?: string;
}
