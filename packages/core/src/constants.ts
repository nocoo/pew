/**
 * Runtime constants derived from core type definitions.
 *
 * These are the single source of truth — route handlers, workers,
 * and CLI validators should import from here instead of maintaining
 * their own copies.
 */

import type { SessionKind, Source } from "./types.js";

// ---------------------------------------------------------------------------
// Source & session kind enums (runtime values matching the type unions)
// ---------------------------------------------------------------------------

/** All supported AI coding tools (runtime array for iteration) */
export const SOURCES: readonly Source[] = Object.freeze([
  "claude-code",
  "codex",
  "copilot-cli",
  "gemini-cli",
  "grok",
  "hermes",
  "kosmos",
  "omp",
  "opencode",
  "openclaw",
  "pi",
  "pmstudio",
  "vscode-copilot",
  "zcode",
] as const);

/** Set form for O(1) membership checks */
export const VALID_SOURCES: ReadonlySet<string> = new Set<string>(SOURCES);

/** All session kinds (runtime array) */
export const SESSION_KINDS: readonly SessionKind[] = Object.freeze([
  "human",
  "automated",
] as const);

/** Set form for O(1) membership checks */
export const VALID_SESSION_KINDS: ReadonlySet<string> = new Set<string>(SESSION_KINDS);

// ---------------------------------------------------------------------------
// Ingest limits
// ---------------------------------------------------------------------------

/** Maximum records per ingest API request */
export const MAX_INGEST_BATCH_SIZE = 50;
export const MAX_ACCOUNTING_BATCH_SIZE = 25;
export const MAX_INGEST_BODY_BYTES = 1024 * 1024;
export const MAX_ACCOUNTING_BODY_BYTES = 24 * 1024 * 1024;

/** Maximum string field length (model names, session keys, etc.) */
export const MAX_STRING_LENGTH = 1024;

// D1's 10 GiB ceiling and >16-byte collected rows bound nonduplicating scans:
// (10 GiB / 16) * (4 * 1e9) < 2^63. This is an int64 storage argument only,
// for newly validated rows, not a guarantee for historical data or arbitrary joins.
// Read responses separately reject counts outside JS's safe integer range.
export const MAX_RECORD_TOKENS = 1_000_000_000;
export const MAX_RECORD_MESSAGES = 100_000_000;
export const MAX_SESSION_DURATION_SECONDS = 315_576_000;

// ---------------------------------------------------------------------------
// Version gate
// ---------------------------------------------------------------------------

/**
 * Minimum CLI version allowed to upload data.
 *
 * The server rejects uploads from versions below this threshold with
 * an actionable upgrade message.
 */
export const MIN_CLIENT_VERSION = "3.0.0";
