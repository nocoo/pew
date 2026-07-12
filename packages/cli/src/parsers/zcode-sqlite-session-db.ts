/**
 * ZCode SQLite adapter (session pipeline).
 *
 * Opens `~/.zcode/cli/db/db.sqlite` in read-only mode and exposes a
 * ZcodeSessionDb handle used by the session parser + driver. Adapter shape
 * mirrors zcode-sqlite-db.ts (token side); this file focuses on the three
 * queries the session snapshot needs.
 *
 * Doc: docs/43-zcode-support.md §二挑战 5, §4.
 */

import { createRequire } from "node:module";
import type {
  ZcodeSessionDb,
  ZcodeSessionRow,
  ZcodeMessageCounts,
} from "./zcode-types.js";

const esmRequire = createRequire(import.meta.url);

interface SqliteDb {
  prepare(sql: string): SqliteStmt;
  close(): void;
}

interface SqliteStmt {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process as any).emit = function (event: string, ...args: unknown[]) {
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

const SESSIONS_SQL = `
  SELECT
    s.id            AS id,
    s.directory     AS directory,
    s.title         AS title,
    s.time_created  AS timeCreated,
    s.time_updated  AS timeUpdated,
    s.task_type     AS taskType
  FROM session s
  WHERE s.time_updated >= ?
  ORDER BY s.time_updated ASC, s.id ASC
`;

const MESSAGE_COUNT_SQL = `
  SELECT
    COUNT(*)                                                          AS total,
    SUM(CASE WHEN json_extract(data, '$.role') = 'user' THEN 1 ELSE 0 END)      AS user,
    SUM(CASE WHEN json_extract(data, '$.role') = 'assistant' THEN 1 ELSE 0 END) AS assistant
  FROM message
  WHERE session_id = ?
`;

const PRIMARY_MODEL_SQL = `
  SELECT model_id
  FROM model_usage
  WHERE session_id = ?
  GROUP BY model_id
  ORDER BY COUNT(*) DESC, model_id ASC
  LIMIT 1
`;

/**
 * Open a ZCode SQLite database (read-only) and return a ZcodeSessionDb handle.
 * Returns null on any failure (missing adapter, unreadable file, corrupt db).
 */
export function openZcodeSessionDb(dbPath: string): ZcodeSessionDb | null {
  const opener = getSqliteOpener();
  if (!opener) return null;

  let db: SqliteDb;
  try {
    db = opener(dbPath);
  } catch {
    return null;
  }

  let sessionsStmt: SqliteStmt;
  let messageCountStmt: SqliteStmt;
  let primaryModelStmt: SqliteStmt;
  try {
    sessionsStmt = db.prepare(SESSIONS_SQL);
    messageCountStmt = db.prepare(MESSAGE_COUNT_SQL);
    primaryModelStmt = db.prepare(PRIMARY_MODEL_SQL);
  } catch {
    try {
      db.close();
    } catch {
      // ignore
    }
    return null;
  }

  return {
    querySessions: (
      lastTimeUpdated: number | null,
      skipIds: readonly string[],
    ): ZcodeSessionRow[] => {
      const watermark = lastTimeUpdated ?? 0;
      const rows = sessionsStmt.all(watermark) as ZcodeSessionRow[];
      if (skipIds.length === 0) return rows;
      const skip = new Set(skipIds);
      return rows.filter((r) => !skip.has(r.id));
    },
    queryMessages: (sessionId: string): ZcodeMessageCounts => {
      const row = messageCountStmt.get(sessionId) as
        | { total: number | null; user: number | null; assistant: number | null }
        | undefined;
      if (!row) return { user: 0, assistant: 0, total: 0 };
      return {
        user: Number(row.user ?? 0),
        assistant: Number(row.assistant ?? 0),
        total: Number(row.total ?? 0),
      };
    },
    queryPrimaryModel: (sessionId: string): string | null => {
      const row = primaryModelStmt.get(sessionId) as
        | { model_id: string }
        | undefined;
      return row?.model_id ?? null;
    },
    close: () => {
      try {
        db.close();
      } catch {
        // best-effort
      }
    },
  };
}
