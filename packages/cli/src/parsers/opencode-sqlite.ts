import { stat } from "node:fs/promises";
import type { Source } from "@pew/core";
import type { ParsedDelta } from "./claude.js";
import { normalizeOpenCodeTokens } from "./opencode.js";
import { isAllZero } from "../utils/token-delta.js";
import { coerceEpochMs } from "../utils/time.js";

/** Result of parsing OpenCode SQLite database */
export interface OpenCodeSqliteResult {
  /** Parsed token deltas (one per assistant message) */
  deltas: ParsedDelta[];
  /** Message keys for dedup: "sessionId|messageId" */
  messageKeys: Set<string>;
  /** Highest time_created seen (for cursor advancement) */
  maxTimeCreated: number;
  /** DB file inode (for detecting replacement/recreation) */
  inode: number;
}

/** Row shape from the message table */
export interface MessageRow {
  id: string;
  session_id: string;
  time_created: number;
  /** Extracted via json_extract(data, '$.role') at the SQL level */
  role: string | null;
  data: string;
}

/**
 * Function that queries the message table.
 * Accepts lastTimeCreated and returns rows where time_created >= lastTimeCreated.
 * Callers must filter out previously-processed IDs from the prior batch
 * to handle same-millisecond boundary dedup.
 */
export type QueryMessagesFn = (lastTimeCreated: number) => MessageRow[];

/**
 * Parse message rows from OpenCode's SQLite database for token usage records.
 *
 * Processes rows from the `message` table where `time_created > lastTimeCreated`.
 *
 * Unlike the JSON file parser, no diffTotals is needed — each SQLite row
 * is an independent message with absolute token values.
 *
 * The `queryMessages` function is injected to decouple from `bun:sqlite`
 * for testability. Use `openMessageDb()` from `opencode-sqlite-db.ts` to
 * create the real adapter at runtime.
 */
export function processOpenCodeMessages(
  rows: MessageRow[],
): Omit<OpenCodeSqliteResult, "inode"> {
  const deltas: ParsedDelta[] = [];
  const messageKeys = new Set<string>();
  let maxTimeCreated = 0;

  for (const row of rows) {
    // Track max time_created for cursor
    if (row.time_created > maxTimeCreated) {
      maxTimeCreated = row.time_created;
    }

    // Only process assistant messages (role is pre-extracted at SQL level)
    if (row.role !== "assistant") continue;

    // Parse data JSON
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(row.data);
    } catch {
      continue;
    }

    // Build message key for dedup
    messageKeys.add(`${row.session_id}|${row.id}`);

    // Normalize tokens
    const tokens = normalizeOpenCodeTokens(
      msg.tokens as Record<string, unknown> | null,
    );
    if (!tokens || isAllZero(tokens)) continue;

    // Extract timestamp from time.completed or time.created
    const time = msg.time as Record<string, unknown> | undefined;
    const timestampMs =
      coerceEpochMs(time?.completed) || coerceEpochMs(time?.created);
    if (!timestampMs) continue;

    // Extract model
    const model =
      typeof msg.modelID === "string"
        ? msg.modelID.trim()
        : typeof msg.model === "string"
          ? (msg.model as string).trim()
          : "unknown";

    deltas.push({
      source: "opencode" as Source,
      model,
      timestamp: new Date(timestampMs).toISOString(),
      tokens,
    });
  }

  return { deltas, messageKeys, maxTimeCreated };
}

/**
 * High-level entry: parse OpenCode SQLite database for token usage.
 *
 * Opens the database, queries new messages, and returns parsed deltas.
 * The `queryMessages` function provides the database access layer.
 */
export async function parseOpenCodeSqlite(opts: {
  dbPath: string;
  lastTimeCreated: number;
  queryMessages?: QueryMessagesFn;
}): Promise<OpenCodeSqliteResult> {
  const { dbPath, lastTimeCreated, queryMessages } = opts;

  const empty: OpenCodeSqliteResult = {
    deltas: [],
    messageKeys: new Set(),
    maxTimeCreated: 0,
    inode: 0,
  };

  // Check if database file exists and get inode
  let fileInode: number;
  try {
    const st = await stat(dbPath);
    fileInode = st.ino;
  } catch {
    return empty;
  }

  if (!queryMessages) {
    return empty;
  }

  let rows: MessageRow[];
  try {
    rows = queryMessages(lastTimeCreated);
  } catch {
    return empty;
  }

  const result = processOpenCodeMessages(rows);
  return { ...result, inode: fileInode };
}
