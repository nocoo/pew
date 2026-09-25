import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import type { D1Database, KVNamespace } from "@cloudflare/workers-types";
import { handleLeaderboardRpc } from "../../packages/worker-read/src/rpc/leaderboard";
import { handleSeasonsRpc } from "../../packages/worker-read/src/rpc/seasons";

import { GET } from "../../packages/web/src/app/api/leaderboard/route";
import { getDbRead } from "../../packages/web/src/lib/db";
import { createMockDbRead } from "../../packages/web/src/__tests__/test-utils";

vi.mock("@/lib/db", () => ({ getDbRead: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({ resolveUser: vi.fn() }));

const ids = ["u1", ...Array.from({ length: 100 }, (_, i) => `other-${i}`)];
const teamIds = ["t1", ...ids];
const bounds = { fromDate: "2026-01-01", toDate: "2026-02-01" };

describe("D1 identifier lists within the 100-parameter limit", () => {
  it("executes filtered leaderboard and season queries with full identifier lists", async () => {
    const sqlite = new DatabaseSync(":memory:");
    try {
      sqlite.exec(`CREATE TABLE users(id TEXT, slug TEXT, name TEXT, nickname TEXT, image TEXT, is_public INTEGER);
        INSERT INTO users VALUES ('u1','one','One',NULL,NULL,1);
        CREATE TABLE teams(id TEXT, name TEXT, logo_url TEXT);
        INSERT INTO teams VALUES ('t1','Team',NULL);
        CREATE TABLE team_members(team_id TEXT,user_id TEXT);
        INSERT INTO team_members VALUES ('t1','u1');
        CREATE TABLE season_team_members(season_id TEXT,team_id TEXT,user_id TEXT);
        INSERT INTO season_team_members VALUES ('s1','t1','u1');
        CREATE TABLE session_records(user_id TEXT,started_at TEXT,source TEXT,duration_seconds INTEGER);
        INSERT INTO session_records VALUES ('u1','2026-01-15','codex',60);
        CREATE TABLE usage_totals(user_id TEXT,hour_start TEXT,total_tokens INTEGER,input_tokens INTEGER,output_tokens INTEGER,cached_input_tokens INTEGER,source TEXT,model TEXT,event_id TEXT);
        INSERT INTO usage_totals VALUES ('u1','2026-01-15',100,60,30,10,'codex','model','');
        CREATE VIEW usage_bases AS SELECT * FROM usage_totals;`);
      const db = { prepare: (sql: string) => ({ bind: (...params: unknown[]) => {
        if (params.length > 100) throw new Error("too many SQL variables");
        const statement = sqlite.prepare(sql);
        return { all: async () => ({ results: statement.all(...params as never[]) }), first: async () => statement.get(...params as never[]) ?? null };
      } }) } as unknown as D1Database;
      const kv = { get: async () => null, put: async () => {} } as unknown as KVNamespace;
      for (const method of ["leaderboard.getUserTeams", "leaderboard.getUserSessionStats"] as const) {
        const response = await handleLeaderboardRpc({ method, userIds: ids, fromDate: bounds.fromDate, source: "codex" }, db, kv);
        expect((await response.json()).result).toHaveLength(1);
      }
      for (const method of ["seasons.getMemberTokens", "seasons.getTeamSessionStats", "seasons.getMemberSessionStats", "seasons.aggregateMemberTokens"] as const) {
        const response = await handleSeasonsRpc({ method, seasonId: "s1", teamIds, ...bounds }, db, kv);
        expect((await response.json()).result).toHaveLength(1);
      }
      const conflict = await handleSeasonsRpc({ method: "seasons.checkMemberConflict", seasonId: "s1", userIds: ids }, db, kv);
      expect((await conflict.json()).result).toEqual({ user_id: "u1" });
      const now = new Date().toISOString();
      for (let i = 0; i < 105; i++) {
        sqlite.prepare("INSERT INTO users VALUES (?,?,'User',NULL,NULL,1)").run(`page${i}`, `page${i}`);
        sqlite.prepare("INSERT INTO usage_totals VALUES (?,?,100,60,30,10,'codex','model','')").run(`page${i}`, now);
        sqlite.prepare("INSERT INTO session_records VALUES (?,?,'codex',60)").run(`page${i}`, now);
      }
      const read = createMockDbRead();
      const rpc = async (request: Parameters<typeof handleLeaderboardRpc>[0]) => (await (await handleLeaderboardRpc(request, db, kv)).json()).result;
      read.getGlobalLeaderboard.mockImplementation(async (options) => rpc({ method: "leaderboard.getGlobal", ...options }));
      read.getLeaderboardUserTeams.mockImplementation(async (userIds) => rpc({ method: "leaderboard.getUserTeams", userIds }));
      read.getLeaderboardSessionStats.mockImplementation(async (userIds, fromDate, source) => rpc({ method: "leaderboard.getUserSessionStats", userIds, fromDate, source }));
      vi.mocked(getDbRead).mockResolvedValue(read);
      for (const query of ["limit=100&period=week", "limit=99&period=week&source=codex"]) {
        const response = await GET(new Request(`http://localhost/api/leaderboard?${query}`));
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.entries).toHaveLength(query.includes("limit=100") ? 100 : 99);
        expect(body.entries.every((entry: { session_count: number }) => entry.session_count === 1)).toBe(true);
        expect(body.hasMore).toBe(true);
      }
    } finally { sqlite.close(); }
  });
});
