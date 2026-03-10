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

/** The 5 supported AI coding tools */
export type Source =
  | "claude-code"
  | "codex"
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
  /** Reasoning/thinking tokens reported separately by some sources */
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
  /** File mtime in ms (for fast-skip change detection) */
  mtimeMs: number;
  /** File size in bytes (for fast-skip change detection) */
  size: number;
  /** ISO 8601 timestamp of last update */
  updatedAt: string;
}

/** Cursor for byte-offset-based JSONL files (Claude, OpenClaw) */
export interface ByteOffsetCursor extends FileCursorBase {
  /** Byte offset where we last stopped reading */
  offset: number;
}

/** Cursor for Codex CLI (byte-offset + cumulative diff state) */
export interface CodexCursor extends FileCursorBase {
  /** Byte offset where we last stopped reading */
  offset: number;
  /** Last seen cumulative token totals (for diff computation) */
  lastTotals: TokenDelta | null;
  /** Last seen model identifier */
  lastModel: string | null;
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
export type FileCursor = ByteOffsetCursor | CodexCursor | GeminiCursor | OpenCodeCursor;

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

/**
 * Session-specific file cursor (mtime + optional size).
 *
 * Most file-based session drivers store both mtimeMs and size for a
 * dual-check skip.  OpenCode JSON sessions discover *directories*
 * where stat().size is unreliable across filesystems, so only mtimeMs
 * is persisted — `size` is omitted from those cursor entries.
 */
export interface SessionFileCursor {
  /** File/dir mtime in ms */
  mtimeMs: number;
  /** File size in bytes (omitted for directory-based cursors) */
  size?: number;
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

// ---------------------------------------------------------------------------
// Notifier / Trigger types
// ---------------------------------------------------------------------------

/** Trigger that initiates a sync cycle */
export type SyncTrigger =
  | { kind: "manual"; command: string }
  | { kind: "notify"; source: Source; fileHint?: string | null }
  | { kind: "startup" }
  | { kind: "scheduled" };

/**
 * Result of a single sync execution within a coordinator run.
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

/** Persisted to ~/.config/pew/runs/<runId>.json */
export interface RunLogEntry {
  /** Unique run identifier (ISO-timestamp-randomSuffix) */
  runId: string;
  /** pew CLI version (e.g. "0.7.0") */
  version: string;
  /** Triggers that were coalesced into this run */
  triggers: SyncTrigger[];

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

/** Result of a single Coordinator run */
export interface CoordinatorRunResult {
  /** Unique ID for this run (ISO timestamp + random suffix) */
  runId: string;
  /** Triggers that were coalesced into this run */
  triggers: SyncTrigger[];
  /** Whether a follow-up run was triggered by dirty signal */
  hadFollowUp: boolean;
  /** Number of follow-up cycles executed */
  followUpCount: number;
  /** Whether this process had to wait for another sync to finish before acquiring the lock */
  waitedForLock: boolean;
  /** Whether sync was skipped because a previous follow-up already consumed the signal */
  skippedSync: boolean;
  /** Whether the coordinator degraded to unlocked mode (lock API unavailable) */
  degradedToUnlocked: boolean;
  /** Sync cycle results (one per execution, multiple if follow-ups occurred) */
  cycles: SyncCycleResult[];
  /** Error message if the run failed */
  error?: string;
}

/** Status of a notifier hook/plugin for a specific source */
export type NotifierStatus = "installed" | "not-installed" | "outdated" | "error";

/** Result of a notifier install/uninstall operation */
export interface NotifierOperationResult {
  source: Source;
  action: "install" | "uninstall" | "skip";
  /** Whether the config was actually changed */
  changed: boolean;
  /** Human-readable detail */
  detail: string;
  /** Path to backup file if one was created */
  backupPath?: string;
  /** Warning messages (non-fatal) */
  warnings?: string[];
}
