import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EvidenceRecord } from "@pew/core";
import type { AuxiliaryUsageRow } from "../parsers/hermes-sqlite.js";
import { collectHermesUsageEvidence } from "../parsers/hermes-usage-evidence.js";
import { createHermesSqliteTokenDriver } from "../drivers/token/hermes-token-driver.js";
import { EvidenceQueue } from "../storage/evidence-queue.js";
import { toEvidenceRecord } from "../utils/usage-evidence.js";

const seconds = (time: string) => Date.parse(time) / 1000;
const row: AuxiliaryUsageRow = {
  session_id: "synthetic-acp-session", model: "aux-model", billing_provider: "openai", route_key: "a".repeat(64),
  task: "approval", input_tokens: 100, output_tokens: 10, cache_read_tokens: 20, cache_write_tokens: 5,
  reasoning_tokens: 2, api_call_count: 1, started_at: seconds("2026-09-05T12:00:00Z"),
  first_seen: seconds("2026-09-06T15:59:00Z"), last_seen: seconds("2026-09-06T15:59:00Z"), source: "cli",
};
const collect = (rows: AuxiliaryUsageRow[], previous: EvidenceRecord[] = []) =>
  collectHermesUsageEvidence({ dbKey: "default", rows, calls: [], previous }).map((d) => toEvidenceRecord(d, "test-device"));
const total = (records: EvidenceRecord[]) => records.reduce((n, r) => n + r.total_tokens, 0);

describe("Hermes auxiliary and ACP ledger accounting", () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "pew-hermes-aux-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("captures each proven auxiliary task without treating a ledger write as an exact call time", () => {
    const tasks = ["approval", "compression", "title_generation", "vision"];
    const records = collect(tasks.map((task) => ({ ...row, task })));
    expect(total(records)).toBe(4 * 137);
    expect(records.map((r) => r.evidence.callType)).toEqual(tasks);
    expect(new Set(records.map((r) => r.evidence.eventId)).size).toBe(4);
    expect(records.every((r) => r.evidence.timePrecision === "session-start" && r.evidence.granularity === "session")).toBe(true);
    expect(records.every((r) => r.timestamp === "2026-09-05T12:00:00.000Z")).toBe(true);
  });

  it("adds only ACP auxiliary rows; the main ACP cumulative ledger remains counted once", async () => {
    const dbPath = join(dir, "state.db");
    await writeFile(dbPath, "synthetic database via DI");
    const main = { id: row.session_id, model: "main-model", input_tokens: 1000, output_tokens: 100,
      cache_read_tokens: 0, cache_write_tokens: 0, reasoning_tokens: 0, started_at: row.started_at as number };
    const driver = createHermesSqliteTokenDriver({ dbPath, dbKey: "default", openHermesDb: () => ({
      querySessions: () => [main], queryAuxiliaryUsage: () => [{ ...row, source: "acp" }, { ...row, source: "acp", task: "" }], close() {},
    }) });
    const result = await driver.run(undefined, {});
    expect(result.deltas.filter((d) => !d.evidence)).toMatchObject([{ tokens: { inputTokens: 1000, outputTokens: 100 } }]);
    const extra = result.deltas.filter((d) => d.evidence).map((d) => toEvidenceRecord(d, "test-device"));
    expect(total(extra)).toBe(137);
    expect(extra[0].evidence.origin).toBe("hermes-acp-ledger");
  });

  it("projects unknown tasks and private labels without forwarding arbitrary source text", () => {
    const records = collect([{ ...row, task: "PRIVATE_FIXTURE_BODY", model: "Bearer PRIVATE_FIXTURE_BODY", billing_provider: "https://private.invalid" }]);
    expect(records).toMatchObject([{ model: "unknown", evidence: { callType: "auxiliary", provider: "unknown" } }]);
    expect(total(records)).toBe(137);
    expect(JSON.stringify(records)).not.toMatch(/PRIVATE_FIXTURE_BODY|private\.invalid|synthetic-acp-session/);
    expect(collect([{ ...row, task: "" }, { ...row, task: "   " }, { ...row, input_tokens: -1 }])).toEqual([]);
  });

  it("uses stable source snapshot intervals for later increments and survives offline replay and cursor reset", async () => {
    const queue = new EvidenceQueue(dir);
    await queue.merge(collect([row]));
    const first = (await queue.readFromOffset(0)).records;
    const grown = { ...row, input_tokens: 150, output_tokens: 15, api_call_count: 2, last_seen: seconds("2026-09-06T16:02:00Z") };
    const update = collect([grown], first);
    const interval = update.find((r) => r.evidence.timePrecision === "interval");
    expect(interval).toMatchObject({ total_tokens: 55, hour_start: "2026-09-06T16:00:00.000Z", evidence: {
      origin: "hermes-aux-ledger", granularity: "session", callCount: 1,
      intervalStart: "2026-09-06T15:59:00.000Z", intervalEnd: "2026-09-06T16:02:00.000Z",
    } });
    await queue.merge(update);
    await queue.merge(update); // interrupted/offline delivery replays absolute records
    await queue.merge(collect([row])); // delayed older baseline cannot win
    const latest = (await queue.readFromOffset(0)).records;
    expect(total(latest)).toBe(192);
    expect(latest.find((r) => r.evidence.eventId === first[0].evidence.eventId)?.total_tokens).toBe(137);
    expect(collect([grown], latest)).toEqual([]); // parsing cursor does not own evidence
    expect(collect([row], latest)).toEqual([]);
    expect(collect([grown], first)).toEqual(update); // wall clock cannot rebucket a retry
  });

  it("does not lose growing counters when the source write clock stalls or moves backwards", () => {
    const first = collect([row]);
    for (const last_seen of [row.last_seen, (row.last_seen as number) - 60]) {
      const update = collect([{ ...row, input_tokens: 150, api_call_count: 2, last_seen }], first);
      const latest = [...new Map([...first, ...update].map((r) => [r.evidence.eventId, r])).values()];
      expect(total(latest)).toBe(187);
      expect(update.every((r) => r.evidence.timePrecision === "session-start")).toBe(true);
      expect(latest[0].timestamp).toBe(first[0].timestamp);
      expect(collect([row], latest)).toEqual([]);
    }
  });

  it("keeps missing source times and call counts unknown while preserving cumulative tokens", () => {
    const unknown = { ...row, started_at: null, first_seen: null, last_seen: null, api_call_count: null };
    const first = collect([unknown]);
    expect(first).toMatchObject([{ total_tokens: 137, timestamp: "1970-01-01T00:00:00.000Z",
      evidence: { timePrecision: "unattributed", callCount: null } }]);
    const update = collect([{ ...unknown, input_tokens: 150 }], first);
    expect(update).toMatchObject([{ total_tokens: 187, evidence: { timePrecision: "unattributed", callCount: null } }]);
    expect(collect([unknown], update)).toEqual([]);
  });

  it("rejects counter rollback despite a greater aggregate revision and rejects unsafe totals", () => {
    const first = collect([row]);
    expect(collect([{ ...row, input_tokens: 300, output_tokens: 9 }], first)).toEqual([]);
    expect(collect([{ ...row, input_tokens: 300, api_call_count: 0 }], first)).toEqual([]);
    expect(collect([{ ...row, input_tokens: Number.MAX_SAFE_INTEGER }])).toEqual([]);
  });

  it("does not turn invalid source bounds into an exact or reversed interval", () => {
    const records = collect([{ ...row, last_seen: (row.started_at as number) - 1 }]);
    expect(records).toMatchObject([{ total_tokens: 137, evidence: { timePrecision: "session-start", intervalEnd: null } }]);
    const withoutEnd = collect([{ ...row, last_seen: null }]);
    expect(collect([{ ...row, input_tokens: 200 }], withoutEnd)).toMatchObject([
      { total_tokens: 237, evidence: { timePrecision: "session-start" } },
    ]);
  });
});
