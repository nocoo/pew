/**
 * Cursor editor SQLite DB opener.
 *
 * Opens Cursor's state.vscdb (SQLite) in read-only mode and provides
 * query functions for reading composer data from the cursorDiskKV table.
 *
 * Uses the same bun:sqlite / node:sqlite pattern as opencode-sqlite-db.ts.
 */

import { createRequire } from "node:module";

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
      // bun:sqlite not available
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
      // node:sqlite not available
    } finally {
      process.emit = origEmit;
    }
  }

  return null;
}

/** Row from cursorDiskKV table */
export interface CursorKVRow {
  key: string;
  value: string;
}

/** Query function type for Cursor DB */
export type QueryComposersFn = () => CursorKVRow[];

/** Query function for the older ItemTable format */
export type QueryItemTableFn = () => CursorKVRow[];

/**
 * Open a Cursor state.vscdb database in read-only mode
 * and return query functions for reading composer data.
 *
 * Returns null if the database cannot be opened.
 */
export function openCursorDb(
  dbPath: string,
): {
  queryComposers: QueryComposersFn;
  queryItemTable: QueryItemTableFn;
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

  // Check which tables exist — cursorDiskKV is the modern format,
  // ItemTable is the older format. Both may or may not exist.
  let hasKVTable = false;
  let hasItemTable = false;
  try {
    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('cursorDiskKV', 'ItemTable')`,
    ).all() as { name: string }[];
    for (const t of tables) {
      if (t.name === "cursorDiskKV") hasKVTable = true;
      if (t.name === "ItemTable") hasItemTable = true;
    }
  } catch {
    // If we can't even query sqlite_master, bail
    try { db.close(); } catch { /* ignore */ }
    return null;
  }

  const composerStmt = hasKVTable
    ? db.prepare(`SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'`)
    : null;

  const itemStmt = hasItemTable
    ? db.prepare(`SELECT key, value FROM ItemTable WHERE key = 'composer.composerData'`)
    : null;

  return {
    queryComposers: () => (composerStmt ? composerStmt.all() as CursorKVRow[] : []),
    queryItemTable: () => (itemStmt ? itemStmt.all() as CursorKVRow[] : []),
    close: () => db.close(),
  };
}
