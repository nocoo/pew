import { describe, it, expect } from "vitest";
import { computeTotalCost, toDailyCostPoints, computeCacheSavings, forecastMonthlyCost } from "@/lib/cost-helpers";
import type { DailyCostPoint } from "@/lib/cost-helpers";
import type { ModelAggregate, UsageRow } from "@/hooks/use-usage-data";
import { getDefaultPricingMap } from "@/lib/pricing";
import type { PricingMap } from "@/lib/pricing";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePricingMap(overrides?: Partial<PricingMap>): PricingMap {
  return { ...getDefaultPricingMap(), ...overrides };
}

function makeAggregate(partial: Partial<ModelAggregate> = {}): ModelAggregate {
  return {
    model: "claude-sonnet-4-20250514",
    source: "claude-code",
    input: 1_000_000,
    output: 500_000,
    cached: 200_000,
    total: 1_500_000,
    ...partial,
  };
}

function makeRow(partial: Partial<UsageRow> = {}): UsageRow {
  return {
    source: "claude-code",
    model: "claude-sonnet-4-20250514",
    hour_start: "2026-03-10",
    input_tokens: 100_000,
    cached_input_tokens: 20_000,
    output_tokens: 50_000,
    reasoning_output_tokens: 0,
    total_tokens: 150_000,
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("computeTotalCost", () => {
  it("returns 0 for empty model list", () => {
    expect(computeTotalCost([], makePricingMap())).toBe(0);
  });

  it("computes cost for a single model using exact pricing match", () => {
    // claude-sonnet-4-20250514: input=$3/M, output=$15/M, cached=$0.3/M
    // Non-cached input = 1M - 200k = 800k
    // inputCost  = 800_000 / 1M * 3   = 2.4
    // outputCost = 500_000 / 1M * 15   = 7.5
    // cachedCost = 200_000 / 1M * 0.3  = 0.06
    // total = 9.96
    const models = [makeAggregate()];
    const cost = computeTotalCost(models, makePricingMap());
    expect(cost).toBeCloseTo(9.96, 2);
  });

  it("sums costs across multiple models", () => {
    const models = [
      makeAggregate({ model: "claude-sonnet-4-20250514", input: 1_000_000, output: 0, cached: 0 }),
      makeAggregate({ model: "claude-sonnet-4-20250514", input: 0, output: 1_000_000, cached: 0 }),
    ];
    // First:  input 1M * $3/M = $3
    // Second: output 1M * $15/M = $15
    const cost = computeTotalCost(models, makePricingMap());
    expect(cost).toBeCloseTo(18, 2);
  });

  it("uses fallback pricing for unknown models", () => {
    // Fallback: input=$3, output=$15, cached=$0.3
    const models = [
      makeAggregate({ model: "totally-unknown-model", source: "unknown-source", input: 1_000_000, output: 0, cached: 0 }),
    ];
    const cost = computeTotalCost(models, makePricingMap());
    expect(cost).toBeCloseTo(3, 2); // 1M input * $3/M
  });

  it("handles zero tokens gracefully", () => {
    const models = [makeAggregate({ input: 0, output: 0, cached: 0 })];
    expect(computeTotalCost(models, makePricingMap())).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// toDailyCostPoints
// ---------------------------------------------------------------------------

describe("toDailyCostPoints", () => {
  const pm = makePricingMap();

  it("returns empty array for empty rows", () => {
    expect(toDailyCostPoints([], pm)).toEqual([]);
  });

  it("computes cost for a single day with one row", () => {
    // claude-sonnet-4-20250514: input=$3/M, output=$15/M, cached=$0.3/M
    // Non-cached input = 100k - 20k = 80k
    // inputCost  = 80_000 / 1M * 3   = 0.24
    // outputCost = 50_000 / 1M * 15   = 0.75
    // cachedCost = 20_000 / 1M * 0.3  = 0.006
    // totalCost = 0.996
    const rows = [makeRow()];
    const result = toDailyCostPoints(rows, pm);
    expect(result).toHaveLength(1);
    expect(result[0]!.date).toBe("2026-03-10");
    expect(result[0]!.totalCost).toBeCloseTo(0.996, 3);
    expect(result[0]!.inputCost).toBeCloseTo(0.24, 3);
    expect(result[0]!.outputCost).toBeCloseTo(0.75, 3);
    expect(result[0]!.cachedCost).toBeCloseTo(0.006, 3);
  });

  it("aggregates multiple rows on the same day", () => {
    const rows = [
      makeRow({ hour_start: "2026-03-10", input_tokens: 100_000, cached_input_tokens: 0, output_tokens: 0 }),
      makeRow({ hour_start: "2026-03-10", input_tokens: 0, cached_input_tokens: 0, output_tokens: 100_000 }),
    ];
    const result = toDailyCostPoints(rows, pm);
    expect(result).toHaveLength(1);
    // First:  input 100k * $3/M = $0.30
    // Second: output 100k * $15/M = $1.50
    expect(result[0]!.inputCost).toBeCloseTo(0.30, 3);
    expect(result[0]!.outputCost).toBeCloseTo(1.50, 3);
    expect(result[0]!.totalCost).toBeCloseTo(1.80, 3);
  });

  it("handles multiple days sorted by date", () => {
    const rows = [
      makeRow({ hour_start: "2026-03-12", input_tokens: 100_000, cached_input_tokens: 0, output_tokens: 0 }),
      makeRow({ hour_start: "2026-03-10", input_tokens: 200_000, cached_input_tokens: 0, output_tokens: 0 }),
      makeRow({ hour_start: "2026-03-11", input_tokens: 300_000, cached_input_tokens: 0, output_tokens: 0 }),
    ];
    const result = toDailyCostPoints(rows, pm);
    expect(result).toHaveLength(3);
    // Sorted ascending by date
    expect(result[0]!.date).toBe("2026-03-10");
    expect(result[1]!.date).toBe("2026-03-11");
    expect(result[2]!.date).toBe("2026-03-12");
    // 200k input * $3/M = $0.60
    expect(result[0]!.totalCost).toBeCloseTo(0.60, 3);
  });

  it("handles multiple models on the same day with different pricing", () => {
    const rows = [
      makeRow({ hour_start: "2026-03-10", model: "claude-sonnet-4-20250514", input_tokens: 1_000_000, cached_input_tokens: 0, output_tokens: 0 }),
      makeRow({ hour_start: "2026-03-10", model: "gemini-2.5-pro", source: "gemini-cli", input_tokens: 1_000_000, cached_input_tokens: 0, output_tokens: 0 }),
    ];
    const result = toDailyCostPoints(rows, pm);
    expect(result).toHaveLength(1);
    // Sonnet: 1M * $3/M = $3.00
    // Gemini: 1M * $1.25/M = $1.25
    expect(result[0]!.inputCost).toBeCloseTo(4.25, 2);
    expect(result[0]!.totalCost).toBeCloseTo(4.25, 2);
  });

  it("handles zero token rows without errors", () => {
    const rows = [
      makeRow({ input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, total_tokens: 0 }),
    ];
    const result = toDailyCostPoints(rows, pm);
    expect(result).toHaveLength(1);
    expect(result[0]!.totalCost).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeCacheSavings
// ---------------------------------------------------------------------------

describe("computeCacheSavings", () => {
  const pm = makePricingMap();

  it("returns zero savings when no cached tokens", () => {
    const models = [makeAggregate({ cached: 0 })];
    const result = computeCacheSavings(models, pm);
    expect(result.savedDollars).toBe(0);
    expect(result.actualCachedCost).toBe(0);
    expect(result.netSavings).toBe(0);
    expect(result.savingsPercent).toBe(0);
  });

  it("computes savings for partial cache hits", () => {
    // claude-sonnet-4-20250514: input=$3/M, cached=$0.3/M
    // cached=200_000 → hypothetical full cost = 200k / 1M * $3 = $0.60
    // actual cached cost = 200k / 1M * $0.3 = $0.06
    // net savings = $0.60 - $0.06 = $0.54
    // savingsPercent = 0.54 / 0.60 * 100 = 90%
    const models = [makeAggregate({ cached: 200_000 })];
    const result = computeCacheSavings(models, pm);
    expect(result.savedDollars).toBeCloseTo(0.60, 3);
    expect(result.actualCachedCost).toBeCloseTo(0.06, 3);
    expect(result.netSavings).toBeCloseTo(0.54, 3);
    expect(result.savingsPercent).toBeCloseTo(90, 1);
  });

  it("computes savings with full cache (all input cached)", () => {
    // 1M cached tokens at sonnet-4: full=$3.00, cached=$0.30, net=$2.70
    const models = [makeAggregate({ input: 1_000_000, cached: 1_000_000 })];
    const result = computeCacheSavings(models, pm);
    expect(result.savedDollars).toBeCloseTo(3.0, 2);
    expect(result.actualCachedCost).toBeCloseTo(0.3, 2);
    expect(result.netSavings).toBeCloseTo(2.7, 2);
    expect(result.savingsPercent).toBeCloseTo(90, 1);
  });

  it("sums savings across multiple models", () => {
    // sonnet-4: 200k cached → full=$0.60, cached=$0.06, net=$0.54
    // gemini-2.5-pro: 400k cached → full=400k/1M*$1.25=$0.50, cached=400k/1M*$0.31=$0.124, net=$0.376
    const models = [
      makeAggregate({ model: "claude-sonnet-4-20250514", cached: 200_000 }),
      makeAggregate({ model: "gemini-2.5-pro", source: "gemini-cli", cached: 400_000 }),
    ];
    const result = computeCacheSavings(models, pm);
    expect(result.savedDollars).toBeCloseTo(1.10, 2);
    expect(result.actualCachedCost).toBeCloseTo(0.184, 3);
    expect(result.netSavings).toBeCloseTo(0.916, 3);
  });
});

// ---------------------------------------------------------------------------
// forecastMonthlyCost
// ---------------------------------------------------------------------------

function makeCostPoint(date: string, totalCost: number): DailyCostPoint {
  return { date, inputCost: totalCost * 0.6, outputCost: totalCost * 0.3, cachedCost: totalCost * 0.1, totalCost };
}

describe("forecastMonthlyCost", () => {
  it("returns null for empty data", () => {
    const result = forecastMonthlyCost([], new Date("2026-03-15"));
    expect(result).toBeNull();
  });

  it("returns null when fewer than 3 days elapsed", () => {
    const points = [
      makeCostPoint("2026-03-01", 5),
      makeCostPoint("2026-03-02", 10),
    ];
    const result = forecastMonthlyCost(points, new Date("2026-03-02"));
    expect(result).toBeNull();
  });

  it("projects mid-month cost correctly", () => {
    // 10 days in, $10/day average = $310 projected (31 days in March)
    const points = Array.from({ length: 10 }, (_, i) =>
      makeCostPoint(`2026-03-${String(i + 1).padStart(2, "0")}`, 10),
    );
    const result = forecastMonthlyCost(points, new Date("2026-03-10"));
    expect(result).not.toBeNull();
    expect(result!.currentMonthCost).toBeCloseTo(100, 1);
    expect(result!.daysElapsed).toBe(10);
    expect(result!.daysInMonth).toBe(31);
    expect(result!.dailyAverage).toBeCloseTo(10, 1);
    expect(result!.projectedMonthCost).toBeCloseTo(310, 1);
  });

  it("projects end-of-month correctly", () => {
    // All 31 days of March with $5/day = $155 total, projected $155
    const points = Array.from({ length: 31 }, (_, i) =>
      makeCostPoint(`2026-03-${String(i + 1).padStart(2, "0")}`, 5),
    );
    const result = forecastMonthlyCost(points, new Date("2026-03-31"));
    expect(result).not.toBeNull();
    expect(result!.currentMonthCost).toBeCloseTo(155, 1);
    expect(result!.projectedMonthCost).toBeCloseTo(155, 1);
  });

  it("handles February (28 days in non-leap year 2026)", () => {
    const points = Array.from({ length: 7 }, (_, i) =>
      makeCostPoint(`2026-02-${String(i + 1).padStart(2, "0")}`, 4),
    );
    const result = forecastMonthlyCost(points, new Date("2026-02-07"));
    expect(result).not.toBeNull();
    expect(result!.daysInMonth).toBe(28);
    expect(result!.projectedMonthCost).toBeCloseTo(112, 1); // 4 * 28
  });

  it("filters out data from other months", () => {
    // Points from Feb and March, "now" is March 5
    const points = [
      makeCostPoint("2026-02-28", 100),  // should be ignored
      makeCostPoint("2026-03-01", 10),
      makeCostPoint("2026-03-02", 10),
      makeCostPoint("2026-03-03", 10),
      makeCostPoint("2026-03-04", 10),
      makeCostPoint("2026-03-05", 10),
    ];
    const result = forecastMonthlyCost(points, new Date("2026-03-05"));
    expect(result).not.toBeNull();
    expect(result!.currentMonthCost).toBeCloseTo(50, 1);
    expect(result!.daysElapsed).toBe(5);
  });
});
