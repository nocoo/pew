import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import worker, { type Env } from "../../packages/worker/src/index";
import { handleUsageRpc } from "../../packages/worker-read/src/rpc/usage";
import type { EvidenceRecord } from "@pew/core";

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
    db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users VALUES ('synthetic-user');
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
});
