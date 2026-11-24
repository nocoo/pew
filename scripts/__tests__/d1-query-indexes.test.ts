import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { memoryKv } from "../../packages/worker-read/src/__test-helpers__/memory-kv";
import { handleLeaderboardRpc } from "../../packages/worker-read/src/rpc/leaderboard";
import { handleUsersRpc } from "../../packages/worker-read/src/rpc/users";

type D1Database = Parameters<typeof handleUsersRpc>[1];

const migration = (name: string) => readFileSync(`scripts/migrations/${name}.sql`, "utf8");
const early = "2026-09-01T00:00:00.000Z";
const late = "2026-09-02T00:00:00.000Z";
const checkpoint = "2026-08-01T00:00:00.000Z";

describe("D1 query indexes against native SQLite", () => {
  let sqlite: DatabaseSync;
  let db: D1Database;
  let queries: Array<{ sql: string; params: SQLInputValue[] }>;

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
    for (const name of [
      "001-init",
      "010-query-optimization",
      "019-organizations",
      "022-usage-evidence",
      "026-usage-accounting",
      "029-leaderboard-revision",
    ]) {
      sqlite.exec(migration(name));
    }
    sqlite.exec(`INSERT INTO users(id,email,is_public) VALUES
      ('u1','one@test.invalid',1), ('u2','two@test.invalid',1), ('private','private@test.invalid',0)`);
    queries = [];
    const prepare = (sql: string, params: SQLInputValue[] = []) => ({
      bind: (...values: SQLInputValue[]) => prepare(sql, values),
      first: async () => {
        queries.push({ sql, params });
        return sqlite.prepare(sql).get(...params) ?? null;
      },
      all: async () => {
        queries.push({ sql, params });
        return { success: true, results: sqlite.prepare(sql).all(...params) };
      },
    });
    db = {
      prepare,
      batch: async (statements: ReturnType<typeof prepare>[]) => {
        sqlite.exec("BEGIN");
        try {
          const results = [];
          for (const statement of statements) results.push(await statement.all());
          sqlite.exec("COMMIT");
          return results;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      },
    } as unknown as D1Database;
  });

  afterEach(() => sqlite.close());

  function insertLegacy(
    userId: string,
    time: string,
    tokens: number,
    deviceId = "d1",
    source = "codex",
  ) {
    sqlite
      .prepare(`INSERT INTO usage_records(user_id,device_id,source,model,hour_start,input_tokens,total_tokens)
      VALUES (?,?,?,'m',?,?,?)`)
      .run(userId, deviceId, source, time, tokens, tokens);
  }

  function insertEvidence(
    userId: string,
    time: string,
    tokens: number,
    eventId: string,
    source = "codex",
  ) {
    sqlite
      .prepare(`INSERT INTO usage_evidence(user_id,device_id,event_id,group_id,source,model,hour_start,
      timestamp,call_type,origin,provider,granularity,time_precision,snapshot_seq,
      input_tokens,cached_input_tokens,output_tokens,reasoning_output_tokens,total_tokens)
      VALUES (?,'d1',?,'g',?,'m',?,?,'request','test','test','operation','exact',1,?,0,0,0,?)`)
      .run(userId, eventId, source, time, time, tokens, tokens);
  }

  function explain({ sql, params }: (typeof queries)[number]) {
    return sqlite
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all(...params)
      .map((row) => row.detail)
      .join("\n");
  }

  describe("users.getFirstSeen", () => {
    it.each<{
      name: string;
      legacy: Array<[string, number]>;
      evidence: Array<[string, number]>;
      expected: string | null;
    }>([
      { name: "no activity", legacy: [], evidence: [], expected: null },
      {
        name: "only evidence checkpoints",
        legacy: [],
        evidence: [[checkpoint, 0]],
        expected: null,
      },
      { name: "only a zero legacy bucket", legacy: [[early, 0]], evidence: [], expected: early },
      {
        name: "legacy only, out of insertion order",
        legacy: [
          [late, 20],
          [early, 10],
        ],
        evidence: [],
        expected: early,
      },
      {
        name: "evidence only, excluding checkpoints",
        legacy: [],
        evidence: [
          [late, 20],
          [early, 10],
          [checkpoint, 0],
        ],
        expected: early,
      },
      {
        name: "legacy before evidence",
        legacy: [[early, 10]],
        evidence: [
          [late, 20],
          [checkpoint, 0],
        ],
        expected: early,
      },
      {
        name: "evidence before legacy",
        legacy: [[late, 20]],
        evidence: [[early, 10]],
        expected: early,
      },
      {
        name: "zero legacy before positive usage",
        legacy: [
          [late, 20],
          [early, 0],
        ],
        evidence: [
          [late, 10],
          [checkpoint, 0],
        ],
        expected: early,
      },
      {
        name: "tied buckets across devices and sources",
        legacy: [
          [early, 0],
          [early, 10],
        ],
        evidence: [
          [early, 20],
          [early, 30],
        ],
        expected: early,
      },
    ])("preserves $name and user isolation", async ({ legacy, evidence, expected }) => {
      insertLegacy("u2", checkpoint, 100);
      insertEvidence("u2", checkpoint, 100, "other-user");
      for (const [i, [time, tokens]] of legacy.entries()) {
        insertLegacy("u1", time, tokens, `d${i}`, i % 2 ? "claude-code" : "codex");
      }
      for (const [i, [time, tokens]] of evidence.entries()) {
        insertEvidence("u1", time, tokens, `e${i}`, i % 2 ? "claude-code" : "codex");
      }

      const reference = sqlite
        .prepare("SELECT MIN(hour_start) AS first_seen FROM usage_totals WHERE user_id = ?")
        .get("u1");
      const response = await handleUsersRpc({ method: "users.getFirstSeen", userId: "u1" }, db);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ result: expected });
      expect(reference).toEqual({ first_seen: expected });
    });

    it("uses ordered user/time lookups without sorting, grouping or accounting JSON", async () => {
      sqlite.exec(migration("028-leaderboard-indexes"));
      insertLegacy("u1", early, 0);
      insertEvidence("u1", late, 10, "positive");
      insertEvidence("u1", checkpoint, 0, "checkpoint");
      sqlite.exec(`INSERT INTO usage_details(user_id,device_id,source,model,hour_start,event_id,
        details_version,source_revision,parser_revision,detail_revision,
        input_tokens,cached_input_tokens,output_tokens,reasoning_output_tokens,total_tokens,groups_json)
        VALUES ('u1','d1','codex','m','${early}','',1,1,1,1,0,0,0,0,0,'[]')`);

      const response = await handleUsersRpc({ method: "users.getFirstSeen", userId: "u1" }, db);
      expect(await response.json()).toEqual({ result: early });
      expect(queries).toHaveLength(1);
      const plan = explain(queries[0]);
      expect(plan).toContain(
        "SEARCH usage_records USING COVERING INDEX idx_usage_user_time (user_id=?)",
      );
      expect(plan).toContain(
        "SEARCH usage_evidence USING INDEX idx_evidence_user_time (user_id=?)",
      );
      expect(plan).not.toMatch(/usage_details|SEARCH d |SCAN usage_|USE TEMP B-TREE/i);
      expect(queries[0].sql).not.toMatch(/usage_totals|usage_bases|json|GROUP BY/i);
      expect(queries[0].sql.match(/ORDER BY hour_start\s+LIMIT 1/gi)).toHaveLength(2);
    });
  });

  describe("leaderboard migration", () => {
    beforeEach(() => {
      insertLegacy("u1", early, 10);
      insertEvidence("u1", early, 5, "positive");
      insertLegacy("u1", early, 20, "d1", "claude-code");
      insertLegacy("u2", early, 30);
      insertEvidence("u2", late, 10, "positive");
      insertLegacy("private", early, 999);
      insertEvidence("private", early, 999, "private");
      insertEvidence("u1", early, 0, "checkpoint");
      for (let i = 0; i < 512; i++) {
        const time = new Date(Date.UTC(2020, 0, 1, i)).toISOString();
        const source = i % 2 ? "codex" : "claude-code";
        insertLegacy("u1", time, 1000, "d1", source);
        insertEvidence("u2", time, 1000, `old${i}`, source);
      }
    });

    it("adds only four narrow indexes, preserves rows and is repeatable", () => {
      const tables = ["usage_records", "usage_evidence", "usage_details", "usage_totals"];
      const rows = tables.map((table) => sqlite.prepare(`SELECT * FROM ${table}`).all());
      const indexes = sqlite
        .prepare("SELECT name FROM sqlite_schema WHERE type = 'index'")
        .all()
        .map((row) => row.name);
      sqlite.exec(migration("028-leaderboard-indexes"));
      sqlite.exec(migration("028-leaderboard-indexes"));
      const added = sqlite
        .prepare("SELECT name,tbl_name FROM sqlite_schema WHERE type = 'index' ORDER BY name")
        .all()
        .filter((row) => !indexes.includes(row.name));
      expect(added).toEqual([
        { name: "idx_evidence_source_time", tbl_name: "usage_evidence" },
        { name: "idx_evidence_time", tbl_name: "usage_evidence" },
        { name: "idx_usage_source_time", tbl_name: "usage_records" },
        { name: "idx_usage_time", tbl_name: "usage_records" },
      ]);
      for (const { name } of added) {
        const columns = sqlite
          .prepare(`PRAGMA index_info(${name})`)
          .all()
          .map((row) => row.name);
        expect(columns).toEqual(
          String(name).includes("source") ? ["source", "hour_start"] : ["hour_start"],
        );
      }
      expect(tables.map((table) => sqlite.prepare(`SELECT * FROM ${table}`).all())).toEqual(rows);
      expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    });

    it.each([
      {
        source: undefined,
        suffix: "time",
        range: "hour_start>?",
        totals: [
          ["u2", 40],
          ["u1", 35],
        ],
      },
      {
        source: "codex",
        suffix: "source_time",
        range: "source=? AND hour_start>?",
        totals: [
          ["u2", 40],
          ["u1", 15],
        ],
      },
    ])(
      "uses $suffix range indexes in the actual leaderboard query",
      async ({ source, suffix, range, totals }) => {
        const request = { method: "leaderboard.getSnapshot", fromDate: early, source } as const;
        const before = await (await handleLeaderboardRpc(request, db, memoryKv())).json();
        expect(
          before.result.rows.map((row: { user_id: string; total_tokens: number }) => [
            row.user_id,
            row.total_tokens,
          ]),
        ).toEqual(totals);
        const beforeQuery = queries.find(({ sql }) => sql.includes("WITH totals AS"));
        expect(beforeQuery).toBeDefined();
        expect(explain(beforeQuery!)).not.toContain(`idx_usage_${suffix}`);
        expect(explain(beforeQuery!)).not.toContain(`idx_evidence_${suffix}`);

        sqlite.exec(migration("028-leaderboard-indexes"));
        sqlite.exec("ANALYZE");
        queries.length = 0;
        const after = await (await handleLeaderboardRpc(request, db, memoryKv())).json();
        expect(after.result.rows).toEqual(before.result.rows);
        const query = queries.find(({ sql }) => sql.includes("WITH totals AS"));
        expect(query).toBeDefined();
        const plan = explain(query!);
        expect(plan).toContain(`SEARCH usage_records USING INDEX idx_usage_${suffix} (${range})`);
        expect(plan).toContain(
          `SEARCH usage_evidence USING INDEX idx_evidence_${suffix} (${range})`,
        );
        expect(plan).not.toMatch(/SCAN usage_records|SCAN usage_evidence|usage_details|SEARCH d /);
      },
    );
  });
});
