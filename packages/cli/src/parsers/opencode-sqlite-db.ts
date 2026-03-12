import type { MessageRow, QueryMessagesFn } from "./opencode-sqlite.js";
import type { SessionRow, SessionMessageRow } from "./opencode-sqlite-session.js";

/**
 * Unified SQLite database interface that works across Bun and Node.js runtimes.
 * - In Bun: uses native bun:sqlite (fast, no native deps)
 * - In Node.js: uses better-sqlite3 (requires native compilation)
 */
interface SqliteDb {
  prepare(sql: string): SqliteStmt;
  close(): void;
}

interface SqliteStmt {
  all(...params: unknown[]): unknown[];
}

// Cache the resolved SQLite implementation
let cachedSqliteImpl: ((dbPath: string) => SqliteDb) | null = null;
let sqliteLoadAttempted = false;

/**
 * Synchronously get a SQLite database opener.
 * Uses bun:sqlite under Bun, better-sqlite3 under Node.js.
 * Returns null if neither is available.
 */
function getSqliteOpener(): ((dbPath: string) => SqliteDb) | null {
  if (sqliteLoadAttempted) return cachedSqliteImpl;
  sqliteLoadAttempted = true;

  const isBun = typeof globalThis.Bun !== "undefined";

  if (isBun) {
    // Bun: use bun:sqlite (synchronous require works in Bun)
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Database } = require("bun:sqlite");
      cachedSqliteImpl = (dbPath: string) => new Database(dbPath, { readonly: true });
      return cachedSqliteImpl;
    } catch {
      // bun:sqlite not available (shouldn't happen in Bun)
    }
  } else {
    // Node.js: use better-sqlite3
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const BetterSqlite3 = require("better-sqlite3");
      cachedSqliteImpl = (dbPath: string) => new BetterSqlite3(dbPath, { readonly: true });
      return cachedSqliteImpl;
    } catch {
      // better-sqlite3 not available (native module issues)
    }
  }

  return null;
}

/**
 * Open an OpenCode SQLite database in read-only mode
 * and return a queryMessages function for use with parseOpenCodeSqlite().
 *
 * Uses bun:sqlite under Bun runtime and better-sqlite3 under Node.js
 * for cross-runtime SQLite access.
 * Returns null if the database cannot be opened.
 */
export function openMessageDb(
  dbPath: string,
): { queryMessages: QueryMessagesFn; close: () => void } | null {
  const opener = getSqliteOpener();
  if (!opener) return null;

  let db: SqliteDb;
  try {
    db = opener(dbPath);
  } catch {
    return null;
  }

  const stmt = db.prepare(
    `SELECT id, session_id, time_created, json_extract(data, '$.role') as role, data
     FROM message
     WHERE time_created >= ?
     ORDER BY time_created ASC`,
  );

  return {
    queryMessages: (lastTimeCreated: number) => stmt.all(lastTimeCreated) as MessageRow[],
    close: () => db.close(),
  };
}

/** Function type for querying sessions updated since a given timestamp */
export type QuerySessionsFn = (lastTimeUpdated: number) => SessionRow[];

/** Function type for querying messages belonging to given session IDs */
export type QuerySessionMessagesFn = (sessionIds: string[]) => SessionMessageRow[];

/**
 * Open an OpenCode SQLite database in read-only mode
 * and return session query functions for use with collectOpenCodeSqliteSessions().
 *
 * Returns null if the database cannot be opened.
 */
export function openSessionDb(
  dbPath: string,
): {
  querySessions: QuerySessionsFn;
  querySessionMessages: QuerySessionMessagesFn;
  close: () => void;
} | null {
  const opener = getSqliteOpener();
  if (!opener) return null;

  let db: SqliteDb;
  try {
    db = opener(dbPath);
  } catch {
    return null;
  }

  const sessionStmt = db.prepare(
    `SELECT id, project_id, title, time_created, time_updated
     FROM session
     WHERE time_updated >= ?
     ORDER BY time_updated ASC`,
  );

  return {
    querySessions: (lastTimeUpdated: number) =>
      sessionStmt.all(lastTimeUpdated) as SessionRow[],

    querySessionMessages: (sessionIds: string[]) => {
      if (sessionIds.length === 0) return [];
      // SQLite has a 999 parameter limit. Batch session IDs into chunks
      // of 500 to stay well under the limit.
      const CHUNK_SIZE = 500;
      const results: SessionMessageRow[] = [];
      for (let i = 0; i < sessionIds.length; i += CHUNK_SIZE) {
        const chunk = sessionIds.slice(i, i + CHUNK_SIZE);
        const placeholders = chunk.map(() => "?").join(",");
        const stmt = db.prepare(
          `SELECT session_id, json_extract(data, '$.role') as role, time_created, data
           FROM message
           WHERE session_id IN (${placeholders})
           ORDER BY time_created ASC`,
        );
        results.push(...(stmt.all(...chunk) as SessionMessageRow[]));
      }
      // Re-sort across chunks to maintain global time_created order
      if (sessionIds.length > CHUNK_SIZE) {
        results.sort((a, b) => a.time_created - b.time_created);
      }
      return results;
    },

    close: () => db.close(),
  };
}
