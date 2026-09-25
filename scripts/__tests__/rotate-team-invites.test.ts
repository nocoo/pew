import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import type { D1Client } from "../../packages/web/src/lib/d1";
import { rotateTeamInvites } from "../rotate-team-invites";

it("previews and rotates only weak codes, with an idempotent rerun", async () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec("CREATE TABLE teams (id TEXT PRIMARY KEY, invite_code TEXT UNIQUE)");
    const valid = "a".repeat(32);
    for (const [id, code] of [["old", "01234567"], ["invalid", "g".repeat(32)], ["current", valid]]) sqlite.prepare("INSERT INTO teams VALUES (?, ?)").run(id!, code!);
    const db = {
      query: async (sql: string) => ({ results: sqlite.prepare(sql).all(), meta: { changes: 0, duration: 0 } }),
      batch: async (statements: Array<{ sql: string; params?: unknown[] }>) => {
        sqlite.exec("BEGIN");
        try {
          const results = statements.map(({ sql, params }) => ({ results: [], meta: { changes: Number(sqlite.prepare(sql).run(...params as string[]).changes), duration: 0 } }));
          sqlite.exec("COMMIT");
          return results;
        } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
      },
    } as Pick<D1Client, "query" | "batch">;
    expect(await rotateTeamInvites(db)).toEqual({ pending: 2, rotated: 0 });
    expect(sqlite.prepare("SELECT invite_code FROM teams WHERE id='old'").get()!.invite_code).toBe("01234567");
    expect(await rotateTeamInvites(db, true)).toEqual({ pending: 0, rotated: 2 });
    const rows = sqlite.prepare("SELECT id, invite_code FROM teams").all();
    for (const row of rows) expect(row.invite_code).toMatch(/^[a-f0-9]{32}$/);
    expect(rows.find(row => row.id === "current")!.invite_code).toBe(valid);
    expect(await rotateTeamInvites(db, true)).toEqual({ pending: 0, rotated: 0 });
  } finally { sqlite.close(); }
});
