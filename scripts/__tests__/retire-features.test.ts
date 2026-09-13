import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleSessionsRpc } from "../../packages/worker-read/src/rpc/sessions";

const migration = (name: string) => readFileSync(resolve("scripts/migrations", name), "utf8");

describe("retired feature migration", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    for (const name of ["001-init.sql", "016-showcases.sql", "022-usage-evidence.sql"]) {
      db.exec(migration(name));
    }
    db.exec(`
      INSERT INTO users (id, email) VALUES ('u1', 'one@example.test'), ('u2', 'two@example.test');
      INSERT INTO usage_records (user_id, source, model, hour_start, input_tokens, output_tokens, total_tokens)
        VALUES ('u1', 'claude-code', 'test-model', '2026-09-13T10:00:00Z', 10, 2, 12);
      INSERT INTO usage_evidence (user_id, device_id, event_id, group_id, source, model, hour_start,
        timestamp, call_type, origin, provider, granularity, time_precision, snapshot_seq,
        input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens, total_tokens)
        VALUES ('u1', 'default', 'event', 'group', 'claude-code', 'test-model', '2026-09-13T10:00:00Z',
          '2026-09-13T10:01:00Z', 'compaction', 'test', 'anthropic', 'operation', 'exact', 1, 2, 0, 1, 0, 3);
      INSERT INTO projects (id, user_id, name) VALUES ('p1', 'u1', 'Retired project');
      INSERT INTO project_aliases (user_id, project_id, source, project_ref)
        VALUES ('u1', 'p1', 'claude-code', 'abc123');
      INSERT INTO project_tags (user_id, project_id, tag) VALUES ('u1', 'p1', 'test');
      INSERT INTO showcases (id, user_id, repo_key, github_url, title)
        VALUES ('s1', 'u1', 'test/repo', 'https://github.com/test/repo', 'Retired showcase');
      INSERT INTO showcase_upvotes (showcase_id, user_id) VALUES ('s1', 'u2');
    `);
    const insert = db.prepare(`INSERT INTO session_records
      (user_id, session_key, source, kind, started_at, last_message_at, duration_seconds,
        user_messages, assistant_messages, total_messages, project_ref, model, snapshot_at)
      VALUES (?, ?, ?, ?, ?, ?, 600, 2, 3, 5, ?, 'test-model', ?)`);
    for (const [key, userId, source, kind, time, projectRef] of [
      ["start", "u1", "claude-code", "human", "2026-09-13T00:00:00Z", "abc123"],
      ["latest", "u1", "claude-code", "human", "2026-09-13T10:00:00Z", null],
      ["other-user", "u2", "claude-code", "human", "2026-09-13T10:00:00Z", "abc123"],
      ["other-source", "u1", "codex", "human", "2026-09-13T10:00:00Z", null],
      ["other-kind", "u1", "claude-code", "automated", "2026-09-13T10:00:00Z", null],
      ["before", "u1", "claude-code", "human", "2026-09-12T23:59:59Z", null],
      ["end", "u1", "claude-code", "human", "2026-09-14T00:00:00Z", null],
    ] as const) {
      insert.run(userId, key, source, kind, time, time, projectRef, time);
    }
  });

  afterEach(() => db.close());

  it("drops only the retired tables, is repeatable, and preserves usage and session data", () => {
    const tablesBefore = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all();
    const retained = ["users", "usage_records", "usage_evidence", "usage_totals", "session_records"];
    const rowsBefore = retained.map((table) => db.prepare(`SELECT * FROM ${table}`).all());

    db.exec(migration("023-retire-features.sql"));
    db.exec(migration("023-retire-features.sql"));

    const retired = new Set(["projects", "project_aliases", "project_tags", "showcases", "showcase_upvotes"]);
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all())
      .toEqual(tablesBefore.filter((row) => !retired.has(String(row.name))));
    expect(retained.map((table) => db.prepare(`SELECT * FROM ${table}`).all())).toEqual(rowsBefore);
    expect(db.prepare("SELECT SUM(total_tokens) AS total FROM usage_totals").get()).toEqual({ total: 15 });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("reads scoped sessions without project tables and retains legacy project_ref values", async () => {
    db.exec(migration("023-retire-features.sql"));
    const workerDb = {
      prepare: (sql: string) => ({
        bind: (...params: unknown[]) => ({
          all: async () => ({ results: db.prepare(sql).all(...params as never[]) }),
        }),
      }),
    } as unknown as Parameters<typeof handleSessionsRpc>[1];

    const response = await handleSessionsRpc({
      method: "sessions.getRecords",
      userId: "u1",
      fromDate: "2026-09-13T00:00:00Z",
      toDate: "2026-09-14T00:00:00Z",
      source: "claude-code",
      kind: "human",
    }, workerDb);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: [
      { session_key: "latest", source: "claude-code", kind: "human",
        started_at: "2026-09-13T10:00:00Z", last_message_at: "2026-09-13T10:00:00Z",
        duration_seconds: 600, user_messages: 2, assistant_messages: 3, total_messages: 5,
        project_ref: null, model: "test-model" },
      { session_key: "start", source: "claude-code", kind: "human",
        started_at: "2026-09-13T00:00:00Z", last_message_at: "2026-09-13T00:00:00Z",
        duration_seconds: 600, user_messages: 2, assistant_messages: 3, total_messages: 5,
        project_ref: "abc123", model: "test-model" },
    ] });
  });
});
