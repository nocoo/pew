import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { D1Database, KVNamespace } from "@cloudflare/workers-types";
import { handleLeaderboardRpc } from "../../packages/worker-read/src/rpc/leaderboard";
import { handleUsageRpc, type UsageRpcRequest } from "../../packages/worker-read/src/rpc/usage";
import { handleDevicesRpc } from "../../packages/worker-read/src/rpc/devices";
import { withAccounting } from "../../packages/worker-read/src/rpc/accounting";

describe("D1 read queries against real SQLite", () => {
  let sqlite: DatabaseSync;
  let db: D1Database;
  let queries: Array<{ sql: string; params: unknown[] }>;
  const kv = { get: vi.fn(async () => null), put: vi.fn(async () => {}) } as unknown as KVNamespace;
  const fromDate = "2026-09-01T00:00:00.000Z";
  const toDate = "2026-09-02T00:00:00.000Z";

  beforeEach(() => {
    vi.mocked(kv.get).mockReset();
    vi.mocked(kv.get).mockResolvedValue(null);
    sqlite = new DatabaseSync(":memory:");
    for (const name of ["001-init", "009-device-aliases", "019-organizations", "022-usage-evidence", "026-usage-accounting"]) {
      sqlite.exec(readFileSync(`scripts/migrations/${name}.sql`, "utf8"));
    }
    sqlite.exec(`INSERT INTO users(id,email,name,is_public) VALUES ('u1','a@test.invalid','A',1), ('u2','b@test.invalid','B',1), ('private','c@test.invalid','C',0);
      INSERT INTO usage_records(user_id,device_id,source,model,hour_start,input_tokens,cached_input_tokens,output_tokens,reasoning_output_tokens,total_tokens)
      VALUES ('u1','d1','codex','m1','${fromDate}',10,20,30,5,65), ('u1','d2','claude-code','m2','${fromDate}',100,0,0,0,100),
        ('u1','d1','codex','m1','${toDate}',999,0,0,0,999), ('u2','d1','codex','m1','${fromDate}',200,0,0,0,200),
        ('private','d1','codex','m1','${fromDate}',9999,0,0,0,9999), ('u1','zero','codex','m1','${fromDate}',0,0,0,0,0);
      INSERT INTO device_aliases(user_id,device_id,alias) VALUES ('u1','alias-only','Spare');
      INSERT INTO usage_evidence(user_id,device_id,event_id,group_id,source,model,hour_start,timestamp,call_type,origin,provider,granularity,time_precision,snapshot_seq,input_tokens,cached_input_tokens,output_tokens,reasoning_output_tokens,total_tokens)
      VALUES ('u1','d1','e1','g','codex','m1','${fromDate}','${fromDate}','request','test','test','operation','exact',1,3,4,5,6,18),
        ('u1','checkpoint','e0','g','codex','m1','${fromDate}','${fromDate}','request','test','test','operation','exact',1,0,0,0,0,0);
      INSERT INTO usage_details(user_id,device_id,source,model,hour_start,event_id,evidence_snapshot_seq,details_version,source_revision,parser_revision,detail_revision,input_tokens,cached_input_tokens,output_tokens,reasoning_output_tokens,total_tokens,groups_json)
      VALUES ('u1','d1','codex','m1','${fromDate}','',NULL,1,1,1,1,10,20,30,5,65,'[]'),
        ('u1','d1','codex','m1','${fromDate}','e1',2,1,1,1,1,3,4,5,6,18,'[]');`);
    queries = [];
    db = { prepare: (sql: string) => ({ bind: (...params: unknown[]) => {
      queries.push({ sql, params });
      const statement = sqlite.prepare(sql);
      return {
        all: async () => ({ results: statement.all(...params as never[]) }),
        first: async () => statement.get(...params as never[]) ?? null,
      };
    } }) } as unknown as D1Database;
  });
  afterEach(() => sqlite.close());

  it("ranks additive legacy and evidence counters without reading accounting details", async () => {
    const body = await (await handleLeaderboardRpc({ method: "leaderboard.getGlobal", limit: 100 }, db, kv)).json();
    expect(body.result.map((r: { user_id: string; total_tokens: number }) => [r.user_id, r.total_tokens])).toEqual([["u1", 1182], ["u2", 200]]);
    const { sql, params } = queries[0];
    const plan = sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params as never[]);
    expect(JSON.stringify(plan)).not.toMatch(/usage_details|SEARCH d /);
    const filtered = await (await handleLeaderboardRpc({ method: "leaderboard.getGlobal", source: "codex", model: "m1", fromDate, limit: 1, offset: 1 }, db, kv)).json();
    expect(filtered.result).toMatchObject([{ user_id: "u2", total_tokens: 200 }]);
  });

  it("paginates current public users after a cached-page user becomes private or is deleted", async () => {
    const insert = sqlite.prepare("INSERT INTO users(id,email,name,is_public) VALUES (?,?,?,1)");
    const usage = sqlite.prepare("INSERT INTO usage_records(user_id,device_id,source,model,hour_start,input_tokens,cached_input_tokens,output_tokens,reasoning_output_tokens,total_tokens) VALUES (?,'d','codex','m',?, ?,0,0,0,?)");
    for (let i = 0; i < 101; i++) {
      insert.run(`page${i}`, `page${i}@test.invalid`, `Page ${i}`);
      usage.run(`page${i}`, fromDate, 10000 - i, 10000 - i);
    }
    const request = { method: "leaderboard.getGlobal", limit: 21 } as const;
    const original = await (await handleLeaderboardRpc(request, db, kv)).json();
    vi.mocked(kv.get).mockResolvedValue(original.result);
    sqlite.exec("UPDATE users SET is_public=0 WHERE id='page0'");
    const first = await (await handleLeaderboardRpc(request, db, kv)).json();
    const next = await (await handleLeaderboardRpc({ ...request, offset: 20 }, db, kv)).json();
    expect(first.result).toHaveLength(21);
    expect(first.result[0].user_id).toBe("page1");
    expect(next.result[0].user_id).toBe("page21");
    sqlite.exec("DELETE FROM usage_records WHERE user_id='page1'; DELETE FROM users WHERE id='page1'");
    const full = await (await handleLeaderboardRpc({ ...request, limit: 101 }, db, kv)).json();
    expect(full.result).toHaveLength(101);
    expect(full.result[0].user_id).toBe("page2");
    expect(full.result.some((row: { user_id: string }) => ["page0", "page1"].includes(row.user_id))).toBe(false);
    expect(queries.every(({ params }) => params.length <= 100)).toBe(true);
  });

  it("applies team and organization membership before pagination without exposing private users", async () => {
    sqlite.exec(`INSERT INTO teams(id,name,slug,invite_code,created_by,created_at) VALUES ('t1','T','t','invite','u1','${fromDate}');
      INSERT INTO team_members(id,team_id,user_id,joined_at) VALUES ('tm1','t1','u2','${fromDate}'), ('tm2','t1','private','${fromDate}');
      INSERT INTO organizations(id,name,slug,created_by) VALUES ('o1','O','o','u1');
      INSERT INTO organization_members(id,org_id,user_id) VALUES ('om1','o1','u1'), ('om2','o1','private');`);
    for (const [scope, user] of [[{ teamId: "t1" }, "u2"], [{ orgId: "o1" }, "u1"]] as const) {
      const body = await (await handleLeaderboardRpc({ method: "leaderboard.getGlobal", ...scope, limit: 100 }, db, kv)).json();
      expect(body.result.map((r: { user_id: string }) => r.user_id)).toEqual([user]);
      expect(body._cached).toBe(false);
    }
  });

  it.each([
    { method: "usage.get", granularity: "half-hour" },
    { method: "usage.get", granularity: "day", tzOffset: -480, source: "codex", deviceId: "d1" },
    { method: "usage.getDeviceSummary" },
    { method: "usage.getDeviceCostDetails" },
    { method: "usage.getDeviceTimeline", granularity: "day", tzOffset: -480 },
  ] as const)("preserves accounting and uses user/time indexes for $method $granularity", async (options) => {
    const req: UsageRpcRequest = { ...options, userId: "u1", fromDate, toDate };
    const body = await (await handleUsageRpc(req, db)).json();
    const totals = body.result.reduce((n: number, r: { input_tokens: number; cached_input_tokens: number; output_tokens: number; reasoning_output_tokens: number }) =>
      n + r.input_tokens + r.cached_input_tokens + r.output_tokens + r.reasoning_output_tokens, 0);
    expect(totals).toBe("deviceId" in options ? 83 : 183);
    const annotations = body.result.flatMap((r: { accounting?: unknown[] }) => r.accounting ?? []);
    const reference = withAccounting(sqlite.prepare("SELECT json_group_array(json(accounting_json)) AS accounting_json FROM usage_totals WHERE user_id='u1' AND device_id='d1' AND hour_start >= ? AND hour_start < ?").get(fromDate, toDate) as { accounting_json: string });
    expect(annotations).toEqual(expect.arrayContaining(reference.accounting!));
    expect(annotations).toHaveLength(2);
    const { sql, params } = queries[0];
    const plan = JSON.stringify(sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params as never[]));
    expect(plan).toContain("SEARCH usage_records USING INDEX idx_usage_user_time");
    expect(plan).toContain("SEARCH usage_evidence USING INDEX idx_evidence_user_time");
  });

  it("keeps zero legacy buckets and alias-only devices, but excludes evidence checkpoints", async () => {
    const body = await (await handleDevicesRpc({ method: "devices.list", userId: "u1" }, db)).json();
    expect(body.result.map((r: { device_id: string }) => r.device_id)).toEqual(["d1", "d2", "alias-only", "zero"]);
    for (const [deviceId, expected] of [["zero", true], ["checkpoint", false], ["alias-only", false]] as const) {
      expect(await (await handleDevicesRpc({ method: "devices.hasRecords", userId: "u1", deviceId }, db)).json()).toEqual({ result: { hasRecords: expected } });
    }
    for (const [deviceId, exists] of [["zero", true], ["checkpoint", false], ["alias-only", true]] as const) {
      expect(await (await handleDevicesRpc({ method: "devices.exists", userId: "u1", deviceId }, db)).json()).toEqual({ result: { exists } });
    }
    const plan = JSON.stringify(sqlite.prepare(`EXPLAIN QUERY PLAN ${queries[0].sql}`).all(...queries[0].params as never[]));
    expect(plan).not.toContain("usage_details");
  });
});
