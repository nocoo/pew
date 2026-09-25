import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { D1Database, KVNamespace } from "@cloudflare/workers-types";
import { POST } from "@/app/api/admin/seasons/[seasonId]/snapshot/route";
import { DELETE } from "@/app/api/account/delete/route";
import { getDbRead, getDbWrite } from "@/lib/db";
import { handleSeasonsRpc, type SeasonsRpcRequest } from "../../packages/worker-read/src/rpc/seasons";
import { createMockDbRead, createMockDbWrite } from "../../packages/web/src/__tests__/test-utils";

vi.mock("@/lib/db", () => ({ getDbRead: vi.fn(), getDbWrite: vi.fn() }));
vi.mock("@/lib/admin", () => ({ resolveAdmin: vi.fn(async () => ({ userId: "owner" })) }));
vi.mock("@/lib/auth-helpers", () => ({ resolveUser: vi.fn(async () => ({ userId: "deleted" })) }));

describe("account deletion concurrent with snapshot generation", () => {
  it.each(["before-member-read", "after-member-read", "after-snapshot-write"])("does not restore erased contributions: %s", async (when) => {
    const sqlite = new DatabaseSync(":memory:");
    try {
      for (const name of ["001-init", "006b-seasons", "007b-season-team-members", "008-snapshot-ready"]) {
        sqlite.exec(readFileSync(`scripts/migrations/${name}.sql`, "utf8"));
      }
      sqlite.exec(`PRAGMA foreign_keys=ON;
        INSERT INTO users(id,email) VALUES ('owner','owner@test.invalid'),('deleted','deleted@test.invalid');
        INSERT INTO teams(id,name,slug,invite_code,created_by,created_at) VALUES ('t1','Team','team','invite1','owner',datetime('now')),('zero','Zero','zero','invite2','owner',datetime('now'));
        INSERT INTO seasons(id,name,slug,start_date,end_date,created_by,snapshot_ready) VALUES ('s1','Season','season','2026-01-01T00:00:00Z','2026-01-31T23:59:00Z','owner',1);
        INSERT INTO season_teams(id,season_id,team_id,registered_by) VALUES ('st1','s1','t1','owner'),('st0','s1','zero','owner');
        INSERT INTO season_team_members(id,season_id,team_id,user_id) VALUES ('m1','s1','t1','owner'),('m2','s1','t1','deleted');
        INSERT INTO usage_records(user_id,source,model,hour_start,input_tokens,total_tokens) VALUES ('owner','codex','m','2026-01-15T00:00:00.000Z',40,40),('deleted','codex','m','2026-01-15T00:00:00.000Z',100,100);
        CREATE VIEW usage_totals AS SELECT * FROM usage_records;
        INSERT INTO season_snapshots(id,season_id,team_id,rank,total_tokens,input_tokens) VALUES ('ss','s1','t1',1,140,140);
        INSERT INTO season_member_snapshots(id,season_id,team_id,user_id,total_tokens,input_tokens) VALUES ('ms1','s1','t1','owner',40,40),('ms2','s1','t1','deleted',100,100);`);
      for (const name of ["usage_details", "usage_evidence", "session_records", "device_aliases", "organization_members", "auth_codes"]) {
        sqlite.exec(`CREATE TABLE IF NOT EXISTS ${name}(user_id TEXT REFERENCES users(id))`);
      }
      const native = { prepare: (sql: string) => ({ bind: (...params: unknown[]) => ({
        all: async () => ({ results: sqlite.prepare(sql).all(...params as never[]) }),
      }) }) } as unknown as D1Database;
      const rpc = async (request: SeasonsRpcRequest) => (await (await handleSeasonsRpc(request, native, {} as KVNamespace)).json()).result;
      const read = createMockDbRead();
      const write = createMockDbWrite();
      vi.mocked(getDbRead).mockResolvedValue(read);
      vi.mocked(getDbWrite).mockResolvedValue(write);
      read.getUserById.mockImplementation(async (id) => sqlite.prepare("SELECT * FROM users WHERE id=?").get(id));
      read.getSeasonById.mockImplementation(async () => sqlite.prepare("SELECT * FROM seasons WHERE id='s1'").get());
      read.getRegisteredTeamIds.mockImplementation(async () => ["t1", "zero"]);
      const erase = async () => {
        const response = await DELETE(new Request("http://localhost/api/account/delete", { method: "DELETE", body: JSON.stringify({ confirm_email: "deleted@test.invalid" }) }));
        expect(response.status).toBe(200);
        expect(sqlite.prepare("SELECT total_tokens FROM season_snapshots WHERE team_id='t1'").get()?.total_tokens).toBe(40);
      };
      read.aggregateSeasonMemberTokens.mockImplementation(async (seasonId, fromDate, toDate, teamIds) => {
        if (when === "before-member-read") await erase();
        const rows = await rpc({ method: "seasons.aggregateMemberTokens", seasonId, fromDate, toDate, teamIds });
        if (when === "after-member-read") await erase();
        return rows;
      });
      write.execute.mockImplementation(async (sql, params = []) => ({ changes: Number(sqlite.prepare(sql).run(...params as never[]).changes), duration: 0 }));
      write.batch.mockImplementation(async (statements: Array<{ sql: string; params?: unknown[] }>) => {
        sqlite.exec("BEGIN");
        try {
          for (const { sql, params = [] } of statements) sqlite.prepare(sql).run(...params as never[]);
          sqlite.exec("COMMIT");
        } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
        if (when === "after-snapshot-write" && statements.some(({ sql }) => sql.startsWith("INSERT OR REPLACE INTO season_snapshots"))) await erase();
        return [];
      });
      const response = await POST(new Request("http://localhost/api/snapshot", { method: "POST" }), { params: Promise.resolve({ seasonId: "s1" }) });
      expect(response.status).toBe(when === "after-member-read" ? 500 : 201);
      expect(sqlite.prepare("SELECT total_tokens FROM season_snapshots WHERE team_id='t1'").get()?.total_tokens).toBe(40);
      expect(sqlite.prepare("SELECT SUM(total_tokens) AS n FROM season_member_snapshots WHERE team_id='t1'").get()?.n).toBe(40);
      expect(sqlite.prepare("SELECT id FROM users WHERE id='deleted'").get()).toBeUndefined();
      if (response.ok) expect(sqlite.prepare("SELECT total_tokens FROM season_snapshots WHERE team_id='zero'").get()?.total_tokens).toBe(0);
      expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { sqlite.close(); }
  });
});
