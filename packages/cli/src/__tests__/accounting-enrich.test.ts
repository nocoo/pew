import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { executeEnrich, type EnrichOptions } from "../commands/enrich.js";
import { AccountingQueue } from "../storage/accounting-queue.js";

describe("directed accounting enrichment", () => {
  it.each(["claude-code", "all"] as const)("previews %s without state writes, applies details only and leaves missing history unchanged", async (source) => {
    const dir = await mkdtemp(join(tmpdir(), "pew-enrich-"));
    try {
      const stateDir = join(dir, "state"); const claudeDir = join(dir, "claude");
      const logs = join(claudeDir, "projects", "synthetic");
      await mkdir(logs, { recursive: true }); await mkdir(stateDir);
      const log = join(logs, "session.jsonl");
      await writeFile(log, `${JSON.stringify({ timestamp: "2026-09-01T00:00:01.000Z", message: { id: "one", model: "model", usage: {
        input_tokens: 10, cache_read_input_tokens: 80, cache_creation_input_tokens: 10, output_tokens: 20 } } })}\n`);
      const record = { source: "claude-code", model: "model", device_id: "test", hour_start: "2026-09-01T00:00:00.000Z",
        input_tokens: 20, cached_input_tokens: 80, output_tokens: 20, reasoning_output_tokens: 0, total_tokens: 120 };
      await writeFile(join(stateDir, "queue.jsonl"), `${JSON.stringify(record)}\n${JSON.stringify({ ...record, model: "rotated-history" })}\n`);
      await writeFile(join(stateDir, "cursors.json"), "{\"files\":{},\"version\":1}\n");
      await writeFile(join(stateDir, "queue.state.json"), "{\"offset\":0,\"dirtyKeys\":[]}\n");
      const snapshot = async () => Object.fromEntries(await Promise.all((await readdir(stateDir)).sort().map(async (n) => [n, await readFile(join(stateDir, n), "utf8")])));
      const before = await snapshot(); const rawBefore = await readFile(log, "utf8");
      const opts = { stateDir, deviceId: "test", claudeDir, source, from: "2026-09-01", to: "2026-09-02" };
      const preview = await executeEnrich(opts);
      expect(preview).toMatchObject({ mode: "preview", eligible: 2, matched: 1, changed: 1, unverified: 1, applied: 0 });
      expect(await snapshot()).toEqual(before);
      const applied = await executeEnrich({ ...opts, apply: true });
      expect(applied.applied).toBe(1);
      for (const [name, contents] of Object.entries(before)) expect(await readFile(join(stateDir, name), "utf8")).toBe(contents);
      expect(await readFile(log, "utf8")).toBe(rawBefore);
      const [details] = (await new AccountingQueue(stateDir).readFromOffset(0)).records;
      expect(details.groups[0].counts?.cache_write_input_tokens).toBe(10);
      expect((await executeEnrich({ ...opts, apply: true })).changed).toBe(0);
      await rm(log);
      expect(await executeEnrich({ ...opts, apply: true })).toMatchObject({ eligible: 2, matched: 0, changed: 0, unverified: 2 });
      expect((await new AccountingQueue(stateDir).readFromOffset(0)).records).toEqual([details]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("advances detail revisions independently, preserves newer parsers and refuses corrupt original queues", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pew-enrich-revisions-"));
    try {
      const stateDir = join(dir, "state"); const claudeDir = join(dir, "claude");
      const logs = join(claudeDir, "projects", "synthetic");
      await mkdir(logs, { recursive: true }); await mkdir(stateDir);
      const log = join(logs, "session.jsonl"); const originalQueue = join(stateDir, "queue.jsonl");
      const writeLog = (input: number, write: number) => writeFile(log, `${JSON.stringify({ timestamp: "2026-09-01T00:00:01.000Z",
        message: { id: "one", model: "model", usage: { input_tokens: input, cache_read_input_tokens: 80, cache_creation_input_tokens: write, output_tokens: 20 } } })}\n`);
      const record = { source: "claude-code", model: "model", device_id: "test", hour_start: "2026-09-01T00:00:00.000Z",
        input_tokens: 20, cached_input_tokens: 80, output_tokens: 20, reasoning_output_tokens: 0, total_tokens: 120 };
      await writeLog(10, 10); await writeFile(originalQueue, `${JSON.stringify(record)}\n`);
      const opts: EnrichOptions = { stateDir, claudeDir, deviceId: "test", source: "claude-code", from: "2026-09-01T00:00:00Z", to: "2026-09-01T00:30:00.000Z", apply: true };
      const queue = new AccountingQueue(stateDir);
      expect((await executeEnrich(opts)).applied).toBe(1);
      await writeLog(15, 5);
      expect((await executeEnrich(opts)).applied).toBe(1);
      let [details] = (await queue.readFromOffset(0)).records;
      expect(details).toMatchObject({ source_revision: 1, detail_revision: 2, groups: [{ counts: { cache_write_input_tokens: 5 } }] });
      await writeLog(10, 20);
      await writeFile(originalQueue, `${JSON.stringify({ ...record, input_tokens: 30, total_tokens: 130 })}\n`);
      expect((await executeEnrich(opts)).applied).toBe(1);
      [details] = (await queue.readFromOffset(0)).records;
      expect(details).toMatchObject({ source_revision: 2, detail_revision: 1, basis: { total_tokens: 130 } });
      const newer = { ...details, parser_revision: details.parser_revision + 1, detail_revision: details.detail_revision + 1 };
      await queue.merge([newer]);
      expect(await executeEnrich(opts)).toMatchObject({ matched: 1, changed: 0 });
      expect((await queue.readFromOffset(0)).records).toEqual([newer]);
      await writeFile(originalQueue, "INVALID ORIGINAL QUEUE\n");
      await expect(executeEnrich(opts)).rejects.toThrow("Invalid original usage queue");
      expect(await readFile(originalQueue, "utf8")).toBe("INVALID ORIGINAL QUEUE\n");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("enriches Grok from a proven session turn without importing session totals or another device", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pew-enrich-grok-"));
    try {
      const stateDir = join(dir, "state"); const grokSessionsDir = join(dir, "sessions");
      const session = join(grokSessionsDir, "synthetic");
      await mkdir(stateDir); await mkdir(session, { recursive: true });
      const time = Date.parse("2026-09-01T00:00:01.000Z");
      const usage = { inputTokens: 100, cachedReadTokens: 40, cacheCreationTokens: 20, outputTokens: 20, reasoningTokens: 5, modelCalls: 1, costUsdTicks: "10000000001" };
      await writeFile(join(session, "updates.jsonl"), `${JSON.stringify({ params: { _meta: { eventId: "one", agentTimestampMs: time },
        update: { sessionUpdate: "turn_completed", usage: { ...usage, modelUsage: { "grok-4.6": usage } } } } })}\n`);
      await writeFile(join(session, "usage.json"), JSON.stringify({ totals: { inputTokens: 99999999 } }));
      const record = { source: "grok", model: "grok-4.6", device_id: "test", hour_start: "2026-09-01T00:00:00.000Z",
        input_tokens: 60, cached_input_tokens: 40, output_tokens: 15, reasoning_output_tokens: 5, total_tokens: 120 };
      const original = [record, { ...record, device_id: "other" }, { ...record, hour_start: "2026-08-01T00:00:00.000Z" }].map((r) => JSON.stringify(r)).join("\n") + "\n";
      await writeFile(join(stateDir, "queue.jsonl"), original);
      const opts = { stateDir, grokSessionsDir, deviceId: "test", source: "grok" as const, from: "2026-09-01", to: "2026-09-02" };
      const preview = await executeEnrich(opts);
      expect(preview).toMatchObject({ eligible: 1, matched: 1, changed: 1, cacheWriteTokens: 20, applied: 0 });
      expect(await executeEnrich({ ...opts, apply: true })).toMatchObject({ planId: preview.planId, applied: 1 });
      expect((await executeEnrich({ ...opts, apply: true })).changed).toBe(0);
      const [details] = (await new AccountingQueue(stateDir).readFromOffset(0)).records;
      expect(details).toMatchObject({ device_id: "test", basis: { total_tokens: 120 },
        groups: [{ counts: { cache_write_input_tokens: 20 }, reported_costs: [{ units: "10000000001" }] }] });
      expect(await readFile(join(stateDir, "queue.jsonl"), "utf8")).toBe(original);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("rejects open windows and pending sync journals before attempting enrichment", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pew-enrich-bounds-"));
    try {
      const opts = { stateDir: dir, deviceId: "test", source: "codex" as const, from: "2026-09-01", to: "2026-09-02" };
      await expect(executeEnrich({ ...opts, to: "9999-01-01" })).rejects.toThrow("closed UTC");
      await expect(executeEnrich({ ...opts, from: "2026-02-30" })).rejects.toThrow("closed UTC");
      await expect(executeEnrich({ ...opts, from: "2026-08-31T24:00:00Z" })).rejects.toThrow("closed UTC");
      await expect(executeEnrich({ ...opts, from: "2026-09-01T00:15:00Z" })).rejects.toThrow("closed UTC");
      await expect(executeEnrich({ ...opts, from: opts.to })).rejects.toThrow("closed UTC");
      await expect(executeEnrich({ ...opts, source: "invalid" as EnrichOptions["source"] })).rejects.toThrow("Invalid accounting source");
      await expect(executeEnrich({ ...opts, deviceId: "/private/device" })).rejects.toThrow("existing Pew device ID");
      await writeFile(join(dir, "sync-commit.json"), "pending");
      await expect(executeEnrich(opts)).rejects.toThrow("pending sync");
      expect(await readFile(join(dir, "sync-commit.json"), "utf8")).toBe("pending");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
