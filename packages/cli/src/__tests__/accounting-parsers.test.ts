import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseCodexFile } from "../parsers/codex.js";
import { parsePiFile } from "../parsers/pi.js";
import { parseClaudeFile } from "../parsers/claude.js";
import { parseHermesDatabase } from "../parsers/hermes-sqlite.js";
import { normalizeGrokUsage, parseGrokLogFile } from "../parsers/grok.js";
import { parseOpenClawFile } from "../parsers/openclaw.js";
import { parseOpenCodeFile } from "../parsers/opencode.js";
import { processOpenCodeMessages } from "../parsers/opencode-sqlite.js";
import { parseZcodeSqlite } from "../parsers/zcode-sqlite.js";
import { inclusiveAccounting, reportedCost } from "../utils/accounting.js";
import { hermesAccountingSnapshots } from "../parsers/hermes-sqlite.js";
import { validateAccountingRecord } from "../../../core/src/accounting.js";

const dirs: string[] = [];
async function fixture(lines: object[]) {
  const dir = await mkdtemp(join(tmpdir(), "pew-cache-parser-")); dirs.push(dir);
  const path = join(dir, "session.jsonl");
  await writeFile(path, `${lines.map((r) => JSON.stringify(r)).join("\n")}\n`);
  return path;
}
afterEach(async () => { await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });
const ts = "2026-09-01T00:00:01.000Z";

describe("cache extraction leaves the original accounting untouched", () => {
  it("extracts Grok inference writes while preserving unknown, missing and invalid source fields", async () => {
    const event = { msg: "shell.turn.inference_done", ts, ctx: { prompt_tokens: 100, cached_prompt_tokens: 40, completion_tokens: 20, reasoning_tokens: 5 } };
    const path = await fixture([{ ...event, ctx: null }, { ...event, ctx: [] }, { ...event, ts: null },
      { ...event, ctx: { ...event.ctx, cache_write_tokens: 20 } },
      { ...event, ctx: { ...event.ctx, cache_write_input_tokens: 10 } }, event,
      { ...event, ctx: { ...event.ctx, cached_prompt_tokens: 101 } }]);
    const legacy = await parseGrokLogFile({ filePath: path, startOffset: 0 });
    const details = await parseGrokLogFile({ filePath: path, startOffset: 0, includeAccounting: true });
    expect(details.deltas.map((d) => d.tokens)).toEqual(legacy.deltas.map((d) => d.tokens));
    expect(details.deltas).toHaveLength(4);
    expect(details.deltas.map((d) => d.accounting?.counts?.cache_write_input_tokens)).toEqual([20, 10, null, undefined]);
    expect(details.deltas[3]?.accounting?.quality).toBe("invalid");
  });
  it("extracts OpenCode writes from JSON and SQLite, preserving unknown upgrade deltas", async () => {
    const msg = { role: "assistant", modelID: "model", providerID: "custom", time: { completed: Date.parse(ts) },
      tokens: { input: 10, output: 30, reasoning: 5, cache: { read: 80, write: 10 } } };
    const path = await fixture([]); await writeFile(path, JSON.stringify(msg));
    const fresh = await parseOpenCodeFile({ filePath: path, lastTotals: null, includeAccounting: true });
    expect(fresh.delta?.accounting?.counts).toMatchObject({ input_total_tokens: 100, cache_read_input_tokens: 80, cache_write_input_tokens: 10, output_total_tokens: 35 });
    const prior = { inputTokens: 10, cachedInputTokens: 40, outputTokens: 10, reasoningOutputTokens: 0 };
    const oldCursor = await parseOpenCodeFile({ filePath: path, lastTotals: prior, includeAccounting: true });
    expect(oldCursor.delta?.accounting?.counts?.cache_write_input_tokens).toBeNull();
    const resumed = await parseOpenCodeFile({ filePath: path, lastTotals: prior, lastCacheWrite: 5, includeAccounting: true });
    expect(resumed.delta?.accounting?.counts?.cache_write_input_tokens).toBe(5);
    expect(resumed.lastCacheWrite).toBe(10);
    expect(processOpenCodeMessages([{ id: "m", session_id: "s", time_created: 1, role: "assistant", data: JSON.stringify(msg) }], true).deltas[0].accounting).toEqual(fresh.delta?.accounting);
  });

  it("retains OpenClaw reasoning as an output subset without adding to legacy tokens", async () => {
    const path = await fixture([{ type: "message", timestamp: ts, message: { model: "model", provider: "custom", usage: {
      input: 10, cacheRead: 80, cacheWrite: 10, output: 30, reasoning: 5, totalTokens: 130 } } }]);
    const legacy = await parseOpenClawFile({ filePath: path, startOffset: 0 });
    const result = await parseOpenClawFile({ filePath: path, startOffset: 0, includeAccounting: true });
    expect(result.deltas[0].tokens).toEqual(legacy.deltas[0].tokens);
    expect(result.deltas[0].accounting?.counts).toMatchObject({ cache_write_input_tokens: 10, output_total_tokens: 30, reasoning_output_tokens: 5 });
  });

  it("retains ZCode creation tokens and the provider-total reasoning crosscheck", () => {
    const row = { id: "m", sessionId: "s", turnId: null, modelId: "model", providerId: "custom", status: "completed" as const,
      startedAt: 1, completedAt: Date.parse(ts), inputTokens: 100, outputTokens: 30, reasoningTokens: 5,
      cacheReadInputTokens: 80, cacheCreationInputTokens: 10, providerTotalTokens: 130, computedTotalTokens: 130 };
    const db = { queryUsageRows: () => [row], close: () => {} };
    const legacy = parseZcodeSqlite({ db, lastCompletedAt: null });
    const result = parseZcodeSqlite({ db, lastCompletedAt: null, includeAccounting: true });
    expect(result.deltas[0].tokens).toEqual(legacy.deltas[0].tokens);
    expect(result.deltas[0].accounting).toMatchObject({ provider: "custom", counts: { cache_write_input_tokens: 10, output_total_tokens: 30, reasoning_output_tokens: 5 } });
  });
  it("retains Codex write, provider and tier with the existing edge dedup", async () => {
    const usage = { input_tokens: 100000, cached_input_tokens: 90000, cache_write_input_tokens: 10000,
      output_tokens: 1000, reasoning_output_tokens: 400, total_tokens: 101000 };
    const event = { type: "event_msg", timestamp: ts, payload: { type: "token_count", info: { total_token_usage: usage, last_token_usage: usage } } };
    const path = await fixture([{ type: "session_meta", payload: { model_provider: "openai" } },
      { type: "turn_context", payload: { model: "gpt-6-astra", service_tier: "priority" } }, event, event]);
    const legacy = await parseCodexFile({ filePath: path, startOffset: 0, lastModel: null, lastTotals: null });
    const result = await parseCodexFile({ filePath: path, startOffset: 0, lastModel: null, lastTotals: null, includeAccounting: true });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].tokens).toEqual(legacy.deltas[0].tokens);
    expect(result.usageKeys).toEqual(legacy.usageKeys);
    expect(result.deltas[0].accounting).toMatchObject({ provider: "openai", service_tier: "priority",
      counts: { input_total_tokens: 100000, cache_write_input_tokens: 10000, output_total_tokens: 1000, reasoning_output_tokens: 400 } });
  });

  it("does not invent write tokens from Codex total discrepancies or old cumulative-only logs", async () => {
    const u = { input_tokens: 100, cached_input_tokens: 90, output_tokens: 5, total_tokens: 999 };
    const path = await fixture([{ type: "event_msg", timestamp: ts, payload: { type: "token_count", info: { total_token_usage: u, last_token_usage: u } } }]);
    const { deltas } = await parseCodexFile({ filePath: path, startOffset: 0, lastModel: "test", lastTotals: null, includeAccounting: true });
    expect(deltas[0].accounting?.counts?.cache_write_input_tokens).toBeNull();
    expect(deltas[0].accounting?.diagnostics).toContainEqual({ code: "total_mismatch", raw_total_tokens: 999 });
  });

  it("extracts Pi writes, TTL and reasoning, retaining SDK zero as unknown billing", async () => {
    const path = await fixture([{ type: "message", timestamp: ts, message: { role: "assistant", model: "test", provider: "custom",
      usage: { input: 100, cacheRead: 800, cacheWrite: 100, cacheWrite1h: 25, output: 40, reasoning: 10, cost: { total: 0 } } } }]);
    const { deltas } = await parsePiFile({ filePath: path, startOffset: 0, includeAccounting: true });
    expect(deltas[0].tokens).toEqual({ inputTokens: 200, cachedInputTokens: 800, outputTokens: 30, reasoningOutputTokens: 10 });
    expect(deltas[0].accounting).toMatchObject({ provider: "custom", counts: { input_total_tokens: 1000,
      cache_write_input_tokens: 100, cache_write_1h_input_tokens: 25, output_total_tokens: 40, reasoning_output_tokens: 10 },
    reported_costs: [{ units: "0", kind: "estimate", status: "unknown" }] });
  });

  it("keeps Claude TTL subsets and does not guess the provider from an Anthropic-shaped wire format", async () => {
    const path = await fixture([{ timestamp: ts, message: { id: "one", model: "minimax-m2.7", usage: { input_tokens: 100,
      cache_read_input_tokens: 800, cache_creation_input_tokens: 100, cache_creation: { ephemeral_5m_input_tokens: 75, ephemeral_1h_input_tokens: 25 }, output_tokens: 40 } } }]);
    const { deltas } = await parseClaudeFile({ filePath: path, startOffset: 0, includeAccounting: true });
    expect(deltas[0].accounting).toMatchObject({ provider: null, counts: { cache_write_5m_input_tokens: 75, cache_write_1h_input_tokens: 25 } });
  });

  it("reclassifies Hermes read/write and overlapping reasoning without changing the legacy vector", async () => {
    const path = await fixture([]);
    const { deltas } = await parseHermesDatabase(path, () => [{ id: "local", model: "auto", input_tokens: 100, cache_read_tokens: 800,
      cache_write_tokens: 100, output_tokens: 40, reasoning_tokens: 10, started_at: Date.parse(ts) / 1000 }], undefined, true);
    expect(deltas[0].tokens).toEqual({ inputTokens: 100, cachedInputTokens: 900, outputTokens: 40, reasoningOutputTokens: 10 });
    expect(deltas[0].accounting).toMatchObject({ context_tokens_min: null, counts: { input_total_tokens: 1000,
      cache_read_input_tokens: 800, cache_write_input_tokens: 100, output_total_tokens: 40, reasoning_output_tokens: 10 } });
    const group = deltas[0].accounting!;
    expect(validateAccountingRecord({ details_version: 1, source: "hermes", model: "auto", device_id: "test", hour_start: "2026-09-01T00:00:00.000Z",
      event_id: null, evidence_snapshot_seq: null, source_revision: 1, parser_revision: 1, detail_revision: 1, basis: group.basis, groups: [group] }, 0).valid).toBe(true);
  });

  it("keeps Hermes model ledgers as an exact partition of the main snapshot and preserves cost status", () => {
    const session = { id: "s", model: "auto", input_tokens: 100, cache_read_tokens: 800, cache_write_tokens: 100,
      output_tokens: 40, reasoning_tokens: 10, started_at: Date.parse(ts) / 1000, cost_status: "unknown", cost_source: "none", actual_cost_usd: 0 };
    const model = { ...session, session_id: "s", model: "real-model", billing_provider: "openrouter", billing_route: "openrouter",
      route_key: "a".repeat(64), task: "", api_call_count: 2, first_seen: null, last_seen: null, source: "acp",
      cost_status: "actual", cost_source: "provider_response", actual_cost_usd: "0.00123456789" };
    const [d] = hermesAccountingSnapshots([session], [model]);
    expect(d.model).toBe("auto");
    expect(d.accounting).toMatchObject({ model: "real-model", provider: "openrouter", route: "openrouter",
      reported_costs: [{ units: "123456789", scale: 11, kind: "actual", status: "complete" }] });
    const [fallback] = hermesAccountingSnapshots([session], [{ ...model, input_tokens: 99 }]);
    expect(fallback.accounting).toMatchObject({ model: "auto", reported_costs: [{ units: "0", kind: "actual", status: "unknown" }] });
    const [included] = hermesAccountingSnapshots([{ ...session, cost_status: "included" }], []);
    expect(included.accounting?.reported_costs[0]).toMatchObject({ units: "0", kind: "included", status: "complete" });
  });

  it("validates bad provider counts independently of the legacy normalizer", () => {
    const raw = { prompt_tokens: 100, cached_prompt_tokens: 120, completion_tokens: 3, reasoning_tokens: 9 };
    const group = inclusiveAccounting(normalizeGrokUsage(raw), { input: 100, read: 120, write: null, output: 3, reasoning: 9 }, { origin: "grok:inference", model: "grok-4.6" });
    expect(group.counts).toBeNull();
    expect(group.quality).toBe("invalid");
  });

  it("does not turn a clamped exclusive source input into a reported zero", async () => {
    const path = await fixture([{ type: "message", timestamp: ts, message: { role: "assistant", model: "model", usage: {
      input: -10, cacheRead: 100, cacheWrite: 0, output: 5 } } }]);
    const result = await parsePiFile({ filePath: path, startOffset: 0, includeAccounting: true });
    expect(result.deltas[0].accounting?.counts).toBeNull();
    expect(result.deltas[0].tokens.inputTokens).toBe(0);
  });

  it("represents reported amounts without floating-point conversion and preserves status", () => {
    expect(reportedCost("85588366160000", 10, "grok", "actual", "partial")).toEqual({ units: "85588366160000", scale: 10, currency: "USD", kind: "actual", status: "partial", source: "grok" });
    expect(reportedCost(0, 10, "hermes", "actual", "unknown")?.status).toBe("unknown");
    expect(reportedCost(Number.MAX_SAFE_INTEGER + 1, 10, "grok", "actual", "complete")).toBeNull();
  });
});
