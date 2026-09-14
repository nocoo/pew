import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountingRecord, QueueRecord } from "@pew/core";
import { AccountingQueue, accountingKey, planAccountingUpdates } from "../storage/accounting-queue.js";
import { inclusiveAccounting } from "../utils/accounting.js";
import { executeSync } from "../commands/sync.js";
import { executeReset } from "../commands/reset.js";
import { CursorStore } from "../storage/cursor-store.js";
import { validateAccountingRecord } from "../../../core/src/accounting.js";
import { invalidAccountingCases } from "../../../core/src/__test-helpers__/accounting.js";

const dirs: string[] = [];
async function temp() { const dir = await mkdtemp(join(tmpdir(), "pew-cache-queue-")); dirs.push(dir); return dir; }
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });
const tokens = { inputTokens: 100, cachedInputTokens: 800, outputTokens: 30, reasoningOutputTokens: 10 };
function group(write = 90) { return inclusiveAccounting(tokens, { input: 900, read: 800, write, output: 40, reasoning: 10 }, { origin: "codex:last_token_usage", model: "test" }); }
function fixture(): AccountingRecord {
  const g = group();
  return { details_version: 1, source: "codex", model: "test", device_id: "test", hour_start: "2026-09-01T00:00:00.000Z",
    event_id: null, evidence_snapshot_seq: null, source_revision: 1, parser_revision: 1, detail_revision: 1, basis: g.basis, groups: [g] };
}
function base(r = fixture()): QueueRecord { return { source: r.source, model: r.model, device_id: r.device_id, hour_start: r.hour_start, ...r.basis }; }

describe("durable independent accounting revisions", () => {
  it("enforces the same adversarial trust-boundary cases in the published CLI", async () => {
    const q = new AccountingQueue(await temp());
    for (const [name, value] of invalidAccountingCases()) {
      expect(validateAccountingRecord(value, 0).valid, name).toBe(false);
      await expect(q.merge([value as AccountingRecord]), name).rejects.toThrow("Invalid accounting ledger");
    }
    expect((await q.readFromOffset(0)).records).toEqual([]);
  });
  it("allows reclassification without changing legacy totals and rejects same-revision conflicts", async () => {
    const q = new AccountingQueue(await temp()); const r = fixture();
    await q.merge([r]);
    const reclassified = { ...r, detail_revision: 2, groups: [group(80)] };
    await q.merge([reclassified]); await q.merge([r]); await q.merge([reclassified]);
    expect((await q.readFromOffset(0)).records).toEqual([reclassified]);
    await expect(q.merge([{ ...reclassified, groups: [group(70)] }])).rejects.toThrow(/Conflicting/);
    expect(await q.loadDirtyKeys()).toEqual([accountingKey(r)]);
  });

  it("preserves the ledger across reset and refuses malformed private fields", async () => {
    const dir = await temp(); const q = new AccountingQueue(dir); await q.merge([fixture()]);
    await executeReset({ stateDir: dir });
    expect((await q.readFromOffset(0)).records).toHaveLength(1);
    await writeFile(q.queuePath, `${JSON.stringify({ ...fixture(), prompt: "PRIVATE" })}\n`);
    await expect(q.readFromOffset(0)).rejects.toThrow(/Invalid/);
  });

  it("enforces the semantic contract locally before any details can leave the machine", async () => {
    const mutations = [
      (r: AccountingRecord) => { r.groups[0].counts!.cache_write_input_tokens = 101; },
      (r: AccountingRecord) => { r.groups[0].counts!.output_total_tokens = 41; },
      (r: AccountingRecord) => { r.groups[0].context_tokens_max = 1; },
      (r: AccountingRecord) => { r.groups[0].request_count = 0; },
      (r: AccountingRecord) => { r.evidence_snapshot_seq = 1; },
      (r: AccountingRecord) => { r.hour_start = "2026-02-30T00:00:00.000Z"; },
      (r: AccountingRecord) => { r.groups[0].reported_costs = [{ units: "1", scale: 19, kind: "actual", status: "complete", source: "server", currency: "USD" }]; },
    ];
    const q = new AccountingQueue(await temp());
    for (const change of mutations) {
      const r = fixture(); change(r);
      expect(validateAccountingRecord(r, 0).valid).toBe(false);
      await expect(q.merge([r])).rejects.toThrow("Invalid accounting ledger");
    }
    expect((await q.readFromOffset(0)).records).toEqual([]);
  });

  it("isolates invalid parser details while preserving other source annotations", () => {
    const bad = group(); bad.counts!.cache_write_input_tokens = 101;
    const good = { ...base(), source: "grok" as const };
    const onWarning = vi.fn();
    const updates = planAccountingUpdates({ previous: [], before: [], after: [base(), good], replay: true, deviceId: "test", onWarning,
      deltas: [{ source: "codex", model: "test", timestamp: fixture().hour_start, tokens, accounting: bad },
        { source: "grok", model: "test", timestamp: fixture().hour_start, tokens, accounting: group() }] });
    expect(updates.map((r) => r.source)).toEqual(["grok"]);
    expect(onWarning).toHaveBeenCalledWith("codex");
  });

  it("keeps pre-upgrade history unknown while classifying a proven append", () => {
    const before = base(); const after = { ...before, input_tokens: 200, cached_input_tokens: 1600, output_tokens: 60, reasoning_output_tokens: 20, total_tokens: 1880 };
    const updates = planAccountingUpdates({ previous: [], before: [before], after: [after], replay: false, deviceId: "test",
      deltas: [{ source: "codex", model: "test", timestamp: "2026-09-01T00:00:01.000Z", tokens, accounting: group() }] });
    expect(updates[0].basis).toEqual({ input_tokens: 200, cached_input_tokens: 1600, output_tokens: 60, reasoning_output_tokens: 20, total_tokens: 1880 });
    expect(updates[0].groups.find((g) => g.quality === "legacy")?.basis).toEqual(fixture().basis);
    expect(updates[0].groups.find((g) => g.counts)?.counts?.cache_write_input_tokens).toBe(90);
  });

  it("does not treat component-wise growth as proof of coverage", () => {
    const r = fixture(); const unrelated = { ...base(), input_tokens: 101, total_tokens: 941 };
    expect(planAccountingUpdates({ previous: [r], before: [unrelated], after: [unrelated], replay: false, deviceId: "test",
      deltas: [{ source: "codex", model: "test", timestamp: "2026-09-01T00:00:01.000Z", tokens, accounting: group() }] })).toEqual([]);
  });
});

describe("sync commits legacy counters, annotations and cursors together", () => {
  it("recovers a cursor-write failure before re-reading the same source bytes", async () => {
    const root = await temp(); const sessions = join(root, "claude");
    const { mkdir } = await import("node:fs/promises"); await mkdir(join(sessions, "projects", "test"), { recursive: true });
    const log = join(sessions, "projects", "test", "a.jsonl");
    const event = (id: string) => `${JSON.stringify({ timestamp: "2026-09-01T00:00:01.000Z", message: { id, model: "test", usage: {
      input_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 20, output_tokens: 5 } } })}\n`;
    await writeFile(log, event("one"));
    const stateDir = join(root, "state"); const opts = { stateDir, deviceId: "test", claudeDir: sessions };
    await executeSync(opts);
    await appendFile(log, event("two"));
    vi.spyOn(CursorStore.prototype, "save").mockRejectedValueOnce(new Error("simulated cursor write failure"));
    await expect(executeSync(opts)).rejects.toThrow("simulated cursor");
    vi.restoreAllMocks(); await executeSync(opts);
    const records = (await readFile(join(stateDir, "queue.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    expect(records).toHaveLength(1); expect(records[0].total_tokens).toBe(270);
    const [details] = (await new AccountingQueue(stateDir).readFromOffset(0)).records;
    expect(details.basis.total_tokens).toBe(270);
    expect(details.groups[0].counts?.cache_write_input_tokens).toBe(40);
    await executeSync(opts);
    expect((await new AccountingQueue(stateDir).readFromOffset(0)).records).toEqual([details]);
  });
});
