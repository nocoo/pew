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
  "gemini-cli",
  "opencode",
  "openclaw",
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

/** Maximum string field length (model names, session keys, etc.) */
export const MAX_STRING_LENGTH = 1024;
