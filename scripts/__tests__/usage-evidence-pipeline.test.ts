import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import worker, { type Env } from "../../packages/worker/src/index";
import { handleUsageRpc } from "../../packages/worker-read/src/rpc/usage";
import type { EvidenceRecord } from "@pew/core";
import { collectHermesUsageEvidence } from "../../packages/cli/src/parsers/hermes-usage-evidence";
import { toEvidenceRecord } from "../../packages/cli/src/utils/usage-evidence";

const record: EvidenceRecord = {
  source: "pi", model: "test-model", device_id: "test-device",
  timestamp: "2026-09-06T16:00:01.000Z", hour_start: "2026-09-06T16:00:00.000Z",
  input_tokens: 100, cached_input_tokens: 0, output_tokens: 20, reasoning_output_tokens: 0, total_tokens: 120,
  evidence: {
    eventId: "a".repeat(64), groupId: "b".repeat(64), callType: "compaction", origin: "pi-session",
    provider: "google", granularity: "operation", timePrecision: "exact",
    intervalStart: null, intervalEnd: null, callCount: null, snapshotSeq: 1,
  },
};

describe("evidence ingest and additive migration", () => {
  let db: DatabaseSync;
  let env: Env;
  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec(`PRAGMA foreign_keys = ON;
      CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users VALUES ('synthetic-user');
      CREATE TABLE usage_records (
        id INTEGER PRIMARY KEY, user_id TEXT, device_id TEXT DEFAULT 'default', source TEXT, model TEXT, hour_start TEXT,
        input_tokens INTEGER, cached_input_tokens INTEGER, output_tokens INTEGER, reasoning_output_tokens INTEGER,
        total_tokens INTEGER, created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id,device_id,source,model,hour_start));`);
    const migration = resolve("scripts/migrations/022-usage-evidence.sql");
    if (existsSync(migration)) db.exec(readFileSync(migration, "utf8"));
    const prepare = (sql: string) => {
      const stmt = db.prepare(sql);
      return { bind: (...args: unknown[]) => ({
        run: () => stmt.run(...args as never[]),
        all: async () => ({ results: stmt.all(...args as never[]) }),
      }) };
    };
    env = { DB: { prepare, batch: async (stmts: Array<{ run(): unknown }>) => stmts.map((s) => s.run()) } as unknown as Env["DB"],
      WORKER_SECRET: "synthetic-test-secret" };
  });
  afterEach(() => { db.close(); vi.restoreAllMocks(); });
  const ingest = (records: unknown[], path = "/ingest/evidence") => worker.fetch(new Request(`https://synthetic.invalid${path}`, {
    method: "POST", headers: { Authorization: "Bearer synthetic-test-secret", "Content-Type": "application/json" },
    body: JSON.stringify({ userId: "synthetic-user", records }),
  }), env);

  it("deduplicates event snapshots while preserving the original legacy UPSERT contract", async () => {
    const { timestamp: _timestamp, evidence: _evidence, ...main } = record;
    expect((await ingest([main], "/ingest")).status).toBe(200);
    expect((await ingest([record])).status).toBe(200);
    expect((await ingest([record])).status).toBe(200);
    expect(db.prepare("SELECT SUM(total_tokens) AS total FROM usage_totals").get()).toMatchObject({ total: 240 });
    expect(db.prepare("SELECT total_tokens FROM usage_records").get()).toMatchObject({ total_tokens: 120 });
    // A replay by an older client can only overwrite the original main row.
    await ingest([{ ...main, input_tokens: 50, total_tokens: 70 }], "/ingest");
    expect(db.prepare("SELECT SUM(total_tokens) AS total FROM usage_totals").get()).toMatchObject({ total: 190 });
  });

  it("rejects stale snapshot overwrite and prevents a replay from moving the time bucket", async () => {
    const newer = { ...record, input_tokens: 200, total_tokens: 220, evidence: { ...record.evidence, snapshotSeq: 2 } };
    expect((await ingest([newer])).status).toBe(200);
    await ingest([record]);
    const moved = { ...newer, timestamp: "2026-09-07T16:00:01.000Z", hour_start: "2026-09-07T16:00:00.000Z",
      evidence: { ...newer.evidence, snapshotSeq: 3 } };
    await ingest([moved]);
    expect(db.prepare("SELECT hour_start,total_tokens FROM usage_evidence").all()).toEqual([
      { hour_start: record.hour_start, total_tokens: 220 },
    ]);
  });

  it("rejects arbitrary private fields and never echoes their values", async () => {
    for (const bad of [
      { ...record, prompt: "PRIVATE_FIXTURE_BODY" },
      { ...record, evidence: { ...record.evidence, response: "PRIVATE_FIXTURE_BODY" } },
      { ...record, evidence: { ...record.evidence, provider: "Bearer PRIVATE_FIXTURE_BODY" } },
      { ...record, total_tokens: 999 },
    ]) {
      const result = await ingest([bad]);
      expect(result.status).toBe(400);
      expect(await result.text()).not.toContain("PRIVATE_FIXTURE_BODY");
    }
  });

  it("makes evidence visible through existing UTC and local-day usage RPC aggregation", async () => {
    await ingest([record]);
    const response = await handleUsageRpc({ method: "usage.get", userId: "synthetic-user",
      fromDate: "2026-09-06T00:00:00.000Z", toDate: "2026-09-08T00:00:00.000Z", granularity: "day", tzOffset: -480 }, env.DB);
    expect(await response.json()).toMatchObject({ result: [{ hour_start: "2026-09-07", total_tokens: 120 }] });
  });

  it("keeps Hermes main totals unchanged while offline auxiliary snapshots converge without rebucketing history", async () => {
    const { timestamp: _timestamp, evidence: _evidence, ...legacy } = record;
    await ingest([{ ...legacy, source: "hermes" }], "/ingest");
    const row = { session_id: "synthetic-session", model: "test-model", billing_provider: "openai", route_key: "c".repeat(64), task: "approval",
      input_tokens: 100, output_tokens: 10, cache_read_tokens: 0, cache_write_tokens: 0, reasoning_tokens: 0, api_call_count: 1,
      first_seen: Date.parse("2026-09-06T15:58:00Z") / 1000, last_seen: Date.parse("2026-09-06T15:58:00Z") / 1000,
      started_at: Date.parse("2026-09-05T00:00:00Z") / 1000, source: "acp" };
    const first = collectHermesUsageEvidence({ dbKey: "default", rows: [row], calls: [], previous: [] }).map((d) => toEvidenceRecord(d, "test-device"));
    const grown = { ...row, input_tokens: 150, output_tokens: 15, api_call_count: 2, last_seen: Date.parse("2026-09-06T16:02:00Z") / 1000 };
    const update = collectHermesUsageEvidence({ dbKey: "default", rows: [grown], calls: [], previous: first }).map((d) => toEvidenceRecord(d, "test-device"));
    for (const batch of [update, first, update]) expect((await ingest(batch)).status).toBe(200);
    expect(db.prepare("SELECT total_tokens FROM usage_records").get()).toMatchObject({ total_tokens: 120 });
    expect(db.prepare("SELECT hour_start,SUM(total_tokens) AS total FROM usage_evidence GROUP BY hour_start ORDER BY hour_start").all()).toEqual([
      { hour_start: "2026-09-05T00:00:00.000Z", total: 110 },
      { hour_start: "2026-09-06T16:00:00.000Z", total: 55 },
    ]);
    const response = await handleUsageRpc({ method: "usage.get", userId: "synthetic-user",
      fromDate: "2026-09-05T00:00:00.000Z", toDate: "2026-09-08T00:00:00.000Z", granularity: "day", tzOffset: -480 }, env.DB);
    expect(await response.json()).toMatchObject({ result: [
      { hour_start: "2026-09-05", total_tokens: 110, evidence_tokens: 110, approximate_tokens: 110 },
      { hour_start: "2026-09-07", total_tokens: 175, evidence_tokens: 55, approximate_tokens: 55 },
    ] });
  });

  it("removes supplementary accounting when the owning account is deleted", async () => {
    await ingest([record]);
    db.prepare("DELETE FROM users WHERE id = ?").run("synthetic-user");
    expect(db.prepare("SELECT COUNT(*) AS n FROM usage_evidence").get()).toMatchObject({ n: 0 });
  });
});
