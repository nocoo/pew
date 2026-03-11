/**
 * Driver interfaces for the unified source driver architecture.
 *
 * Two driver kinds:
 * - File-based: discover → for each file: stat → shouldSkip → resumeState → parse → buildCursor
 * - DB-based: single run() call (manages own DB lifecycle, watermark, dedup)
 *
 * These are CLI-internal contracts — not shared across packages.
 * Parsers and discovery functions are unchanged; drivers are thin wrappers.
 */

import type {
  Source,
  FileCursorBase,
  SessionSnapshot,
  SessionFileCursor,
  TokenDelta,
} from "@pew/core";
import type { ParsedDelta } from "../parsers/claude.js";
import type { FileFingerprint } from "../utils/file-changed.js";

// Re-export for convenience — consumers import from drivers/types
export type { FileFingerprint } from "../utils/file-changed.js";
export type { ParsedDelta } from "../parsers/claude.js";

// ---------------------------------------------------------------------------
// SyncContext — shared state bag for cross-driver communication
// ---------------------------------------------------------------------------

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
export interface SyncContext {
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

// ---------------------------------------------------------------------------
// Discovery options
// ---------------------------------------------------------------------------

/**
 * Options passed to driver discover() methods.
 *
 * Each driver reads its relevant directory from this bag.
 * Drivers whose directory is absent return [].
 */
export interface DiscoverOpts {
  claudeDir?: string;
  codexSessionsDir?: string;
  geminiDir?: string;
  openCodeMessageDir?: string;
  openCodeDbPath?: string;
  openclawDir?: string;
  vscodeCopilotDirs?: string[];
}

// ---------------------------------------------------------------------------
// Token parse result — returned by FileTokenDriver.parse()
// ---------------------------------------------------------------------------

/**
 * Base result from a file token driver's parse() method.
 *
 * The orchestrator only reads `deltas`. Driver-specific state
 * (endOffset, lastTotals, lastModel, etc.) is typed in concrete
 * driver implementations and consumed by buildCursor().
 */
export interface TokenParseResult {
  deltas: ParsedDelta[];
}

// ---------------------------------------------------------------------------
// Resume state — driver-specific incremental parsing state
// ---------------------------------------------------------------------------

/**
 * Resume state for byte-offset JSONL parsers (Claude, OpenClaw, Codex).
 */
export interface ByteOffsetResumeState {
  readonly kind: "byte-offset";
  startOffset: number;
}

/**
 * Resume state for array-index JSON parsers (Gemini).
 */
export interface ArrayIndexResumeState {
  readonly kind: "array-index";
  startIndex: number;
  lastTotals: TokenDelta | null;
}

/**
 * Resume state for OpenCode JSON per-file parser.
 */
export interface OpenCodeJsonResumeState {
  readonly kind: "opencode-json";
  lastTotals: TokenDelta | null;
}

/**
 * Resume state for Codex (byte-offset + cumulative diff state).
 */
export interface CodexResumeState {
  readonly kind: "codex";
  startOffset: number;
  lastTotals: TokenDelta | null;
  lastModel: string | null;
}

/**
 * Resume state for VSCode Copilot CRDT JSONL files.
 * Carries byte offset + persisted request metadata for cross-line correlation.
 */
export interface VscodeCopilotResumeState {
  readonly kind: "vscode-copilot";
  startOffset: number;
  /** Persisted index→metadata mapping from prior parse */
  requestMeta: Record<number, { modelId: string; timestamp: number }>;
  /** Indices already emitted as records (skip on re-encounter) */
  processedRequestIndices: number[];
}

/**
 * Union of all resume state variants.
 * Discriminated by `kind` so drivers can narrow safely.
 */
export type ResumeState =
  | ByteOffsetResumeState
  | ArrayIndexResumeState
  | OpenCodeJsonResumeState
  | CodexResumeState
  | VscodeCopilotResumeState;

// ---------------------------------------------------------------------------
// Progress callback (passed through from orchestrator)
// ---------------------------------------------------------------------------

/** Progress callback compatible with both sync and session-sync */
export type OnProgress = (event: {
  source: string;
  phase: string;
  current?: number;
  total?: number;
  message?: string;
}) => void;

// ---------------------------------------------------------------------------
// File-based token driver
// ---------------------------------------------------------------------------

/**
 * Token driver for file-based sources.
 *
 * The generic loop is:
 *   discover → for each file: stat → shouldSkip → resumeState → parse → buildCursor
 *
 * TCursor is source-specific (ByteOffsetCursor, GeminiCursor, etc.)
 * and must extend FileCursorBase.
 */
export interface FileTokenDriver<TCursor extends FileCursorBase = FileCursorBase> {
  readonly kind: "file";
  readonly source: Source;

  /** Discover candidate files for this source */
  discover(opts: DiscoverOpts, ctx: SyncContext): Promise<string[]>;

  /** Fast skip: has this file changed since last cursor? Uses fileUnchanged() internally. */
  shouldSkip(cursor: TCursor | undefined, fingerprint: FileFingerprint): boolean;

  /** Extract incremental resume state from cursor (offset, lastIndex, etc.) */
  resumeState(cursor: TCursor | undefined, fingerprint: FileFingerprint): ResumeState;

  /** Parse file from resume point, return deltas + driver-specific state */
  parse(filePath: string, resume: ResumeState): Promise<TokenParseResult>;

  /** Build cursor to persist after successful parse */
  buildCursor(fingerprint: FileFingerprint, result: TokenParseResult, prev?: TCursor): TCursor;

  /**
   * Optional post-parse hook. Called after all files are processed.
   * Used by OpenCode JSON to deposit messageKeys into context.
   */
  afterAll?(cursors: Record<string, FileCursorBase>, ctx: SyncContext): void;
}

// ---------------------------------------------------------------------------
// File-based session driver
// ---------------------------------------------------------------------------

/**
 * Session driver for file-based sources.
 *
 * TCursor defaults to SessionFileCursor but can be narrowed.
 * OpenCode JSON session driver uses { mtimeMs: number } only
 * (directory scan — size unreliable across filesystems).
 */
export interface FileSessionDriver<TCursor = SessionFileCursor> {
  readonly kind: "file";
  readonly source: Source;

  /** Discover candidate files/dirs for this source */
  discover(opts: DiscoverOpts): Promise<string[]>;

  /** Fast skip: driver owns comparison logic for its cursor type */
  shouldSkip(cursor: TCursor | undefined, fingerprint: FileFingerprint): boolean;

  /** Full-scan parse, return session snapshots */
  parse(filePath: string): Promise<SessionSnapshot[]>;

  /** Build cursor to persist after successful parse */
  buildCursor(fingerprint: FileFingerprint): TCursor;
}

// ---------------------------------------------------------------------------
// DB-based drivers
// ---------------------------------------------------------------------------

/**
 * Result from a DB token driver's run() method.
 */
export interface DbTokenResult<TCursor> {
  deltas: ParsedDelta[];
  cursor: TCursor;
  /** Number of raw rows queried (for filesScanned/progress reporting) */
  rowCount: number;
}

/**
 * Token driver for DB-query sources (OpenCode SQLite).
 *
 * NOT part of the generic file loop. The orchestrator calls run() directly.
 * The driver manages its own DB handle lifecycle, watermark, and dedup.
 */
export interface DbTokenDriver<TCursor = unknown> {
  readonly kind: "db";
  readonly source: Source;

  /**
   * Execute the full DB sync cycle:
   *   open → query → parse → return results + new cursor.
   *
   * Reads cross-driver state (messageKeys) from ctx for dedup.
   */
  run(prevCursor: TCursor | undefined, ctx: SyncContext): Promise<DbTokenResult<TCursor>>;
}

/**
 * Result from a DB session driver's run() method.
 */
export interface DbSessionResult<TCursor> {
  snapshots: SessionSnapshot[];
  cursor: TCursor;
  /** Number of raw rows queried */
  rowCount: number;
}

/**
 * Session driver for DB-query sources (OpenCode SQLite).
 * Same pattern as DbTokenDriver but produces SessionSnapshot[].
 */
export interface DbSessionDriver<TCursor = unknown> {
  readonly kind: "db";
  readonly source: Source;

  run(prevCursor: TCursor | undefined, ctx: SyncContext): Promise<DbSessionResult<TCursor>>;
}

// ---------------------------------------------------------------------------
// Union types for the registry
// ---------------------------------------------------------------------------

/** Any token driver (file or DB) */
export type TokenDriver = FileTokenDriver | DbTokenDriver;

/** Any session driver (file or DB) */
export type SessionDriver = FileSessionDriver | DbSessionDriver;
