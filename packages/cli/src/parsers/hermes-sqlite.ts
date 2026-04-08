import { stat } from "node:fs/promises";
import type { HermesSqliteCursor } from "@pew/core";
import type { ParsedDelta } from "./claude.js";
import { isAllZero } from "../utils/token-delta.js";

/** Result of parsing Hermes SQLite database */
export interface HermesSqliteResult {
  /** Parsed token deltas (session-level diffs) */
  deltas: ParsedDelta[];
  /** Updated cursor (session totals + inode) */
  cursor: HermesSqliteCursor;
  /** Number of raw rows queried (for progress reporting) */
  rowCount: number;
}

/** Row shape from the sessions table */
export interface SessionRow {
  id: string;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens: number;
}

/**
 * Function that queries the sessions table.
 * Returns all sessions with non-zero token usage.
 */
export type QuerySessionsFn = () => SessionRow[];

/**
 * Parse Hermes Agent SQLite database using session-level diff model.
 *
 * Strategy:
 * - For each session, compute delta = current totals - last known totals
 * - Only emit non-zero deltas
 * - Update cursor with new totals
 *
 * Handles:
 * - DB file replacement (inode change) → full rescan
 * - Session deletion → preserve cursor (no-op)
 * - Token decrease (anomaly) → Math.max(0, ...) → zero delta
 * - Cursor loss → full rescan (all sessions produce deltas)
 *
 * @param dbPath - Path to state.db
 * @param querySessions - Injected query function (DI for testability)
 * @param lastCursor - Previous cursor state (undefined on first sync)
 * @returns Deltas + updated cursor
 */
export async function parseHermesDatabase(
  dbPath: string,
  querySessions: QuerySessionsFn,
  lastCursor?: HermesSqliteCursor,
): Promise<HermesSqliteResult> {
  // Get DB file inode
  const st = await stat(dbPath);
  const currentInode = st.ino;

  // Detect DB file replacement → clear cursor
  let cursor: HermesSqliteCursor;
  if (lastCursor && lastCursor.inode !== currentInode) {
    cursor = {
      sessionTotals: {},
      inode: currentInode,
      updatedAt: new Date().toISOString(),
    };
  } else {
    cursor = lastCursor || {
      sessionTotals: {},
      inode: currentInode,
      updatedAt: new Date().toISOString(),
    };
  }

  // Query all sessions with non-zero tokens
  const rows = querySessions();
  const deltas: ParsedDelta[] = [];
  const syncTime = new Date().toISOString();

  for (const row of rows) {
    const sessionId = row.id;
    const last = cursor.sessionTotals[sessionId] || {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
    };

    // Compute delta (with Math.max to handle anomalies)
    const delta = {
      inputTokens: Math.max(0, row.input_tokens - last.input),
      cachedInputTokens: Math.max(
        0,
        row.cache_read_tokens + row.cache_write_tokens - (last.cacheRead + last.cacheWrite),
      ),
      outputTokens: Math.max(0, row.output_tokens - last.output),
      reasoningOutputTokens: Math.max(0, row.reasoning_tokens - last.reasoning),
    };

    // Skip zero deltas
    if (isAllZero(delta)) continue;

    // Emit delta
    deltas.push({
      source: "hermes",
      model: row.model || "unknown",
      timestamp: syncTime, // Use sync time (not session time)
      tokens: delta,
    });

    // Update cursor totals (only when non-zero delta)
    cursor.sessionTotals[sessionId] = {
      input: row.input_tokens,
      output: row.output_tokens,
      cacheRead: row.cache_read_tokens,
      cacheWrite: row.cache_write_tokens,
      reasoning: row.reasoning_tokens,
    };
  }

  // Update all sessions in cursor (even if no delta, to track current state)
  for (const row of rows) {
    cursor.sessionTotals[row.id] = {
      input: row.input_tokens,
      output: row.output_tokens,
      cacheRead: row.cache_read_tokens,
      cacheWrite: row.cache_write_tokens,
      reasoning: row.reasoning_tokens,
    };
  }

  // Update cursor metadata
  cursor.inode = currentInode;
  cursor.updatedAt = syncTime;

  return { deltas, cursor, rowCount: rows.length };
}
