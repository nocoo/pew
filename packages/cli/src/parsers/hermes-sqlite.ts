import { stat } from "node:fs/promises";
import type { HermesSqliteCursor, TokenDelta } from "@pew/core";
import type { ParsedDelta } from "./claude.js";
import { isAllZero } from "../utils/token-delta.js";
import { accountingLabel, decimalCost, inclusiveAccounting, optionalToken } from "../utils/accounting.js";

interface HermesBilling {
  billing_provider?: string | null;
  /** Safe route class projected from the serialized billing URL, never the URL itself. */
  billing_route?: string | null;
  cost_status?: string | null;
  cost_source?: string | null;
  estimated_cost_usd?: string | number | null;
  actual_cost_usd?: string | number | null;
  /** False when an older SQLite schema did not store this counter. */
  has_cache_read?: boolean;
  has_cache_write?: boolean;
  has_reasoning?: boolean;
}

export function hermesAccounting(tokens: TokenDelta, row: HermesBilling & { model: string | null },
  read: number | null, write: number | null, origin: string, absolute = false) {
  const status = row.cost_status;
  const knownSource = row.cost_source && row.cost_source !== "none";
  const costs = absolute ? [
    decimalCost(row.actual_cost_usd, `hermes:${accountingLabel(row.cost_source) ?? "unknown"}`, status === "included" ? "included" : "actual", status === "included" || status === "actual" && knownSource ? "complete" : "unknown"),
    decimalCost(row.estimated_cost_usd, `hermes:${accountingLabel(row.cost_source) ?? "unknown"}`, "estimate", status === "estimated" && knownSource ? "complete" : "unknown"),
  ].filter((c) => c !== null) : [];
  return inclusiveAccounting(tokens, { input: tokens.inputTokens + tokens.cachedInputTokens,
    read: row.has_cache_read === false ? null : read, write: row.has_cache_write === false ? null : write,
    output: tokens.outputTokens, reasoning: row.has_reasoning === false ? null : tokens.reasoningOutputTokens }, {
    origin, model: row.model || "unknown", provider: row.billing_provider, route: row.billing_route,
    aggregate: true, quality: absolute ? "reported" : "derived", reportedCosts: costs,
  });
}

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
export interface SessionRow extends HermesBilling {
  id: string;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens: number;
  /** Unix timestamp (seconds since epoch) when session started */
  started_at: number;
}

/**
 * Function that queries the sessions table.
 * Returns all sessions with non-zero token usage.
 */
export type QuerySessionsFn = () => SessionRow[];

/** Strict projection of Hermes' auxiliary cumulative ledger, never messages or billing URLs. */
export interface AuxiliaryUsageRow extends HermesBilling {
  session_id: string;
  model: string;
  billing_provider: string;
  /** Hash of the billing route fields in the source primary key. */
  route_key: string;
  task: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens: number;
  api_call_count: number | null;
  first_seen: number | null;
  last_seen: number | null;
  started_at: number | null;
  source: string | null;
}

export interface HermesQueryHandle {
  querySessions: QuerySessionsFn;
  queryAuxiliaryUsage?: () => AuxiliaryUsageRow[];
  queryMainModelUsage?: () => AuxiliaryUsageRow[];
  close: () => void;
}

/** Full-source companions only. The sync reconciler verifies each original bucket before use. */
export function hermesAccountingSnapshots(rows: SessionRow[], modelRows: AuxiliaryUsageRow[]): ParsedDelta[] {
  const output: ParsedDelta[] = [];
  const fields = ["input_tokens", "cache_read_tokens", "cache_write_tokens", "output_tokens", "reasoning_tokens"] as const;
  for (const row of rows) {
    if (!fields.every((f) => optionalToken(row[f]) !== null) || !Number.isFinite(row.started_at)) continue;
    const timestamp = new Date(row.started_at * 1000).toISOString();
    const candidates = modelRows.filter((m) => m.session_id === row.id && m.task === "");
    const matches = candidates.length > 0 && candidates.every((m) => fields.every((f) => optionalToken(m[f]) !== null)) &&
      fields.every((f) => candidates.reduce((sum, m) => sum + m[f], 0) === row[f]);
    for (const m of matches ? candidates : [row]) {
      const tokens = { inputTokens: m.input_tokens, cachedInputTokens: m.cache_read_tokens + m.cache_write_tokens,
        outputTokens: m.output_tokens, reasoningOutputTokens: m.reasoning_tokens };
      if (isAllZero(tokens)) continue;
      output.push({ source: "hermes", model: row.model || "unknown", timestamp, tokens,
        accounting: hermesAccounting(tokens, m, m.cache_read_tokens, m.cache_write_tokens,
          matches ? "hermes:model_ledger" : "hermes:sessions", true) });
    }
  }
  return output;
}

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
  includeAccounting = false,
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

    // Use session's started_at as timestamp for idempotent uploads.
    // Hermes stores started_at as Unix timestamp (seconds since epoch).
    // This ensures reset && sync produces the same hour_start, enabling
    // proper ON CONFLICT deduplication in D1.
    const sessionTimestamp = new Date(row.started_at * 1000).toISOString();

    // Emit delta
    deltas.push({
      source: "hermes",
      model: row.model || "unknown",
      timestamp: sessionTimestamp,
      tokens: delta,
      ...(includeAccounting ? { accounting: hermesAccounting(delta, row,
        row.cache_read_tokens - last.cacheRead, row.cache_write_tokens - last.cacheWrite, "hermes:sessions") } : {}),
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
