import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import worker, { type Env } from "../../packages/worker/src/index";
import { handleUsageRpc } from "../../packages/worker-read/src/rpc/usage";
import { accountingFixture } from "../../packages/core/src/__test-helpers__/accounting";
import { AccountingQueue } from "../../packages/cli/src/storage/accounting-queue";
import { executeUpload } from "../../packages/cli/src/commands/upload";
import type { AccountingRecord } from "@pew/core";

describe("accounting annotations through native transaction-shaped SQLite batches", () => {
  let db: DatabaseSync; let env: Env;
  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec(`PRAGMA foreign_keys = ON; CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES ('test-user');
      CREATE TABLE usage_records (user_id TEXT, device_id TEXT, source TEXT, model TEXT, hour_start TEXT,
      input_tokens INTEGER, cached_input_tokens INTEGER, output_tokens INTEGER, reasoning_output_tokens INTEGER, total_tokens INTEGER,
      created_at TEXT DEFAULT (datetime('now')), UNIQUE(user_id,device_id,source,model,hour_start));`);
    db.exec(readFileSync("scripts/migrations/022-usage-evidence.sql", "utf8"));
    db.exec(readFileSync("scripts/migrations/026-usage-accounting.sql", "utf8"));
    const prepare = (sql: string) => {
      const stmt = db.prepare(sql);
      return { bind: (...args: unknown[]) => ({
        run: () => ({ results: stmt.all(...args as never[]), success: true }),
        all: async () => ({ results: stmt.all(...args as never[]) }),
      }) };
    };
    env = { DB: { prepare, batch: async (statements: Array<{ run(): unknown }>) => {
      db.exec("BEGIN"); try { const results = statements.map((s) => s.run()); db.exec("COMMIT"); return results; }
      catch (err) { db.exec("ROLLBACK"); throw err; }
    } } as unknown as Env["DB"], WORKER_SECRET: "test-secret" };
  });
  afterEach(() => db.close());
  const send = (records: unknown[], path = "/ingest/details") => worker.fetch(new Request(`https://test.invalid${path}`, {
    method: "POST", headers: { Authorization: "Bearer test-secret" }, body: JSON.stringify({ userId: "test-user", records }),
  }), env);
  async function seed() {
    const r = accountingFixture();
    await send([{ source: r.source, model: r.model, hour_start: r.hour_start, device_id: r.device_id, ...r.basis }], "/ingest");
    return r;
  }
  const status = async (r: unknown) => (await (await send([r])).json() as { acknowledgments: Array<{ status: string }> }).acknowledgments[0].status;

  it("annotates an exact bucket once; a duplicate never adds usage", async () => {
    const r = await seed(); expect(await status(r)).toBe("applied"); expect(await status(r)).toBe("duplicate");
    expect(db.prepare("SELECT total_tokens FROM usage_totals").get()).toMatchObject({ total_tokens: 940 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM usage_details").get()).toMatchObject({ n: 1 });
  });

  it("round-trips 25 mixed legacy/evidence companions through the CLI and native SQL receipts", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "pew-native-accounting-"));
    try {
      const records: AccountingRecord[] = [];
      for (let i = 0; i < 25; i++) {
        const r = { ...accountingFixture(), source: "pi", hour_start: new Date(Date.parse("2026-09-01T00:00:00.000Z") + i * 1_800_000).toISOString(),
          event_id: i % 2 ? i.toString(16).padStart(64, "0") : null, evidence_snapshot_seq: i % 2 ? 1 : null } as AccountingRecord;
        const base = { source: r.source, model: r.model, device_id: r.device_id, hour_start: r.hour_start, ...r.basis };
        const response = r.event_id ? await send([{ ...base, timestamp: r.hour_start, evidence: {
          eventId: r.event_id, groupId: "b".repeat(64), callType: "compaction", origin: "pi-session", provider: "openai",
          granularity: "operation", timePrecision: "exact", intervalStart: null, intervalEnd: null, callCount: 1, snapshotSeq: 1,
        } }], "/ingest/evidence") : await send([base], "/ingest");
        expect(response.status).toBe(200);
        records.push(r);
      }
      await writeFile(join(stateDir, "config.json"), JSON.stringify({ token: "pk_synthetic" }));
      const queue = new AccountingQueue(stateDir); await queue.merge(records);
      let calls = 0;
      const upload = () => executeUpload({ stateDir, apiUrl: "https://test.invalid", maxRetries: 0, fetch: async (url, init) => {
        calls++;
        expect(String(url)).toBe("https://test.invalid/api/ingest/details");
        return send(JSON.parse(String(init?.body)));
      } });
      expect((await upload()).uploaded).toBe(25);
      expect(await queue.loadDirtyKeys()).toEqual([]);
      expect(calls).toBe(1);
      expect(db.prepare("SELECT SUM(total_tokens) AS n FROM usage_totals").get()).toMatchObject({ n: 25 * 940 });
      await queue.merge(records, true);
      expect((await upload()).uploaded).toBe(25);
      expect(await queue.loadDirtyKeys()).toEqual([]);
      expect(db.prepare("SELECT COUNT(*) AS n FROM usage_details").get()).toMatchObject({ n: 25 });
      const evidence = records.find((r) => r.event_id);
      expect(await status({ ...evidence, evidence_snapshot_seq: 2 })).toBe("base_mismatch");
    } finally { await rm(stateDir, { recursive: true, force: true }); }
  });

  it("orders parser/detail revisions independently of source totals", async () => {
    const r = await seed(); await send([r]);
    const next = { ...r, detail_revision: 2, groups: [{ ...r.groups[0], counts: { ...r.groups[0].counts, cache_write_input_tokens: 80 } }] };
    expect(await status(next)).toBe("applied"); expect(await status(r)).toBe("superseded");
    expect(await status({ ...next, groups: r.groups })).toBe("conflict");
  });

  it("keeps old annotations pending when an old client replaces the legacy bucket", async () => {
    const r = await seed(); await send([r]);
    await send([{ source: r.source, model: r.model, hour_start: r.hour_start, device_id: r.device_id, ...r.basis, input_tokens: 101, total_tokens: 941 }], "/ingest");
    expect(await status(r)).toBe("base_mismatch");
    const response = await handleUsageRpc({ method: "usage.get", userId: "test-user", fromDate: "2026-09-01T00:00:00.000Z", toDate: "2026-09-02T00:00:00.000Z" }, env.DB);
    expect(await response.json()).toMatchObject({ result: [{ total_tokens: 941, accounting: [{ status: "pending", groups: [] }] }] });
  });

  it("preserves billing group boundaries through day aggregation and hides reported costs by default", async () => {
    const r = await seed();
    const costs = [{ units: "12345678901234567890", scale: 10, currency: "USD", kind: "actual", status: "complete", source: "grok" }];
    await send([{ ...r, groups: [{ ...r.groups[0], reported_costs: costs }] }]);
    const req = { method: "usage.get" as const, userId: "test-user", fromDate: "2026-09-01T00:00:00.000Z", toDate: "2026-09-02T00:00:00.000Z", granularity: "day" as const, tzOffset: -480 };
    const publicBody = await (await handleUsageRpc(req, env.DB)).json();
    expect(publicBody).toMatchObject({ result: [{ accounting: [{ status: "matched", groups: [{ reported_costs: [], counts: { cache_write_input_tokens: 90 } }] }] }] });
    const privateBody = await (await handleUsageRpc({ ...req, includeReportedCosts: true }, env.DB)).json();
    expect(privateBody).toMatchObject({ result: [{ accounting: [{ groups: [{ reported_costs: costs }] }] }] });
  });

  it("carries private-cost-free annotations through all device queries without changing base counters", async () => {
    db.exec("CREATE TABLE device_aliases(user_id TEXT, device_id TEXT, alias TEXT)");
    const r = await seed();
    const costs = [{ units: "9000000000", scale: 10, currency: "USD", kind: "actual", status: "complete", source: "grok" }];
    await send([{ ...r, groups: [{ ...r.groups[0], reported_costs: costs }] }]);
    for (const method of ["usage.getDeviceSummary", "usage.getDeviceCostDetails", "usage.getDeviceTimeline"] as const) {
      const response = await handleUsageRpc({ method, userId: "test-user", fromDate: r.hour_start, toDate: "2026-09-02T00:00:00.000Z" }, env.DB);
      expect(await response.json()).toMatchObject({ result: [{ device_id: r.device_id, input_tokens: 100, cached_input_tokens: 800,
        accounting: [{ status: "matched", basis: r.basis, groups: [{ reported_costs: [], counts: { cache_write_input_tokens: 90 } }] }] }] });
    }
  });

  it("isolates devices and rejects unsupported schema without touching legacy records", async () => {
    const r = await seed();
    expect(await status({ ...r, device_id: "other" })).toBe("base_mismatch");
    expect((await send([{ ...r, details_version: 2 }])).status).toBe(400);
    expect(db.prepare("SELECT total_tokens FROM usage_totals").get()).toMatchObject({ total_tokens: 940 });
  });

  it("deletes accounting on account deletion when FK enforcement is enabled", async () => {
    const r = await seed(); await send([r]); db.exec("DELETE FROM users");
    expect(db.prepare("SELECT COUNT(*) AS n FROM usage_details").get()).toMatchObject({ n: 0 });
  });
});
