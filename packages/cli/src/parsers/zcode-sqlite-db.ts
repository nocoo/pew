/**
 * ZCode SQLite adapter (token pipeline).
 *
 * Opens `~/.zcode/cli/db/db.sqlite` in read-only mode and exposes a
 * ZcodeUsageDb handle used by the token parser + driver. Runtime:
 *   - Bun: bun:sqlite (fast, zero deps)
 *   - Node.js (>= 22.5): built-in node:sqlite (zero deps)
 *
 * SQL uses AS aliases so callers only see camelCase (mirrors the row types
 * in parsers/zcode-types.ts). Doc: docs/43-zcode-support.md §3.2.
 */

import { createRequire } from "node:module";
import type { ZcodeUsageDb, ZcodeUsageRow } from "./zcode-types.js";

const esmRequire = createRequire(import.meta.url);

interface SqliteDb {
  prepare(sql: string): SqliteStmt;
  close(): void;
}

interface SqliteStmt {
  all(...params: unknown[]): unknown[];
}

let cachedSqliteImpl: ((dbPath: string) => SqliteDb) | null = null;
let sqliteLoadAttempted = false;

function getSqliteOpener(): ((dbPath: string) => SqliteDb) | null {
  if (sqliteLoadAttempted) return cachedSqliteImpl;
  sqliteLoadAttempted = true;

  const isBun = typeof globalThis.Bun !== "undefined";

  if (isBun) {
    try {
      const { Database } = esmRequire("bun:sqlite");
      cachedSqliteImpl = (dbPath: string) => new Database(dbPath, { readonly: true });
      return cachedSqliteImpl;
    } catch {
      // bun:sqlite not available (shouldn't happen in Bun)
    }
  } else {
    const origEmit = process.emit;
    // biome-ignore lint/suspicious/noExplicitAny: process.emit override needs (process as any) to reassign the frozen signature
    (process as any).emit = (event: string, ...args: unknown[]) => {
      if (
        event === "warning" &&
        args[0] instanceof Error &&
        args[0].name === "ExperimentalWarning" &&
        args[0].message.includes("SQLite")
      ) {
        return false;
      }
      return origEmit.apply(process, [event, ...args] as never);
    };
    try {
      const { DatabaseSync } = esmRequire("node:sqlite");
      cachedSqliteImpl = (dbPath: string) => new DatabaseSync(dbPath, { readOnly: true });
      return cachedSqliteImpl;
    } catch {
      // node:sqlite not available (Node.js < 22.5)
    } finally {
      process.emit = origEmit;
    }
  }

  return null;
}

/**
 * Query `model_usage` rows for the token pipeline.
 *
 * Filter: terminal status (completed / error / cancelled) — running rows
 * are excluded so half-baked usage never lands. `completed_at >= ?` with
 * lastProcessedIds forms the dedup pair (doc §3.2). Uses AS aliases to
 * project column names into camelCase.
 */
const USAGE_SQL = `
  SELECT
    mu.id                            AS id,
    mu.session_id                    AS sessionId,
    mu.turn_id                       AS turnId,
    mu.model_id                      AS modelId,
    mu.provider_id                   AS providerId,
    mu.status                        AS status,
    mu.started_at                    AS startedAt,
    mu.completed_at                  AS completedAt,
    mu.input_tokens                  AS inputTokens,
    mu.output_tokens                 AS outputTokens,
    mu.reasoning_tokens              AS reasoningTokens,
    mu.cache_read_input_tokens       AS cacheReadInputTokens,
    mu.cache_creation_input_tokens   AS cacheCreationInputTokens,
    mu.provider_total_tokens         AS providerTotalTokens,
    mu.computed_total_tokens         AS computedTotalTokens
  FROM model_usage mu
  WHERE mu.status IN ('completed', 'error', 'cancelled')
    AND mu.completed_at IS NOT NULL
    AND mu.completed_at >= ?
  ORDER BY mu.completed_at ASC, mu.id ASC
`;

/**
 * Open a ZCode SQLite database (read-only) and return a ZcodeUsageDb handle.
 * Returns null on any failure (missing adapter, unreadable file, corrupt db).
 */
export function openZcodeUsageDb(dbPath: string): ZcodeUsageDb | null {
  const opener = getSqliteOpener();
  if (!opener) return null;

  let db: SqliteDb;
  try {
    db = opener(dbPath);
  } catch {
    return null;
  }

  let stmt: SqliteStmt;
  try {
    stmt = db.prepare(USAGE_SQL);
  } catch {
    // Schema mismatch (e.g. model_usage table missing).
    try {
      db.close();
    } catch {
      // ignore close-after-prepare-fail
    }
    return null;
  }

  return {
    queryUsageRows: (
      lastCompletedAt: number | null,
      skipIds: readonly string[],
    ): ZcodeUsageRow[] => {
      const watermark = lastCompletedAt ?? 0;
      const rows = stmt.all(watermark) as ZcodeUsageRow[];
      if (skipIds.length === 0) return rows;
      const skip = new Set(skipIds);
      return rows.filter((r) => !skip.has(r.id));
    },
    close: () => {
      try {
        db.close();
      } catch {
        // best-effort close
      }
    },
  };
}
