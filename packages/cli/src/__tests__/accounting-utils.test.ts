import { describe, expect, it } from "vitest";
import { decimalCost, inclusiveAccounting, mergeAccountingGroups, piAccounting, reportedCost, unknownAccounting } from "../utils/accounting.js";
import { normalizePiUsage } from "../parsers/pi.js";

const tokens = { inputTokens: 100, cachedInputTokens: 800, outputTokens: 30, reasoningOutputTokens: 10 };
const raw = { input: 900, read: 800, write: 90, output: 40, reasoning: 10 };
const options = { origin: "codex:last_token_usage", model: "model" };

describe("source accounting boundaries", () => {
  it.each([
    ["1h exceeds a zero write total", { write: 0, write1h: 1 }],
    ["5m exceeds a zero write total", { write: 0, write5m: 1 }],
    ["TTL exceeds write total", { write5m: 50, write1h: 50 }],
    ["TTL without a write total", { write: null, write1h: 1 }],
    ["negative visible output", { visibleOutput: -1 }],
    ["fractional exclusive input", { uncachedInput: 0.5 }],
    ["missing total input", { input: undefined }],
    ["wrong input basis", { input: 899 }],
    ["wrong output basis", { output: 41 }],
  ])("retains the basis but rejects %s", (_name, patch) => {
    const group = inclusiveAccounting(tokens, { ...raw, ...patch }, options);
    expect(group).toMatchObject({ quality: "invalid", counts: null, basis: { input_tokens: 100, cached_input_tokens: 800, total_tokens: 940 },
      diagnostics: [{ code: "invalid_counts" }], context_tokens_min: null, context_tokens_max: null });
  });

  it("derives zero TTL subsets only when zero writes are consistent with the source", () => {
    const group = inclusiveAccounting(tokens, { ...raw, write: 0 }, { ...options, quality: "derived" });
    expect(group).toMatchObject({ quality: "derived", counts: { cache_write_input_tokens: 0, cache_write_5m_input_tokens: 0, cache_write_1h_input_tokens: 0 } });
  });

  it("includes Pi orchestration once and treats SDK money as an estimate", () => {
    const usage = { input: 100, cacheRead: 800, cacheWrite: 100, output: 40, reasoningTokens: 10, totalTokens: 1115,
      orchestration: { input: 50, cacheRead: 20, output: 5 }, cost: { total: "1e-7" } };
    const group = piAccounting(normalizePiUsage(usage), usage, "test", "openai");
    expect(group).toMatchObject({ basis: { total_tokens: 1115 }, context_tokens_min: null, request_count: null,
      counts: { input_total_tokens: 1070, cache_read_input_tokens: 820, cache_write_input_tokens: 100, output_total_tokens: 45, reasoning_output_tokens: 10 },
      reported_costs: [{ units: "1", scale: 7, kind: "estimate", status: "complete" }], diagnostics: [{ code: "aggregate_context" }] });
    const bad = { ...usage, orchestration: { ...usage.orchestration, output: -5 } };
    expect(piAccounting(normalizePiUsage(bad), bad, "test", "openai").counts).toBeNull();
    const absent = { ...usage, output: undefined };
    expect(piAccounting(normalizePiUsage(absent), absent, "test", "openai").counts).toBeNull();
    for (const field of ["input", "cacheRead", "output"]) {
      const invalid = { ...usage, orchestration: { ...usage.orchestration, [field]: -1 } };
      expect(piAccounting(normalizePiUsage(invalid), invalid, "test", "openai").quality).toBe("invalid");
    }
  });
});

describe("exact source money", () => {
  it.each([
    ["0012.3400", "123400", 4], ["12e3", "12000", 0], ["1.23e-4", "123", 6], [0, "0", 0], [1e-7, "1", 7],
  ])("preserves the decimal value %s without converting it to a float", (value, units, scale) => {
    expect(decimalCost(value, "sdk", "estimate", "unknown")).toEqual({ units, scale, source: "sdk", kind: "estimate", status: "unknown", currency: "USD" });
  });
  it.each([undefined, {}, -1, Infinity, NaN, "-1", "1.2.3", "1e19", "1e-19", "9".repeat(61)])("rejects invalid or unsupported decimal money %s", (value) => {
    expect(decimalCost(value, "sdk", "estimate", "unknown")).toBeNull();
  });
  it.each([["01", 10], ["-1", 10], ["1.5", 10], [true, 10], [1.5, 10], ["1", -1], ["1", 19], ["1", 0.5]])("rejects invalid ticks %s at scale %s", (value, scale) => {
    expect(reportedCost(value, scale as number, "grok", "actual", "partial")).toBeNull();
  });
});

describe("billing group aggregation", () => {
  const group = (input: number) => inclusiveAccounting({ inputTokens: input - 80, cachedInputTokens: 80, outputTokens: 10, reasoningOutputTokens: 0 },
    { input, read: 80, write: 20, output: 10, reasoning: 0 }, options);

  it("keeps pricing threshold boundaries separate, including the exact thresholds", () => {
    const inputs = [100, 150, 200000, 200001, 272000, 272001];
    const merged = mergeAccountingGroups(inputs.map(group));
    expect(merged).toHaveLength(5);
    expect(merged.map((g) => g.context_tokens_min)).toEqual([100, 200000, 200001, 272000, 272001]);
    expect(merged[0]).toMatchObject({ request_count: 2, context_tokens_min: 100, context_tokens_max: 150,
      counts: { input_total_tokens: 250, cache_read_input_tokens: 160, cache_write_input_tokens: 40, output_total_tokens: 20 }, basis: { total_tokens: 270 } });
  });

  it("sums exact money and diagnostics without changing source records", () => {
    const a = group(100); const b = group(150);
    a.reported_costs = [reportedCost("123", 3, "sdk", "estimate", "partial")!];
    b.reported_costs = [reportedCost("456", 3, "sdk", "estimate", "partial")!];
    a.diagnostics = [{ code: "total_mismatch", raw_total_tokens: 111 }];
    b.diagnostics = [{ code: "total_mismatch", raw_total_tokens: 161 }];
    const merged = mergeAccountingGroups([a, b]);
    expect(merged[0]?.reported_costs).toMatchObject([{ units: "579", scale: 3, status: "partial" }]);
    expect(merged[0]?.diagnostics).toEqual([{ code: "total_mismatch", raw_total_tokens: 272 }]);
    expect(a.reported_costs[0]?.units).toBe("123");
    b.diagnostics[0]!.raw_total_tokens = null;
    expect(mergeAccountingGroups([a, b])[0]?.diagnostics[0]?.raw_total_tokens).toBeNull();
    b.reported_costs[0]!.status = "complete";
    expect(mergeAccountingGroups([a, b])).toHaveLength(2);
  });

  it("never upgrades unknown counts, request context or TTL coverage while merging", () => {
    const legacy = unknownAccounting(group(100).basis, "model");
    expect(mergeAccountingGroups([legacy, legacy])[0]).toMatchObject({ counts: null, request_count: null, context_tokens_min: null, basis: { total_tokens: 220 } });
    const aggregate = { ...group(100), request_count: null, context_tokens_min: null, context_tokens_max: null };
    const merged = mergeAccountingGroups([aggregate, aggregate]);
    expect(merged[0]).toMatchObject({ request_count: null, context_tokens_min: null, counts: { cache_write_1h_input_tokens: null, cache_write_input_tokens: 40 } });
    const unknownWrite = { ...group(100), counts: { ...group(100).counts!, cache_write_input_tokens: null } };
    expect(mergeAccountingGroups([group(100), unknownWrite])).toHaveLength(2);
  });
});
