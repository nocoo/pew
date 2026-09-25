import { describe, expect, it } from "vitest";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { handleAdminRpc } from "../packages/worker-read/src/rpc/admin";
import { handleSeasonsRpc, type SeasonsRpcRequest } from "../packages/worker-read/src/rpc/seasons";

type D1Database = Parameters<typeof handleAdminRpc>[1];
type KVNamespace = Parameters<typeof handleSeasonsRpc>[2];

describe("read RPC SQL semantics", () => {
  it("keeps half-open UTC bounds and aggregates local-day totals across sources", async () => {
    const sqlite = new DatabaseSync(":memory:");
    try {
      sqlite.exec(`CREATE TABLE usage_totals (user_id TEXT, hour_start TEXT, total_tokens INTEGER, source TEXT, model TEXT);
        INSERT INTO usage_totals VALUES
          ('u1', '2026-01-01T15:59:00.000Z', 10, 's', 'm'),
          ('u1', '2026-01-01T16:00:00.000Z', 20, 's', 'm'),
          ('u1', '2026-01-01T16:30:00.000Z', 30, 's', 'm'),
          ('u1', '2026-01-01T16:30:00.000Z', 40, 'other', 'm'),
          ('u2', '2026-01-02T00:00:00.000Z', 50, 's', 'm'),
          ('excluded', '2026-01-01T16:30:00.000Z', 60, 's', 'm');`);
      const db = {
        prepare: (sql: string) => ({
          bind: (...params: SQLInputValue[]) => ({
            all: async () => ({ results: sqlite.prepare(sql).all(...params) }),
          }),
        }),
      } as unknown as D1Database;
      const res = await handleAdminRpc({ method: "admin.getUsageComparison", userIds: ["u1", "u2"], fromDate: "2026-01-01T15:59:00.000Z", toDate: "2026-01-02T00:00:00.000Z", tzOffset: -480, source: "s", model: "m" }, db);
      expect(await res.json()).toEqual({ result: [
        { date: "2026-01-01", user_id: "u1", total_tokens: 10, source: "s", model: "m" },
        { date: "2026-01-02", user_id: "u1", total_tokens: 50, source: "s", model: "m" },
      ] });
    } finally {
      sqlite.close();
    }
  });

  it("selects only active editable registered rosters and unregistered opted-in teams", async () => {
    const sqlite = new DatabaseSync(":memory:");
    try {
      sqlite.exec(`CREATE TABLE teams (id TEXT, created_by TEXT, auto_register_season INTEGER);
        CREATE TABLE seasons (id TEXT, start_date TEXT, end_date TEXT, allow_roster_changes INTEGER);
        CREATE TABLE season_teams (season_id TEXT, team_id TEXT);
        CREATE TABLE season_team_members (season_id TEXT, team_id TEXT, user_id TEXT);
        INSERT INTO teams VALUES ('registered', 'u1', 1), ('opted-in', 'u2', 1), ('opted-out', 'u3', 0);
        INSERT INTO seasons VALUES
          ('active', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 day'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+1 day'), 1),
          ('future', datetime('now', '+1 day'), datetime('now', '+2 days'), 1),
          ('ended', datetime('now', '-2 days'), datetime('now', '-1 day'), 1),
          ('locked', datetime('now', '-1 day'), datetime('now', '+1 day'), 0);
        INSERT INTO season_teams VALUES ('active', 'registered'), ('future', 'registered'), ('ended', 'registered'), ('locked', 'registered');
        INSERT INTO season_team_members VALUES ('active', 'registered', 'u1'), ('future', 'registered', 'u2'), ('active', 'another', 'u3');`);
      const db = {
        prepare: (sql: string) => ({
          bind: (...params: SQLInputValue[]) => ({
            all: async () => ({ results: sqlite.prepare(sql).all(...params) }),
          }),
        }),
      } as unknown as D1Database;
      const cases: [SeasonsRpcRequest, unknown][] = [
        [{ method: "seasons.listRosterSyncSeasons", teamId: "registered" }, ["active"]],
        [{ method: "seasons.listAutoRegisterTeams", seasonId: "active" }, [{ id: "opted-in", created_by: "u2" }]],
        [{ method: "seasons.getRegisteredTeamIds", seasonId: "active" }, ["registered"]],
        [{ method: "seasons.getRosterUserIds", seasonId: "active", teamId: "registered" }, ["u1"]],
      ];
      for (const [request, result] of cases) {
        const res = await handleSeasonsRpc(request, db, {} as KVNamespace);
        expect(await res.json()).toEqual({ result });
      }
    } finally {
      sqlite.close();
    }
  });
});
