import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { D1Database, KVNamespace } from "@cloudflare/workers-types";
import { handleSeasonsRpc } from "../../packages/worker-read/src/rpc/seasons";

describe("roster synchronization time bounds", () => {
  it.each([
    ["2026-09-25T02:10:59Z", []],
    ["2026-09-25T02:11:00Z", ["s1"]],
    ["2026-09-25T02:11:57Z", ["s1"]],
    ["2026-09-25T02:12:00Z", []],
  ])("syncs rosters across the inclusive final minute at %s", async (now, expected) => {
    const sqlite = new DatabaseSync(":memory:");
    try {
      sqlite.exec(`CREATE TABLE seasons(id TEXT, start_date TEXT, end_date TEXT, allow_roster_changes INTEGER);
        CREATE TABLE season_teams(season_id TEXT, team_id TEXT);
        INSERT INTO seasons VALUES ('s1','2026-09-25T02:11:00Z','2026-09-25T02:11:00Z',1);
        INSERT INTO season_teams VALUES ('s1','t1');`);
      const db = { prepare: (sql: string) => ({ bind: (teamId: string) => ({
        all: async () => ({ results: sqlite.prepare(sql.replaceAll("datetime('now')", "datetime(?)")).all(teamId, now, now) }),
      }) }) } as unknown as D1Database;
      const response = await handleSeasonsRpc({ method: "seasons.listRosterSyncSeasons", teamId: "t1" }, db, {} as KVNamespace);
      expect(await response.json()).toEqual({ result: expected });
    } finally { sqlite.close(); }
  });

});
