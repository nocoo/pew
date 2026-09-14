import { describe, expect, it } from "vitest";
import type { AccountingGroup, ByDeviceResponse } from "@pew/core";
import { buildPricingMap } from "./pricing";
import { toDeviceDisplayData } from "./device-helpers";
import type { UsageRow } from "./usage-transforms";
import {
  buildOverview,
  groupOverview,
  overviewDateRange,
  metricIsComplete,
  rankOverviewGroups,
} from "./overview-helpers";

const prices = buildPricingMap({ dynamic: [{
  model: "openai/gpt-6-astra", provider: "OpenAI", displayName: "GPT-6 Astra",
  inputPerMillion: 10, outputPerMillion: 50, cachedPerMillion: 1,
  cacheWritePerMillion: 12.5, contextWindow: 1_000_000,
  origin: "models.dev", route: "direct", updatedAt: "2026-09-01T00:00:00.000Z",
}] });

function usage(source = "codex", read: number | null = 60, write: number | null = 20): UsageRow {
  const basis = source === "hermes"
    ? { input_tokens: 20, cached_input_tokens: 80, output_tokens: 30, reasoning_output_tokens: 10, total_tokens: 140 }
    : { input_tokens: 40, cached_input_tokens: 60, output_tokens: 20, reasoning_output_tokens: 10, total_tokens: 130 };
  const group: AccountingGroup = {
    basis, counts: { input_total_tokens: 100, output_total_tokens: 30,
      cache_read_input_tokens: read, cache_write_input_tokens: write,
      cache_write_5m_input_tokens: null, cache_write_1h_input_tokens: null, reasoning_output_tokens: 10 },
    origin: `${source}:usage`, model: "gpt-6-astra", provider: "openai", route: "direct",
    service_tier: "default", context_tokens_min: 100, context_tokens_max: 100,
    request_count: 1, quality: "reported", reported_costs: [], diagnostics: [],
  };
  return { ...basis, source, model: "gpt-6-astra", hour_start: "2026-09-01",
    accounting: [{ status: "matched", basis, groups: [group] }] };
}

describe("Overview time scope", () => {
  it("queries exact local midnights for both usage and machine endpoints", () => {
    expect(overviewDateRange("month", "2026-09-15", -480)).toEqual({
      start: "2026-09-01", end: "2026-09-15",
      from: "2026-08-31T16:00:00.000Z", to: "2026-09-15T16:00:00.000Z",
    });
    expect(overviewDateRange("week", "2026-09-15", 420)).toEqual({
      start: "2026-09-13", end: "2026-09-15",
      from: "2026-09-13T07:00:00.000Z", to: "2026-09-16T07:00:00.000Z",
    });
    expect(overviewDateRange("week", "2026-01-01", 0).start).toBe("2025-12-28");
    expect(overviewDateRange("month", "2028-02-29", 0).to).toBe("2028-03-01T00:00:00.000Z");
    expect(overviewDateRange("all", "2026-09-15", 0)).toEqual({
      start: null, end: "2026-09-15", from: "2020-01-01T00:00:00.000Z", to: "2026-09-16T00:00:00.000Z",
    });
  });

  it("buckets timestamps once, clips outside the range, and fills inactive days", () => {
    const range = overviewDateRange("month", "2026-09-03", -480);
    const records = [
      { ...usage(), hour_start: "2026-08-31T15:59:59Z" },
      { ...usage(), hour_start: "2026-08-31T16:00:00Z" },
      { ...usage(), hour_start: "2026-09-03" },
      { ...usage(), hour_start: "2026-09-03T16:00:00Z" },
    ];
    const result = buildOverview(records, prices, range, -480);
    expect(result.records).toHaveLength(2);
    expect(result.daily.map((d) => [d.date, d.tokens, d.cache])).toEqual([
      ["2026-09-01", 130, 80], ["2026-09-02", 0, 0], ["2026-09-03", 130, 80],
    ]);
    expect(result.summary.tokens).toBe(260);
    expect(result.dailyAverageCost).toBeCloseTo(0.00402 / 3);
    expect(result.daily[1]?.costComplete).toBe(true);
    expect(metricIsComplete("cache", result.daily[1]!)).toBe(true);
  });

  it("starts all time at the earliest record, including multiple years; keeps empty ranges usable", () => {
    const range = overviewDateRange("all", "2026-01-02", 0);
    const result = buildOverview([{ ...usage(), hour_start: "2025-12-31" }], prices, range);
    expect(result.daily.map((d) => d.date)).toEqual(["2025-12-31", "2026-01-01", "2026-01-02"]);
    expect(buildOverview([], prices, range).daily).toEqual([]);
    expect(buildOverview([], prices, range).dailyAverageCost).toBe(0);
    const emptyMonth = buildOverview([], prices, overviewDateRange("month", "2026-09-02", 0));
    expect(emptyMonth.daily).toHaveLength(2);
    expect(emptyMonth.summary).toMatchObject({ tokens: 0, cost: 0, cache: 0 });
  });
});

describe("Overview metric reconciliation", () => {
  it("keeps cards, daily totals, models, harnesses and machine bars consistent for mixed clients", () => {
    const { accounting: _accounting, ...legacy } = usage();
    const pending = usage("hermes");
    pending.accounting![0]!.status = "pending";
    const records = [usage(), usage("hermes"), legacy, pending];
    const result = buildOverview(records, prices, overviewDateRange("month", "2026-09-01", 0));
    expect(result.summary).toMatchObject({ tokens: 530, input: 400, output: 130,
      cache: 220, cacheRead: 180, cacheWrite: 40, readCoverage: 0.75, writeCoverage: 0.5, costComplete: false });
    expect(result.summary.cost).toBeCloseTo(0.00826);
    expect(result.models).toHaveLength(1);
    expect(result.harnesses).toHaveLength(2);
    const deviceData: ByDeviceResponse = { devices: [], timeline: [],
      deviceDetails: records.map((r, index) => ({ ...r, device_id: index % 2 ? "work" : "home" })) };
    const machines = groupOverview(toDeviceDisplayData(deviceData).deviceDetails, prices, (r) => r.device_id);
    for (const rows of [result.daily, result.models, result.harnesses, machines]) {
      expect(rows.reduce((n, r) => n + r.tokens, 0)).toBe(530);
      expect(rows.reduce((n, r) => n + r.cost, 0)).toBeCloseTo(0.00826);
      expect(rows.reduce((n, r) => n + (r.cache ?? 0), 0)).toBe(220);
    }
    expect(metricIsComplete("tokens", result.summary)).toBe(true);
    expect(metricIsComplete("cost", result.summary)).toBe(false);
    expect(metricIsComplete("cache", result.summary)).toBe(false);
    expect(records[1]?.total_tokens).toBe(140);
  });

  it("distinguishes unavailable counts, measured zeros, and partial lower bounds", () => {
    const range = overviewDateRange("month", "2026-09-01", 0);
    const unknown = buildOverview([usage("hermes", null, null)], prices, range).summary;
    expect(unknown).toMatchObject({ cache: null, cacheRead: null, cacheWrite: null, readCoverage: 0, writeCoverage: 0 });
    const knownZero = buildOverview([usage("codex", 0, 0)], prices, range).summary;
    expect(knownZero).toMatchObject({ cache: 0, cacheRead: 0, cacheWrite: 0, readCoverage: 1, writeCoverage: 1 });
    expect(metricIsComplete("cache", knownZero)).toBe(true);
    expect(metricIsComplete("cost", knownZero)).toBe(true);
    const readOnly = buildOverview([usage("codex", 60, null)], prices, range).summary;
    expect(readOnly).toMatchObject({ cache: 60, cacheRead: 60, cacheWrite: null });
    const writeOnly = buildOverview([usage("hermes", null, 20)], prices, range).summary;
    expect(writeOnly).toMatchObject({ cache: 20, cacheRead: null, cacheWrite: 20 });
    const { accounting: _accounting, ...legacy } = usage();
    expect(buildOverview([{ ...legacy, input_tokens: 100, cached_input_tokens: 0 }], prices, range).summary.cache).toBeNull();
  });

  it("sorts each breakdown by the selected metric, retains unknown groups and never mutates source order", () => {
    const range = overviewDateRange("month", "2026-09-01", 0);
    const known = buildOverview([usage()], prices, range).summary;
    const groups = [
      { ...known, id: "unknown", tokens: 300, cost: 1, cache: null },
      { ...known, id: "b", tokens: 200, cost: 3, cache: 0 },
      { ...known, id: "a", tokens: 100, cost: 2, cache: 0 },
      { ...known, id: "cached", tokens: 50, cost: 0, cache: 20 },
    ];
    expect(rankOverviewGroups(groups, "tokens").map((r) => r.id)).toEqual(["unknown", "b", "a", "cached"]);
    expect(rankOverviewGroups(groups, "cost").map((r) => r.id)).toEqual(["b", "a", "unknown", "cached"]);
    expect(rankOverviewGroups(groups, "cache").map((r) => r.id)).toEqual(["cached", "a", "b", "unknown"]);
    expect(groups[0]?.id).toBe("unknown");
  });
});
