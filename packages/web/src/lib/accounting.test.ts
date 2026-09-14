import { describe, expect, it } from "vitest";
import type { AccountingAnnotation, AccountingGroup } from "@pew/core";
import { buildPricingMap, type DynamicPricingEntry } from "./pricing";
import { estimateUsageCost, summarizeAccounting } from "./accounting";
import { computeTotalCost, toDailyCostPoints, computeCacheSavings, toDailyCacheRates, computeReasoningRatio } from "./cost-helpers";
import { toModelAggregates, toDailyPoints, toSourceAggregates } from "./usage-transforms";
import { groupByDate, groupByAgent, groupByModel, toLocalDailyBuckets, toHourlyByAgent } from "./usage-helpers";
import { toModelEvolutionPoints } from "./model-helpers";

const entry: DynamicPricingEntry = { model: "openai/gpt-6-astra", provider: "OpenAI", displayName: "GPT-6 Astra", inputPerMillion: 10,
  outputPerMillion: 50, cachedPerMillion: 1, cacheWritePerMillion: 12.5, contextWindow: 1000000, origin: "models.dev", route: "direct",
  updatedAt: "2026-09-01T00:00:00.000Z", contextTiers: [{ minInputTokens: 272001, inputPerMillion: 20, outputPerMillion: 75, cachedPerMillion: 2, cacheWritePerMillion: 25 }] };
function row(input = 100000, read = 90000, write: number | null = 10000, output = 1000, reasoning = 400) {
  const basis = { input_tokens: input - read, cached_input_tokens: read, output_tokens: output - reasoning, reasoning_output_tokens: reasoning, total_tokens: input + output };
  const group: AccountingGroup = { basis, counts: { input_total_tokens: input, cache_read_input_tokens: read, cache_write_input_tokens: write,
    cache_write_5m_input_tokens: null, cache_write_1h_input_tokens: null, output_total_tokens: output, reasoning_output_tokens: reasoning }, origin: "codex:last_token_usage",
  model: "gpt-6-astra", provider: "openai", route: null, service_tier: "default", context_tokens_min: input, context_tokens_max: input,
  request_count: 1, quality: "reported", reported_costs: [], diagnostics: [] };
  return { ...basis, source: "codex", model: "gpt-6-astra", hour_start: "2026-09-01T00:00:00.000Z",
    accounting: [{ status: "matched" as AccountingAnnotation["status"], basis, groups: [group] }] satisfies [AccountingAnnotation & { groups: [AccountingGroup] }] };
}

describe("billing groups and honest cache metrics", () => {
  it("preserves details through model totals and daily chart stacks", () => {
    const r = row(); const map = buildPricingMap({ dynamic: [entry] });
    const models = toModelAggregates([r]);
    expect(computeTotalCost(models, map)).toBeCloseTo(0.265);
    const [day] = toDailyCostPoints([r], map);
    if (!day) throw new Error("Expected a daily cost point");
    expect(day.inputCost + day.outputCost + day.cachedCost + (day.cacheWriteCost ?? 0)).toBeCloseTo(day.totalCost);
    expect(day.cacheWriteCost).toBeCloseTo(0.125);
    expect(computeCacheSavings(models, map).netSavings).toBeCloseTo(0.785);
    expect(toDailyCacheRates([r])[0]?.cacheRate).toBe(90);
  });
  it("charges writes at their replacement rate and counts reasoning once", () => {
    const r = row(); const cost = estimateUsageCost(r, buildPricingMap({ dynamic: [entry] }));
    expect(cost.totalCost).toBeCloseTo(0.265);
    expect(cost.cacheWriteCost).toBeCloseTo(0.125);
    expect(cost.netSavings).toBeCloseTo(0.785);
    expect(cost.complete).toBe(true);
    expect(summarizeAccounting([r])).toMatchObject({ inputTokens: 100000, outputTokens: 1000, totalTokens: 101000,
      cacheReadTokens: 90000, cacheWriteTokens: 10000, cacheReadRate: 90, writeCoverage: 1 });
  });

  it("permits negative net savings when the write premium exceeds read savings", () => {
    const r = row(10000000, 1000000, 9000000, 0, 0);
    r.accounting[0].groups[0].context_tokens_min = 100000;
    r.accounting[0].groups[0].context_tokens_max = 100000;
    r.accounting[0].groups[0].request_count = 100;
    expect(estimateUsageCost(r, buildPricingMap({ dynamic: [entry] })).netSavings).toBeCloseTo(-13.5);
  });

  it("prices each request context before summing a bucket", () => {
    const r = row(320000, 300000, 20000, 2000, 800);
    r.accounting[0].groups[0].context_tokens_min = 160000;
    r.accounting[0].groups[0].context_tokens_max = 160000;
    r.accounting[0].groups[0].request_count = 2;
    expect(estimateUsageCost(r, buildPricingMap({ dynamic: [entry] })).totalCost).toBeCloseTo(0.65);
    r.accounting[0].groups[0].context_tokens_min = null;
    r.accounting[0].groups[0].context_tokens_max = null;
    const incomplete = estimateUsageCost(r, buildPricingMap({ dynamic: [entry] }));
    expect(incomplete.complete).toBe(false); expect(incomplete.issues).toContain("context_unknown");
  });

  it("cannot report net savings for unknown writes, pending bases or unknown tier rates", () => {
    const map = buildPricingMap({ dynamic: [entry] });
    expect(estimateUsageCost(row(100000, 90000, null), map).netSavings).toBeNull();
    const pending = row(); pending.accounting[0].status = "pending";
    expect(estimateUsageCost(pending, map)).toMatchObject({ complete: false, netSavings: null });
    const fast = row(); fast.accounting[0].groups[0].service_tier = "priority";
    expect(estimateUsageCost(fast, map).issues).toContain("service_tier_unknown");
  });

  it("keeps exact private reported cost separate from the public estimate", () => {
    const r = row(); r.accounting[0].groups[0].reported_costs = [{ units: "85588366160000", scale: 10, currency: "USD", kind: "actual", status: "complete", source: "grok" }];
    const cost = estimateUsageCost(r, buildPricingMap({ dynamic: [entry] }));
    expect(cost.totalCost).toBeCloseTo(0.265); expect(cost.reportedCosts[0]?.units).toBe("85588366160000");
  });

  it("does not turn unsupported source counters into a known-zero cache write", () => {
    const { accounting: _accounting, ...legacy } = row();
    const summary = summarizeAccounting([legacy]);
    expect(summary).toMatchObject({ cacheReadRate: 90, cacheWriteTokens: 0, writeCoverage: 0 });
  });

  it("cannot double-discount duplicated annotations", () => {
    const r = row(); r.accounting.push(r.accounting[0]);
    const result = estimateUsageCost(r, buildPricingMap({ dynamic: [entry] }));
    expect(result.complete).toBe(false); expect(result.issues).toContain("basis_mismatch");
  });

  it("uses covered input for partial read rates and cannot invent a cache rate for unknown counters", () => {
    const known = row();
    const { accounting: _accounting, ...legacy } = row();
    const unknown = { ...legacy, cached_input_tokens: 0, input_tokens: 100000, total_tokens: 101000 };
    const [day] = toDailyCacheRates([known, unknown]);
    expect(day).toMatchObject({ cacheRate: 90, coverage: 0.5, coveredInputTokens: 100000 });
    expect(toDailyCacheRates([unknown])[0]?.cacheRate).toBeNull();
    expect(toDailyCacheRates([row(100000, 0, 0)])[0]).toMatchObject({ cacheRate: 0, coverage: 1 });
  });

  it("does not choose a direct price from another provider sharing the same bare model name", () => {
    const r = row();
    const map = buildPricingMap({ dynamic: [entry, { ...entry, model: "anthropic/gpt-6-astra", provider: "Anthropic", inputPerMillion: 100 }] });
    expect(estimateUsageCost(r, map).totalCost).toBeCloseTo(0.265);
    expect(estimateUsageCost(r, map).complete).toBe(true);
  });

  it("prices write TTL subsets separately and keeps missing TTL or rates incomplete", () => {
    const r = row(100000, 20000, 50000);
    const g = r.accounting[0].groups[0];
    g.counts!.cache_write_5m_input_tokens = 30000; g.counts!.cache_write_1h_input_tokens = 10000;
    const rates = { ...entry, inputPerMillion: 5, outputPerMillion: 25, cachedPerMillion: 0.5,
      cacheWritePerMillion: 6.25, cacheWrite5mPerMillion: 7, cacheWrite1hPerMillion: 10, contextTiers: [] };
    const cost = estimateUsageCost(r, buildPricingMap({ dynamic: [rates] }));
    expect(cost.cacheWriteCost).toBeCloseTo(0.3725);
    expect(cost.totalCost).toBeCloseTo(0.5575);
    expect(cost.complete).toBe(true);
    const withoutHour = { ...rates, cacheWrite1hPerMillion: null };
    expect(estimateUsageCost(r, buildPricingMap({ dynamic: [withoutHour] })).issues).toContain("cache_write_price_unknown");
    g.counts!.cache_write_1h_input_tokens = null;
    expect(estimateUsageCost(r, buildPricingMap({ dynamic: [rates] })).issues).toContain("cache_ttl_unknown");
    const missing = { ...rates, cachedPerMillion: null, cacheWritePerMillion: null, cacheWrite5mPerMillion: null };
    expect(estimateUsageCost(r, buildPricingMap({ dynamic: [missing] })).issues).toEqual(expect.arrayContaining(["cache_read_price_unknown", "cache_write_price_unknown"]));
  });

  it("uses inclusive tier boundaries and preserves OpenRouter prices independently from direct rates", () => {
    const r = row(272001, 100000, 20000);
    const map = buildPricingMap({ dynamic: [{ ...entry, routePrices: { openrouter: {
      inputPerMillion: 2, outputPerMillion: 10, cachedPerMillion: 0.2, cacheWritePerMillion: 2.5,
      origin: "openrouter", updatedAt: entry.updatedAt, contextTiers: [],
    } } }] });
    expect(estimateUsageCost(r, map).totalCost).toBeCloseTo(3.81502);
    r.accounting[0].groups[0].context_tokens_min = 272000;
    expect(estimateUsageCost(r, map).issues).toContain("context_unknown");
    r.accounting[0].groups[0].route = "openrouter";
    expect(estimateUsageCost(r, map).totalCost).toBeCloseTo(0.384002);
    expect(estimateUsageCost(r, map).complete).toBe(true);
    r.accounting[0].groups[0].provider = "custom";
    r.accounting[0].groups[0].route = "custom";
    expect(estimateUsageCost(r, map).issues).toContain("route_unknown");
  });

  it("keeps invalid counts and mismatched annotations out of public price corrections", () => {
    const r = row(); const map = buildPricingMap({ dynamic: [entry] });
    r.accounting[0].groups[0].counts = null;
    r.accounting[0].groups[0].quality = "invalid";
    expect(estimateUsageCost(r, map)).toMatchObject({ complete: false, netSavings: null, issues: ["invalid_counts"] });
    expect(summarizeAccounting([r]).writeCoverage).toBe(0);
    r.accounting[0].groups[0].basis = { ...r.accounting[0].basis, total_tokens: 1 };
    expect(estimateUsageCost(r, map).issues).toContain("basis_mismatch");
    expect(summarizeAccounting([r]).pendingTokens).toBe(r.total_tokens);
  });

  it("discloses raw total mismatches, unknown routes and fallback price snapshots", () => {
    const r = row(); const g = r.accounting[0].groups[0];
    g.provider = null; g.service_tier = null;
    g.diagnostics = [{ code: "total_mismatch", raw_total_tokens: 999999 }];
    const map = buildPricingMap({ dynamic: [entry] });
    map.meta = { status: "baseline", snapshotId: "test", fetchedAt: null, effectiveAt: null };
    expect(estimateUsageCost(r, map).issues).toEqual(expect.arrayContaining(["route_unknown", "service_tier_unknown", "fallback_price", "source_total_mismatch"]));
    expect(estimateUsageCost(r, map).netSavings).toBeNull();
  });

  it("keeps charts and model totals consistent when Hermes reasoning overlaps the legacy output", () => {
    const r = row(100, 80, 10, 30, 5);
    r.source = "hermes";
    r.input_tokens = 10; r.cached_input_tokens = 90;
    r.output_tokens = 30; r.total_tokens = 135;
    const basis = { input_tokens: 10, cached_input_tokens: 90, output_tokens: 30, reasoning_output_tokens: 5, total_tokens: 135 };
    r.accounting[0].basis = basis; r.accounting[0].groups[0].basis = basis;
    r.accounting[0].groups[0].origin = "hermes:sessions";
    expect(summarizeAccounting([r]).totalTokens).toBe(130);
    const [daily] = toDailyPoints([r]);
    if (!daily) throw new Error("Expected daily point");
    expect(daily.total).toBe(130); expect(daily.input + daily.cached + daily.output + daily.reasoning).toBe(130);
    expect(toSourceAggregates([r])[0]?.value).toBe(130);
    expect(toModelAggregates([r])[0]?.total).toBe(130);
    expect(groupByDate([r], buildPricingMap({ dynamic: [entry] }))[0]?.totalTokens).toBe(130);
    const map = buildPricingMap({ dynamic: [entry] });
    for (const grouped of [groupByDate([r], map), groupByAgent([r], map), groupByModel([r], map), toLocalDailyBuckets([r])]) {
      expect(grouped[0]).toMatchObject({ inputTokens: 20, cachedTokens: 80, outputTokens: 30, totalTokens: 130 });
    }
    expect(toModelEvolutionPoints([r])[0]?.models["gpt-6-astra"]).toBe(130);
    expect(toHourlyByAgent([r], { from: "2026-09-01", to: "2026-09-01" })[0]?.sources.hermes).toBe(130);
    expect(r.total_tokens).toBe(135);
    expect(computeReasoningRatio(r, [r]).reasoningPercent).toBeCloseTo(100 / 6);
    expect(computeReasoningRatio(row()).reasoningPercent).toBe(40);
    r.accounting[0].groups[0].counts!.cache_read_input_tokens = null;
    const [unknownRead] = toDailyPoints([r]);
    expect(unknownRead).toMatchObject({ input: 10, cached: 90, output: 25, reasoning: 5, total: 130 });
    expect(summarizeAccounting([r]).readCoverage).toBe(0);
  });
});
