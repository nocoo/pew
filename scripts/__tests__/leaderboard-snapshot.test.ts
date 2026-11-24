import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { D1Database, KVNamespace } from "@cloudflare/workers-types";
import type { LeaderboardFilters } from "@pew/core";
import {
  getLeaderboardRevision,
  getLeaderboardSnapshot,
} from "../../packages/worker-read/src/leaderboard-snapshot";

describe("versioned leaderboard snapshots against SQLite", () => {
  let sqlite: DatabaseSync;
  let db: D1Database;
  let kv: KVNamespace;
  let stored: Map<string, string>;
  let batches: number;
  let onRead: (() => void) | undefined;
  let onWrite: (() => void) | undefined;
  let onBatch: (() => void) | undefined;
  let queries: Array<{ sql: string; params: SQLInputValue[] }>;

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
    for (const name of [
      "001-init",
      "019-organizations",
      "022-usage-evidence",
      "026-usage-accounting",
      "029-leaderboard-revision",
    ]) {
      sqlite.exec(readFileSync(`scripts/migrations/${name}.sql`, "utf8"));
    }
    sqlite.exec(`INSERT INTO users(id,email,name,is_public) VALUES
      ('a','a@test.invalid','A',1),('b','b@test.invalid','B',1),('private','p@test.invalid','Private',0);
      INSERT INTO usage_records(user_id,device_id,source,model,hour_start,total_tokens,input_tokens) VALUES
      ('a','d','codex','m','2026-09-30T00:00:00.000Z',100,100),
      ('b','d','codex','m','2026-09-30T00:00:00.000Z',100,100),
      ('private','d','codex','m','2026-09-30T00:00:00.000Z',9999,9999);
      INSERT INTO session_records(user_id,session_key,source,started_at,last_message_at,duration_seconds,snapshot_at) VALUES
      ('a','s','codex','2026-09-30T00:00:00.000Z','2026-09-30T00:01:00.000Z',60,'2026-09-30');
      INSERT INTO teams(id,name,slug,invite_code,created_by,created_at) VALUES ('t','Team','team','invite','a','2026-09-01');
      INSERT INTO team_members(id,team_id,user_id,joined_at) VALUES ('tm','t','a','2026-09-01');
      INSERT INTO organizations(id,name,slug,created_by) VALUES ('o','Org','org','a');
      INSERT INTO organization_members(id,org_id,user_id) VALUES ('om','o','b');`);
    queries = [];
    const prepare = (sql: string, params: SQLInputValue[] = []) => ({
      bind: (...values: SQLInputValue[]) => prepare(sql, values),
      first: async () => sqlite.prepare(sql).get(...params) ?? null,
      all: async () => {
        queries.push({ sql, params });
        return { success: true, results: sqlite.prepare(sql).all(...params) };
      },
    });
    batches = 0;
    db = {
      prepare,
      batch: async (statements: ReturnType<typeof prepare>[]) => {
        batches++;
        onBatch?.();
        sqlite.exec("BEGIN");
        try {
          const results = await Promise.all(statements.map((s) => s.all()));
          sqlite.exec("COMMIT");
          return results;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      },
    } as unknown as D1Database;
    stored = new Map();
    onRead = undefined;
    onWrite = undefined;
    onBatch = undefined;
    kv = {
      get: vi.fn(async (key: string) => {
        onRead?.();
        const value = stored.get(key);
        return value ?? null;
      }),
      put: vi.fn(async (key: string, value: string) => {
        onWrite?.();
        stored.set(key, value);
      }),
    } as unknown as KVNamespace;
  });
  afterEach(() => {
    sqlite.close();
    vi.useRealTimers();
  });

  it("shares full, stable rankings and sessions through KV without accounting scans", async () => {
    const first = await getLeaderboardSnapshot({}, db, kv);
    expect(first.rows.map((r) => r.user_id)).toEqual(["a", "b"]);
    expect(first.rows[0]).toMatchObject({
      total_tokens: 100,
      session_count: 1,
      total_duration_seconds: 60,
      teams: [{ id: "t", name: "Team", logoUrl: null }],
    });
    expect(first.expiresAt - first.generatedAt).toBe(30 * 60_000);
    expect(await getLeaderboardSnapshot({}, db, kv)).toEqual(first);
    expect(batches).toBe(1);
  });

  it("uses ten-minute filtered snapshots and separates source, model and scope", async () => {
    for (const [filters, ids] of [
      [{ teamId: "t" }, ["a"]],
      [{ orgId: "o" }, ["b"]],
      [{ source: "missing" }, []],
    ] as const) {
      expect((await getLeaderboardSnapshot(filters, db, kv)).rows.map((r) => r.user_id)).toEqual(
        ids,
      );
    }
    const result = await getLeaderboardSnapshot(
      { fromDate: "2026-09-29T00:00:00.000Z", model: "m" },
      db,
      kv,
    );
    expect(result.expiresAt - result.generatedAt).toBe(600_000);
    expect(result.rows.map((r) => r.session_count)).toEqual([null, null]);
  });

  it.each<LeaderboardFilters>([
    {},
    { source: "codex" },
    { teamId: "t" },
    { orgId: "o" },
    { fromDate: "2026-09-30T00:00:00.000Z" },
    { fromDate: "2026-09-30T00:00:00.000Z", source: "codex" },
    { fromDate: "2026-09-30T00:00:00.000Z", teamId: "t", source: "codex" },
    { fromDate: "2026-09-30T00:00:00.000Z", orgId: "o", source: "codex" },
  ])(
    "bounds session reads by public user and time without changing results: %j",
    async (filters) => {
      sqlite.exec(`INSERT INTO session_records(user_id,session_key,source,started_at,last_message_at,duration_seconds,snapshot_at) VALUES
      ('b','boundary','codex','2026-09-30T00:00:00.000Z','2026-09-30T00:01:00.000Z',120,'2026-09-30'),
      ('a','other','grok','2026-10-01T00:00:00.000Z','2026-10-01T00:01:00.000Z',30,'2026-10-01'),
      ('private','hidden','codex','2026-10-01T00:00:00.000Z','2026-10-01T00:01:00.000Z',999,'2026-10-01');
      WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<1024)
      INSERT INTO session_records(user_id,session_key,source,started_at,last_message_at,duration_seconds,snapshot_at)
      SELECT 'a','old-'||i,'codex','2020-01-01T00:00:00.000Z','2020-01-01T00:01:00.000Z',1,'2020-01-01' FROM n;
      ANALYZE;`);
      const expected = sqlite
        .prepare(`SELECT sr.user_id, COUNT(*) AS session_count,
      SUM(sr.duration_seconds) AS total_duration_seconds FROM session_records sr
      JOIN users u ON u.id=sr.user_id WHERE u.is_public=1
      AND (? IS NULL OR sr.started_at>=?) AND (? IS NULL OR sr.source=?)
      AND (? IS NULL OR EXISTS (SELECT 1 FROM team_members tm WHERE tm.user_id=sr.user_id AND tm.team_id=?))
      AND (? IS NULL OR EXISTS (SELECT 1 FROM organization_members om WHERE om.user_id=sr.user_id AND om.org_id=?))
      GROUP BY sr.user_id`)
        .all(
          filters.fromDate ?? null,
          filters.fromDate ?? null,
          filters.source ?? null,
          filters.source ?? null,
          filters.teamId ?? null,
          filters.teamId ?? null,
          filters.orgId ?? null,
          filters.orgId ?? null,
        );
      const result = await getLeaderboardSnapshot(filters, db, kv);
      expect(
        result.rows.map(({ user_id, session_count, total_duration_seconds }) => ({
          user_id,
          session_count,
          total_duration_seconds,
        })),
      ).toEqual(expected);
      const query = queries.find(({ sql }) => sql.includes("FROM session_records sr"));
      expect(query).toBeDefined();
      if (!query) throw new Error("Missing session aggregate");
      const plan = sqlite
        .prepare(`EXPLAIN QUERY PLAN ${query.sql}`)
        .all(...query.params)
        .map((row) => row.detail)
        .join("\n");
      const access =
        filters.source && !filters.fromDate
          ? "idx_session_user_source_project (user_id=? AND source=?)"
          : `idx_session_user_time (user_id=?${filters.fromDate ? " AND started_at>?" : ""})`;
      expect(plan).toContain(`SEARCH sr USING INDEX ${access}`);
      expect(plan).not.toMatch(/SCAN sr\b/);
    },
  );

  it("invalidates all pages after privacy, identity and membership changes", async () => {
    const first = await getLeaderboardSnapshot({}, db, kv);
    sqlite.exec("UPDATE users SET is_public=0 WHERE id='a'");
    const second = await getLeaderboardSnapshot({}, db, kv);
    expect(second.revision).not.toBe(first.revision);
    expect(second.rows.map((r) => r.user_id)).toEqual(["b"]);
    sqlite.exec("UPDATE users SET nickname='New' WHERE id='b'");
    expect((await getLeaderboardSnapshot({}, db, kv)).rows[0].nickname).toBe("New");
    sqlite.exec("DELETE FROM organization_members");
    expect((await getLeaderboardSnapshot({ orgId: "o" }, db, kv)).rows).toEqual([]);
  });

  it("keeps ingest warm but invalidates account deletion and does not resurrect old fills", async () => {
    const first = await getLeaderboardSnapshot({}, db, kv);
    sqlite.exec("UPDATE usage_records SET input_tokens=500,total_tokens=500 WHERE user_id='b'");
    expect((await getLeaderboardSnapshot({}, db, kv)).id).toBe(first.id);
    stored.clear();
    onWrite = () => {
      onWrite = undefined;
      sqlite.exec(
        "DELETE FROM usage_records WHERE user_id='b'; DELETE FROM organization_members WHERE user_id='b'; DELETE FROM users WHERE id='b'",
      );
    };
    const result = await getLeaderboardSnapshot({}, db, kv);
    expect(result.rows.map((r) => r.user_id)).toEqual(["a"]);
    expect(result.revision).toBe(await getLeaderboardRevision(db));
  });

  it("rechecks a KV hit after a concurrent visibility change and bounds retries", async () => {
    await getLeaderboardSnapshot({}, db, kv);
    onRead = () => {
      onRead = undefined;
      sqlite.exec("UPDATE users SET is_public=0 WHERE id='a'");
    };
    expect((await getLeaderboardSnapshot({}, db, kv)).rows.map((r) => r.user_id)).toEqual(["b"]);
    onRead = () => sqlite.exec("UPDATE users SET nickname=hex(randomblob(4)) WHERE id='b'");
    await expect(getLeaderboardSnapshot({}, db, kv)).rejects.toThrow(
      "Leaderboard changed during read",
    );
  });

  it("does not renew expiry and treats corrupt or unsafe KV values as misses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-03T00:00:00Z"));
    const first = await getLeaderboardSnapshot({}, db, kv);
    vi.advanceTimersByTime(1_799_999);
    expect((await getLeaderboardSnapshot({}, db, kv)).expiresAt).toBe(first.expiresAt);
    vi.advanceTimersByTime(1);
    expect((await getLeaderboardSnapshot({}, db, kv)).generatedAt).not.toBe(first.generatedAt);
    for (const value of [
      null,
      {},
      {
        ...first,
        expiresAt: Date.now() + 10_000,
        rows: [{ ...first.rows[0], total_tokens: Number.MAX_SAFE_INTEGER + 1 }],
      },
    ]) {
      for (const key of stored.keys()) stored.set(key, JSON.stringify(value));
      expect((await getLeaderboardSnapshot({}, db, kv)).rows[0].total_tokens).toBe(100);
    }
  });

  it("serves valid data on KV failures but fails closed without authority", async () => {
    vi.mocked(kv.get).mockRejectedValue(new Error("KV unavailable"));
    vi.mocked(kv.put).mockRejectedValue(new Error("KV unavailable"));
    expect((await getLeaderboardSnapshot({}, db, kv)).rows).toHaveLength(2);
    sqlite.exec("DELETE FROM leaderboard_revision");
    await expect(getLeaderboardSnapshot({}, db, kv)).rejects.toThrow(
      "Leaderboard revision unavailable",
    );
  });

  it("revision triggers cover changes, ignore no-op identities and roll back atomically", async () => {
    const original = await getLeaderboardRevision(db);
    sqlite.exec("UPDATE users SET name=name, api_key='key' WHERE id='a'");
    expect(await getLeaderboardRevision(db)).toBe(original);
    sqlite.exec("BEGIN; UPDATE users SET is_public=0 WHERE id='a'; ROLLBACK");
    expect(await getLeaderboardRevision(db)).toBe(original);
    for (const sql of [
      "UPDATE teams SET name='New'",
      "UPDATE team_members SET role='admin'",
      "UPDATE organization_members SET org_id='o'",
      "DELETE FROM team_members",
      "DELETE FROM teams WHERE id='t'",
    ]) {
      const before = await getLeaderboardRevision(db);
      sqlite.exec(sql);
      expect(await getLeaderboardRevision(db)).not.toBe(before);
    }
  });

  it("retries if the revision changes before the snapshot transaction", async () => {
    onBatch = () => {
      onBatch = undefined;
      sqlite.exec("UPDATE users SET is_public=0 WHERE id='a'");
    };
    expect((await getLeaderboardSnapshot({}, db, kv)).rows.map((r) => r.user_id)).toEqual(["b"]);
    expect(batches).toBe(2);
    expect(kv.put).toHaveBeenCalledOnce();
  });

  it("gives identical concurrent fills the same pagination identity", async () => {
    const [a, b] = await Promise.all([
      getLeaderboardSnapshot({ model: "m" }, db, kv),
      getLeaderboardSnapshot({ model: "m" }, db, kv),
    ]);
    expect(a.id).toBe(b.id);
  });

  it("does not truncate oversize payloads or persist them to KV", async () => {
    sqlite.prepare("UPDATE users SET name=? WHERE id='a'").run("x".repeat(300_000));
    const result = await getLeaderboardSnapshot({}, db, kv);
    expect(result.rows[0].name).toHaveLength(300_000);
    expect(kv.put).not.toHaveBeenCalled();
  });

  it("bounds filters and rejects invalid database counts before persisting", async () => {
    await expect(getLeaderboardSnapshot({ model: "x".repeat(1025) }, db, kv)).rejects.toThrow(
      "Invalid leaderboard filter",
    );
    sqlite.exec("UPDATE usage_records SET total_tokens=1.5 WHERE user_id='a'");
    await expect(getLeaderboardSnapshot({}, db, kv)).rejects.toThrow(
      "Invalid leaderboard snapshot",
    );
    expect(kv.put).not.toHaveBeenCalled();
  });

  it("preserves ingest model names up to 1024 characters without byte truncation", async () => {
    const model = "\u4e2d".repeat(1024);
    sqlite.prepare("UPDATE usage_records SET model=? WHERE user_id='a'").run(model);
    expect((await getLeaderboardSnapshot({ model }, db, kv)).rows.map((r) => r.user_id)).toEqual([
      "a",
    ]);
  });

  it("projects only known fields from cached payloads before response count validation", async () => {
    const first = await getLeaderboardSnapshot({}, db, kv);
    for (const key of stored.keys())
      stored.set(key, JSON.stringify({ ...first, total_tokens: -1, secret: "never returned" }));
    expect(await getLeaderboardSnapshot({}, db, kv)).toEqual(first);
    expect(batches).toBe(1);
  });

  it("does not persist an explicitly failed D1 batch", async () => {
    vi.spyOn(db, "batch").mockResolvedValueOnce([{ success: false, results: [] }] as never);
    await expect(getLeaderboardSnapshot({}, db, kv)).rejects.toThrow("Leaderboard query failed");
    expect(kv.put).not.toHaveBeenCalled();
  });
});
