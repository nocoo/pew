import { createRequire } from "node:module";
import type { MessageRow, QueryMessagesFn } from "./opencode-sqlite.js";
import type { SessionRow, SessionMessageRow } from "./opencode-sqlite-session.js";

/**
 * Unified SQLite database interface that works across Bun and Node.js runtimes.
 * - In Bun: uses native bun:sqlite (fast, zero deps)
 * - In Node.js (>= 22.5): uses built-in node:sqlite (zero deps)
 *
 * No native/compiled dependencies are required — both paths use
 * platform-provided SQLite bindings.
 *
 * NOTE: The package ships as ESM ("type": "module"), so bare `require()` is
 * not defined when Node.js loads the compiled .js files. We use
 * `createRequire(import.meta.url)` to get a CJS-compatible require that
 * works in both ESM and CJS contexts. Bun supports require() everywhere,
 * but we use createRequire uniformly for consistency.
 */

const esmRequire = createRequire(import.meta.url);

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
 * Uses bun:sqlite under Bun, node:sqlite under Node.js (>= 22.5).
 * Returns null if neither is available.
 */
function getSqliteOpener(): ((dbPath: string) => SqliteDb) | null {
  if (sqliteLoadAttempted) return cachedSqliteImpl;
  sqliteLoadAttempted = true;

  const isBun = typeof globalThis.Bun !== "undefined";

  if (isBun) {
    // Bun: use bun:sqlite (synchronous require works in Bun)
    try {
      const { Database } = esmRequire("bun:sqlite");
      cachedSqliteImpl = (dbPath: string) => new Database(dbPath, { readonly: true });
      return cachedSqliteImpl;
    } catch {
      // bun:sqlite not available (shouldn't happen in Bun)
    }
  } else {
    // Node.js >= 22.5: use built-in node:sqlite (experimental but stable API).
    // DatabaseSync is the synchronous interface — matches bun:sqlite's API shape.
    // Option is `readOnly` (camelCase), not `readonly` like bun:sqlite.
    //
    // Suppress the ExperimentalWarning that Node.js emits on first
    // require("node:sqlite"). Intercept process.emit, swallow the
    // specific SQLite warning, then restore normal behaviour.
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
 * Open an OpenCode SQLite database in read-only mode
 * and return a queryMessages function for use with parseOpenCodeSqlite().
 *
 * Uses bun:sqlite under Bun runtime and node:sqlite under Node.js (>= 22.5)
 * for cross-runtime SQLite access with zero native dependencies.
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
