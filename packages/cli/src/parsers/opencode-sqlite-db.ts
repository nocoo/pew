import { Database } from "bun:sqlite";
import type { MessageRow, QueryMessagesFn } from "./opencode-sqlite.js";
import type { SessionRow, SessionMessageRow } from "./opencode-sqlite-session.js";

/**
 * Open an OpenCode SQLite database in read-only mode
 * and return a queryMessages function for use with parseOpenCodeSqlite().
 *
 * Uses bun:sqlite for zero-dependency SQLite access.
 * Returns null if the database cannot be opened.
 */
export function openMessageDb(
  dbPath: string,
): { queryMessages: QueryMessagesFn; close: () => void } | null {
  let db: Database;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch {
    return null;
  }

  const stmt = db.query<MessageRow, [number]>(
    `SELECT id, session_id, time_created, data
     FROM message
     WHERE time_created > ?
     ORDER BY time_created ASC`,
  );

  return {
    queryMessages: (lastTimeCreated: number) => stmt.all(lastTimeCreated),
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
  let db: Database;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch {
    return null;
  }

  const sessionStmt = db.query<SessionRow, [number]>(
    `SELECT id, project_id, title, time_created, time_updated
     FROM session
     WHERE time_updated > ?
     ORDER BY time_updated ASC`,
  );

  return {
    querySessions: (lastTimeUpdated: number) =>
      sessionStmt.all(lastTimeUpdated),

    querySessionMessages: (sessionIds: string[]) => {
      if (sessionIds.length === 0) return [];
      // Build IN clause with placeholders.
      // role is stored inside the JSON data blob, extract via json_extract.
      const placeholders = sessionIds.map(() => "?").join(",");
      const stmt = db.query<SessionMessageRow, string[]>(
        `SELECT session_id, json_extract(data, '$.role') as role, time_created, data
         FROM message
         WHERE session_id IN (${placeholders})
         ORDER BY time_created ASC`,
      );
      return stmt.all(...sessionIds);
    },

    close: () => db.close(),
  };
}
