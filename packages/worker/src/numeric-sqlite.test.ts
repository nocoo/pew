/// <reference types="bun" />
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import worker, { type Env } from "./index";
import { checkedCountResponse } from "../../worker-read/src/count-response";
import { accountingFixture } from "../../core/src/__test-helpers__/accounting";

let sqlite: DatabaseSync;
let env: Env;
const record = { source: "codex", model: "test", hour_start: "2026-09-01T00:00:00.000Z",
  input_tokens: 1_000_000_000, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 1_000_000_000 };

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  for (const file of ["001-init.sql", "022-usage-evidence.sql", "026-usage-accounting.sql"]) {
    sqlite.exec(readFileSync(`scripts/migrations/${file}`, "utf8"));
  }
  sqlite.exec("INSERT INTO users (id, email) VALUES ('u', 'fixture@example.invalid')");
  env = { WORKER_SECRET: "test", DB: {
    prepare(sql: string) {
      return { bind: (...params: SQLInputValue[]) => ({ sql, params }) };
    },
    async batch(statements: { sql: string; params: SQLInputValue[] }[]) {
      sqlite.exec("BEGIN");
      try {
        const result = statements.map(({ sql, params }) => ({ results: sqlite.prepare(sql).all(...params), success: true }));
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database };
});
afterEach(() => sqlite.close());

function ingest(path: string, records: unknown[]) {
  return worker.fetch(new Request(`https://test.invalid/ingest/${path}`, { method: "POST",
    headers: { Authorization: "Bearer test" }, body: JSON.stringify({ userId: "u", records }) }), env);
}

describe("numeric validation through SQLite integer affinity", () => {
  it("rejects the original 2^62 input before binding; the old input overflows SUM", async () => {
    expect((await ingest("tokens", [{ ...record, total_tokens: 2 ** 62 }])).status).toBe(400);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM usage_records").get()?.n).toBe(0);
    const insert = sqlite.prepare("INSERT INTO usage_records (user_id, source, model, hour_start, total_tokens) VALUES ('u', 'codex', ?, ?, ?)");
    insert.run("a", record.hour_start, 2 ** 62);
    insert.run("b", record.hour_start, 2 ** 62);
    expect(sqlite.prepare("SELECT typeof(total_tokens) AS t FROM usage_records LIMIT 1").get()?.t).toBe("integer");
    expect(() => sqlite.prepare("SELECT SUM(total_tokens) FROM usage_totals").get()).toThrow(/integer overflow/);
    const response = await checkedCountResponse(Promise.resolve().then(() => {
      const value = sqlite.prepare("SELECT SUM(total_tokens) AS total_tokens FROM usage_totals").get();
      return Response.json({ result: value });
    }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal server error" });
  });

  it("stores 50 billion-token rows exactly and retains idempotent upserts", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ ...record, device_id: `device-${i}` }));
    expect((await ingest("tokens", rows)).status).toBe(200);
    expect((await ingest("tokens", rows)).status).toBe(200);
    expect(sqlite.prepare("SELECT SUM(total_tokens) AS total_tokens, typeof(SUM(total_tokens)) AS type FROM usage_totals").get())
      .toEqual({ total_tokens: 50_000_000_000, type: "integer" });
  });

  it("rejects unsafe evidence, detail and session records without writing them", async () => {
    const evidence = { ...record, source: "pi", timestamp: record.hour_start, device_id: "test",
      evidence: { eventId: "a".repeat(64), groupId: "b".repeat(64), callType: "compaction", origin: "pi-session",
        provider: "test", granularity: "call", timePrecision: "exact", intervalStart: null, intervalEnd: null,
        callCount: 1, snapshotSeq: 1 } };
    expect((await ingest("evidence", [{ ...evidence, input_tokens: 2 ** 62, total_tokens: 2 ** 62 }])).status).toBe(400);
    expect((await ingest("evidence", [evidence])).status).toBe(200);
    const details = accountingFixture();
    expect((await ingest("details", [{ ...details, basis: { ...details.basis, total_tokens: 2 ** 62 } }])).status).toBe(400);
    const session = { session_key: "test", source: "codex", kind: "human", started_at: record.hour_start,
      last_message_at: record.hour_start, snapshot_at: record.hour_start, duration_seconds: 2 ** 62,
      user_messages: 1, assistant_messages: 1, total_messages: 2, project_ref: null, model: null };
    expect((await ingest("sessions", [session])).status).toBe(400);
    expect((await ingest("sessions", [{ ...session, duration_seconds: 315_576_000 }])).status).toBe(200);
    expect(sqlite.prepare("SELECT SUM(duration_seconds) AS n FROM session_records").get()?.n).toBe(315_576_000);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM usage_details").get()?.n).toBe(0);
  });

  it("keeps exact SQLite totals when the Number API cannot represent them and fails closed", async () => {
    sqlite.exec("CREATE TABLE aggregate_fixture (total_tokens INTEGER)");
    sqlite.exec("INSERT INTO aggregate_fixture VALUES (9007199254740991), (2)");
    const exact = sqlite.prepare("SELECT CAST(SUM(total_tokens) AS TEXT) AS total_tokens FROM aggregate_fixture").get()?.total_tokens;
    expect(exact).toBe("9007199254740993");
    const response = await checkedCountResponse(Promise.resolve(Response.json({ result: { total_tokens: Number(exact) } })));
    expect(response.status).toBe(500);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM aggregate_fixture").get()?.n).toBe(2);
  });
});
