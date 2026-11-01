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
  for (const file of ["001-init.sql", "009-device-aliases.sql", "022-usage-evidence.sql", "026-usage-accounting.sql", "030-device-revocations.sql"]) {
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
  it("keeps historical retired sessions unchanged when active records reuse their key", async () => {
    sqlite.exec(`INSERT INTO session_records
      (user_id, session_key, source, kind, started_at, last_message_at, snapshot_at, duration_seconds,
       user_messages, assistant_messages, total_messages)
      VALUES ('u', 'shared-key', 'zcode', 'human', '2026-09-01T00:00:00.000Z', '2026-09-01T00:01:00.000Z',
        '2026-09-01T00:01:00.000Z', 60, 1, 1, 2)`);
    const original = sqlite.prepare("SELECT * FROM session_records WHERE session_key = 'shared-key'").get();
    const active = { session_key: "shared-key", source: "codex", kind: "human", started_at: record.hour_start,
      last_message_at: "2026-09-01T00:02:00.000Z", snapshot_at: "2026-09-01T00:02:00.000Z", duration_seconds: 120,
      user_messages: 9, assistant_messages: 9, total_messages: 18, project_ref: null, model: "test" };
    expect((await ingest("sessions", [active])).status).toBe(200);
    expect(sqlite.prepare("SELECT * FROM session_records WHERE session_key = 'shared-key'").get()).toEqual(original);
    expect((await ingest("sessions", [{ ...active, source: "zcode" }])).status).toBe(200);
    expect(sqlite.prepare("SELECT * FROM session_records WHERE session_key = 'shared-key'").get()).toEqual(original);
  });

  it("applies revocation only to explicitly device-tagged legacy token records", async () => {
    sqlite.exec("INSERT INTO device_revocations(user_id, device_id) VALUES ('u', 'default')");

    const untagged = await ingest("tokens", [record]);
    expect(untagged.status).toBe(200);
    expect(await untagged.json()).toEqual({ ingested: 1 });
    expect(sqlite.prepare("SELECT total_tokens FROM usage_records WHERE device_id='default'").get()?.total_tokens).toBe(record.total_tokens);

    const explicitlyDefault = await ingest("tokens", [{ ...record, device_id: "default", model: "explicit-default" }]);
    expect(explicitlyDefault.status).toBe(200);
    expect(await explicitlyDefault.json()).toEqual({ ingested: 1 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM usage_records WHERE device_id='default' AND model='explicit-default'").get()?.n).toBe(0);
  });

  it("ignores revoked token, evidence and accounting mixed batches while sessions remain active", async () => {
    sqlite.exec("INSERT INTO device_revocations(user_id, device_id) VALUES ('u', 'revoked-device')");

    const tokenMixed = await ingest("tokens", [
      { ...record, device_id: "revoked-device" },
      { ...record, device_id: "active-device" },
    ]);
    expect(tokenMixed.status).toBe(200);
    expect(await tokenMixed.json()).toEqual({ ingested: 2 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM usage_records WHERE device_id='revoked-device'").get()?.n).toBe(0);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM usage_records WHERE device_id='active-device'").get()?.n).toBe(1);

    const evidence = { ...record, source: "pi", device_id: "revoked-device", timestamp: record.hour_start,
      evidence: { eventId: "a".repeat(64), groupId: "b".repeat(64), callType: "compaction", origin: "pi-session",
        provider: "test", granularity: "call", timePrecision: "exact", intervalStart: null, intervalEnd: null,
        callCount: 1, snapshotSeq: 1 } };
    const evidenceMixed = await ingest("evidence", [evidence, { ...evidence, device_id: "active-device", evidence: { ...evidence.evidence, eventId: "c".repeat(64), groupId: "d".repeat(64) } }]);
    expect(evidenceMixed.status).toBe(200);
    expect(await evidenceMixed.json()).toEqual({ ingested: 2 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM usage_evidence WHERE device_id='revoked-device'").get()?.n).toBe(0);

    sqlite.exec("INSERT INTO usage_records(user_id,device_id,source,model,hour_start,input_tokens,cached_input_tokens,output_tokens,reasoning_output_tokens,total_tokens) VALUES ('u','revoked-device','codex','test','2026-09-01T00:00:00.000Z',1,0,0,0,1)");
    const accounting = accountingFixture();
    const detailsMixed = await ingest("details", [
      { ...accounting, device_id: "revoked-device" },
      { ...accounting, device_id: "active-device" },
    ]);
    expect(detailsMixed.status).toBe(200);
    const detailsBody = await detailsMixed.json() as { acknowledgments: Array<{ status: string }> };
    expect(detailsBody.acknowledgments.map((ack) => ack.status)).toEqual(["superseded", "base_mismatch"]);

    const session = { session_key: "revoked-session", source: "codex", kind: "human", started_at: record.hour_start,
      last_message_at: record.hour_start, snapshot_at: record.hour_start, duration_seconds: 60,
      user_messages: 1, assistant_messages: 1, total_messages: 2, project_ref: null, model: null };
    expect((await ingest("sessions", [session])).status).toBe(200);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM session_records").get()?.n).toBe(1);
  });

  it("re-registers a deleted device on repeated evidence and accounting-only sync without restoring its alias", async () => {
    const event = { ...record, source: "pi", device_id: "evidence-device", timestamp: record.hour_start,
      evidence: { eventId: "e".repeat(64), groupId: "f".repeat(64), callType: "compaction", origin: "pi-session",
        provider: "test", granularity: "call", timePrecision: "exact", intervalStart: null, intervalEnd: null,
        callCount: 1, snapshotSeq: 1 } };
    expect((await ingest("evidence", [event])).status).toBe(200);
    sqlite.exec("INSERT INTO device_aliases(user_id,device_id,alias) VALUES ('u','evidence-device','Old alias')");
    sqlite.exec("DELETE FROM device_records WHERE user_id='u' AND device_id='evidence-device'");
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM device_aliases WHERE device_id='evidence-device'").get()?.n).toBe(0);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM device_records WHERE device_id='evidence-device'").get()?.n).toBe(0);
    expect((await ingest("evidence", [event])).status).toBe(200);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM device_records WHERE device_id='evidence-device'").get()?.n).toBe(1);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM device_aliases WHERE device_id='evidence-device'").get()?.n).toBe(0);

    const accounting = accountingFixture();
    sqlite.prepare(`INSERT INTO usage_records
      (user_id,device_id,source,model,hour_start,input_tokens,cached_input_tokens,output_tokens,reasoning_output_tokens,total_tokens)
      VALUES ('u',?,?,?,?,?,?,?,?,?)`).run(accounting.device_id, accounting.source, accounting.model, accounting.hour_start,
      accounting.basis.input_tokens, accounting.basis.cached_input_tokens, accounting.basis.output_tokens,
      accounting.basis.reasoning_output_tokens, accounting.basis.total_tokens);
    sqlite.exec(`INSERT INTO device_aliases(user_id,device_id,alias) VALUES ('u','${accounting.device_id}','Accounting alias')`);
    sqlite.exec(`DELETE FROM device_records WHERE user_id='u' AND device_id='${accounting.device_id}'`);
    const accountingSync = await ingest("details", [accounting]);
    expect(accountingSync.status).toBe(200);
    expect((await accountingSync.json() as { acknowledgments: Array<{ status: string }> }).acknowledgments[0]?.status).toBe("applied");
    sqlite.exec(`DELETE FROM device_records WHERE user_id='u' AND device_id='${accounting.device_id}'`);
    const repeatedAccounting = await ingest("details", [accounting]);
    expect(repeatedAccounting.status).toBe(200);
    expect((await repeatedAccounting.json() as { acknowledgments: Array<{ status: string }> }).acknowledgments[0]?.status).toBe("duplicate");
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM device_records WHERE device_id=?").get(accounting.device_id)?.n).toBe(1);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM device_aliases WHERE device_id=?").get(accounting.device_id)?.n).toBe(0);
  });

  it("does not register zero-token evidence checkpoints through their accounting details", async () => {
    const event = { ...record, source: "pi", device_id: "zero-checkpoint", timestamp: record.hour_start,
      input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 0,
      evidence: { eventId: "6".repeat(64), groupId: "5".repeat(64), callType: "compaction", origin: "pi-session",
        provider: "test", granularity: "call", timePrecision: "exact", intervalStart: null, intervalEnd: null,
        callCount: 0, snapshotSeq: 1 } };
    expect((await ingest("evidence", [event])).status).toBe(200);
    sqlite.prepare(`INSERT INTO usage_details
      (user_id,device_id,source,model,hour_start,event_id,evidence_snapshot_seq,details_version,source_revision,
       parser_revision,detail_revision,input_tokens,cached_input_tokens,output_tokens,reasoning_output_tokens,total_tokens,groups_json)
      VALUES ('u',?,?,?,?,?,1,1,1,1,1,0,0,0,0,0,'[]')`).run(
      event.device_id, event.source, event.model, event.hour_start, event.evidence.eventId,
    );
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM device_records WHERE device_id='zero-checkpoint'").get()?.n).toBe(0);
  });

  it("preserves evidence on stale, duplicate and immutable-identity conflict uploads", async () => {
    const event = { ...record, source: "pi", device_id: "immutable-evidence-device", timestamp: record.hour_start,
      evidence: { eventId: "9".repeat(64), groupId: "8".repeat(64), callType: "compaction", origin: "pi-session",
        provider: "test", granularity: "call", timePrecision: "exact", intervalStart: null, intervalEnd: null,
        callCount: 1, snapshotSeq: 2 } };
    expect((await ingest("evidence", [event])).status).toBe(200);
    const stale = { ...event, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0,
      total_tokens: 0, evidence: { ...event.evidence, snapshotSeq: 1, intervalEnd: "2026-09-01T10:01:00.000Z" } };
    const duplicate = { ...stale, evidence: { ...stale.evidence, snapshotSeq: 2 } };
    const identityConflict = { ...event, evidence: { ...event.evidence, groupId: "7".repeat(64), snapshotSeq: 3 } };
    for (const candidate of [stale, duplicate, identityConflict]) expect((await ingest("evidence", [candidate])).status).toBe(200);
    expect(sqlite.prepare(`SELECT snapshot_seq, group_id, input_tokens, total_tokens, interval_end
      FROM usage_evidence WHERE device_id='immutable-evidence-device'`).get()).toEqual({
      snapshot_seq: 2, group_id: event.evidence.groupId, input_tokens: event.input_tokens,
      total_tokens: event.total_tokens, interval_end: null,
    });
  });

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
