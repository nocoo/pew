/**
 * REST API adapter for DbWrite.
 *
 * Wraps the existing D1Client (Cloudflare REST API) behind the
 * DbWrite interface defined in db.ts. Read operations use the
 * Worker adapter (db-worker.ts) instead.
 */

import { getD1Client } from "./d1";
import type { DbWrite } from "./db";

export function createRestDbWrite(): DbWrite {
  const client = getD1Client();
  return {
    execute: async (sql: string, params?: unknown[]) =>
      client.execute(sql, params ?? []),
    batch: (stmts: Array<{ sql: string; params?: unknown[] }>) =>
      client.batch(stmts),
  };
}
