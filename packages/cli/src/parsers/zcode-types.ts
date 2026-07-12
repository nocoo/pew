/**
 * ZCode CLI private schema — DB handle interfaces and row types.
 *
 * Kept in the CLI package (not @pew/core) because:
 *   - Row shape is CLI-specific (opener queries db.sqlite tables directly).
 *   - Handle interfaces sit at the DI seam between adapters (bun:sqlite /
 *     node:sqlite) and pure parsers.
 *   - @pew/core is a cross-package type surface; only shared/publishable
 *     types belong there.
 *
 * Doc: docs/43-zcode-support.md §二挑战 7.
 */

/** One row from model_usage (SQL AS aliases to camelCase). */
export interface ZcodeUsageRow {
  id: string;
  sessionId: string;
  turnId: string | null;
  modelId: string;
  providerId: string;
  status: "completed" | "error" | "cancelled";
  /** epoch ms */
  startedAt: number;
  /** epoch ms; SQL already filters NOT NULL. */
  completedAt: number;
  /** Inclusive: includes cache_read + cache_creation. */
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  /** Provider may omit; null if missing. */
  providerTotalTokens: number | null;
  /** Always populated by zcode (NOT NULL default 0). */
  computedTotalTokens: number;
}

/** One row from session (SQL AS aliases to camelCase). */
export interface ZcodeSessionRow {
  id: string;
  directory: string;
  title: string;
  /** epoch ms */
  timeCreated: number;
  /** epoch ms */
  timeUpdated: number;
  taskType: string;
}

/** Message role counts for one session (aggregated from message.data.role). */
export interface ZcodeMessageCounts {
  user: number;
  assistant: number;
  total: number;
}

/**
 * Adapter handle for the token pipeline. Concrete implementation lives in
 * `zcode-sqlite-db.ts` and is opened via `openZcodeUsageDb(dbPath)`.
 */
export interface ZcodeUsageDb {
  /**
   * Query `model_usage` rows with `completed_at >= lastCompletedAt` (or all
   * rows when lastCompletedAt is null), excluding IDs already seen at that
   * exact watermark ms. Result is ordered by (completed_at ASC, id ASC).
   */
  queryUsageRows(
    lastCompletedAt: number | null,
    skipIds: readonly string[],
  ): ZcodeUsageRow[];
  close(): void;
}

/**
 * Adapter handle for the session pipeline. Concrete implementation lives
 * in `zcode-sqlite-session-db.ts` and is opened via
 * `openZcodeSessionDb(dbPath)`.
 */
export interface ZcodeSessionDb {
  /**
   * Query `session` rows with `time_updated >= lastTimeUpdated` (or all
   * rows when lastTimeUpdated is null), excluding IDs already seen at that
   * exact watermark ms. Result is ordered by (time_updated ASC, id ASC).
   */
  querySessions(
    lastTimeUpdated: number | null,
    skipIds: readonly string[],
  ): ZcodeSessionRow[];
  /** Count user/assistant/total messages for a session (json_extract on role). */
  queryMessages(sessionId: string): ZcodeMessageCounts;
  /**
   * Most-frequent model_id in a session; tie-break by lexicographic order
   * on modelId to be deterministic. Returns null if the session has no
   * model_usage rows.
   */
  queryPrimaryModel(sessionId: string): string | null;
  close(): void;
}
