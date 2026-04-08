import { createRequire } from "node:module";
import type { QuerySessionsFn, SessionRow } from "./hermes-sqlite.js";

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

/**
 * Open a Hermes Agent SQLite database in read-only mode
 * and return a querySessions function for use with parseHermesDatabase().
 *
 * Uses bun:sqlite under Bun runtime and node:sqlite under Node.js (>= 22.5)
 * for cross-runtime SQLite access with zero native dependencies.
 * Returns null if the database cannot be opened.
 */
export function openHermesDb(
  dbPath: string,
): { querySessions: QuerySessionsFn; close: () => void } | null {
  const opener = getSqliteOpener();
  if (!opener) return null;

  let db: SqliteDb;
  try {
    db = opener(dbPath);
  } catch {
    return null;
  }

  const stmt = db.prepare(
    `SELECT
       id,
       model,
       input_tokens,
       output_tokens,
       cache_read_tokens,
       cache_write_tokens,
       reasoning_tokens
     FROM sessions
     WHERE started_at IS NOT NULL
     ORDER BY started_at ASC`,
  );

  return {
    querySessions: () => stmt.all() as SessionRow[],
    close: () => db.close(),
  };
}
