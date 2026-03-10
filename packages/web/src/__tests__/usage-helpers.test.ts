import { describe, it, expect } from "vitest";
import {
  toDailyPoints,
  toSourceAggregates,
  toHeatmapData,
  toModelAggregates,
  sourceLabel,
  type UsageRow,
} from "@/hooks/use-usage-data";
import { toLocalDailyBuckets, compareWeekdayWeekend, computeMoMGrowth, computeStreak, toSourceTrendPoints, toDominantSourceTimeline } from "@/lib/usage-helpers";
import { getDefaultPricingMap } from "@/lib/pricing";
import type { PricingMap } from "@/lib/pricing";

// ---------------------------------------------------------------------------
// Test data factory
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<UsageRow> = {}): UsageRow {
  return {
    source: "claude-code",
    model: "claude-sonnet-4-20250514",
    hour_start: "2026-03-07",
    input_tokens: 1000,
    cached_input_tokens: 200,
    output_tokens: 500,
    reasoning_output_tokens: 0,
    total_tokens: 1700,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// toDailyPoints
// ---------------------------------------------------------------------------

describe("toDailyPoints", () => {
  it("should return empty array for empty input", () => {
    expect(toDailyPoints([])).toEqual([]);
  });

  it("should aggregate records by date", () => {
    const records: UsageRow[] = [
      makeRow({ hour_start: "2026-03-07T00:00:00Z", input_tokens: 100, output_tokens: 50, cached_input_tokens: 10, reasoning_output_tokens: 0, total_tokens: 160 }),
      makeRow({ hour_start: "2026-03-07T12:00:00Z", input_tokens: 200, output_tokens: 100, cached_input_tokens: 20, reasoning_output_tokens: 0, total_tokens: 320 }),
      makeRow({ hour_start: "2026-03-08T00:00:00Z", input_tokens: 300, output_tokens: 150, cached_input_tokens: 30, reasoning_output_tokens: 0, total_tokens: 480 }),
    ];

    const daily = toDailyPoints(records);

    expect(daily).toHaveLength(2);
    expect(daily[0]!.date).toBe("2026-03-07");
    expect(daily[0]!.input).toBe(300);
    expect(daily[0]!.output).toBe(150);
    expect(daily[0]!.cached).toBe(30);
    expect(daily[1]!.date).toBe("2026-03-08");
    expect(daily[1]!.input).toBe(300);
  });

  it("should sort by date ascending", () => {
    const records = [
      makeRow({ hour_start: "2026-03-09" }),
      makeRow({ hour_start: "2026-03-07" }),
      makeRow({ hour_start: "2026-03-08" }),
    ];

    const daily = toDailyPoints(records);

    expect(daily.map((d) => d.date)).toEqual([
      "2026-03-07",
      "2026-03-08",
      "2026-03-09",
    ]);
  });
});

// ---------------------------------------------------------------------------
// toSourceAggregates
// ---------------------------------------------------------------------------

describe("toSourceAggregates", () => {
  it("should return empty array for empty input", () => {
    expect(toSourceAggregates([])).toEqual([]);
  });

  it("should aggregate by source and sort by total descending", () => {
    const records = [
      makeRow({ source: "claude-code", total_tokens: 1000 }),
      makeRow({ source: "gemini-cli", total_tokens: 3000 }),
      makeRow({ source: "claude-code", total_tokens: 2000 }),
      makeRow({ source: "opencode", total_tokens: 500 }),
    ];

    const result = toSourceAggregates(records);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ label: "claude-code", value: 3000 });
    expect(result[1]).toEqual({ label: "gemini-cli", value: 3000 });
    expect(result[2]).toEqual({ label: "opencode", value: 500 });
  });
});

// ---------------------------------------------------------------------------
// toHeatmapData
// ---------------------------------------------------------------------------

describe("toHeatmapData", () => {
  it("should convert daily points to heatmap format", () => {
    const daily = [
      { date: "2026-03-07", input: 100, output: 50, cached: 10, reasoning: 0, total: 160 },
      { date: "2026-03-08", input: 200, output: 100, cached: 20, reasoning: 0, total: 320 },
    ];

    const heatmap = toHeatmapData(daily);

    expect(heatmap).toEqual([
      { date: "2026-03-07", value: 160 },
      { date: "2026-03-08", value: 320 },
    ]);
  });

  it("should return empty array for empty input", () => {
    expect(toHeatmapData([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// toModelAggregates
// ---------------------------------------------------------------------------

describe("toModelAggregates", () => {
  it("should return empty array for empty input", () => {
    expect(toModelAggregates([])).toEqual([]);
  });

  it("should aggregate by source:model key", () => {
    const records = [
      makeRow({ source: "claude-code", model: "sonnet-4", input_tokens: 100, output_tokens: 50, cached_input_tokens: 10, total_tokens: 160 }),
      makeRow({ source: "claude-code", model: "sonnet-4", input_tokens: 200, output_tokens: 100, cached_input_tokens: 20, total_tokens: 320 }),
      makeRow({ source: "opencode", model: "gpt-4.1", input_tokens: 500, output_tokens: 250, cached_input_tokens: 50, total_tokens: 800 }),
    ];

    const result = toModelAggregates(records);

    expect(result).toHaveLength(2);
    // Sorted by total descending
    expect(result[0]!.model).toBe("gpt-4.1");
    expect(result[0]!.source).toBe("opencode");
    expect(result[0]!.total).toBe(800);
    expect(result[1]!.model).toBe("sonnet-4");
    expect(result[1]!.total).toBe(480);
    expect(result[1]!.input).toBe(300);
    expect(result[1]!.output).toBe(150);
    expect(result[1]!.cached).toBe(30);
  });

  it("should sort by total tokens descending", () => {
    const records = [
      makeRow({ source: "a", model: "small", total_tokens: 100 }),
      makeRow({ source: "b", model: "large", total_tokens: 5000 }),
      makeRow({ source: "c", model: "medium", total_tokens: 1000 }),
    ];

    const result = toModelAggregates(records);
    expect(result.map((r) => r.model)).toEqual(["large", "medium", "small"]);
  });
});

// ---------------------------------------------------------------------------
// sourceLabel
// ---------------------------------------------------------------------------

describe("sourceLabel", () => {
  it("should return human-readable names for known sources", () => {
    expect(sourceLabel("claude-code")).toBe("Claude Code");
    expect(sourceLabel("codex")).toBe("Codex");
    expect(sourceLabel("gemini-cli")).toBe("Gemini CLI");
    expect(sourceLabel("opencode")).toBe("OpenCode");
    expect(sourceLabel("openclaw")).toBe("OpenClaw");
  });

  it("should return raw string for unknown sources", () => {
    expect(sourceLabel("something-else")).toBe("something-else");
  });
});

// ---------------------------------------------------------------------------
// toLocalDailyBuckets
// ---------------------------------------------------------------------------

describe("toLocalDailyBuckets", () => {
  it("should return empty array for empty input", () => {
    expect(toLocalDailyBuckets([])).toEqual([]);
  });

  it("should bucket rows by UTC date when tzOffset is 0", () => {
    const rows = [
      makeRow({ hour_start: "2026-03-07T10:00:00Z", total_tokens: 100, input_tokens: 80, output_tokens: 20, cached_input_tokens: 10 }),
      makeRow({ hour_start: "2026-03-07T22:00:00Z", total_tokens: 200, input_tokens: 160, output_tokens: 40, cached_input_tokens: 20 }),
      makeRow({ hour_start: "2026-03-08T05:00:00Z", total_tokens: 300, input_tokens: 240, output_tokens: 60, cached_input_tokens: 30 }),
    ];

    const result = toLocalDailyBuckets(rows, 0);

    expect(result).toHaveLength(2);
    expect(result[0]!.date).toBe("2026-03-07");
    expect(result[0]!.totalTokens).toBe(300);
    expect(result[1]!.date).toBe("2026-03-08");
    expect(result[1]!.totalTokens).toBe(300);
  });

  it("should shift records across midnight for positive tzOffset (west of UTC)", () => {
    // tzOffset=480 means UTC-8 (PST). A record at 2026-03-08T03:00Z is
    // 2026-03-07T19:00 PST — should land in 2026-03-07 bucket.
    const rows = [
      makeRow({ hour_start: "2026-03-08T03:00:00Z", total_tokens: 500, input_tokens: 400, output_tokens: 100, cached_input_tokens: 50 }),
    ];

    const result = toLocalDailyBuckets(rows, 480);

    expect(result).toHaveLength(1);
    expect(result[0]!.date).toBe("2026-03-07");
    expect(result[0]!.totalTokens).toBe(500);
  });

  it("should shift records across midnight for negative tzOffset (east of UTC)", () => {
    // tzOffset=-540 means UTC+9 (JST). A record at 2026-03-07T20:00Z is
    // 2026-03-08T05:00 JST — should land in 2026-03-08 bucket.
    const rows = [
      makeRow({ hour_start: "2026-03-07T20:00:00Z", total_tokens: 700, input_tokens: 560, output_tokens: 140, cached_input_tokens: 70 }),
    ];

    const result = toLocalDailyBuckets(rows, -540);

    expect(result).toHaveLength(1);
    expect(result[0]!.date).toBe("2026-03-08");
    expect(result[0]!.totalTokens).toBe(700);
  });

  it("should aggregate multiple rows into same local day", () => {
    // Both are UTC-8, same local day 2026-03-07
    const rows = [
      makeRow({ hour_start: "2026-03-07T18:00:00Z", total_tokens: 100, input_tokens: 80, output_tokens: 20, cached_input_tokens: 10 }),
      makeRow({ hour_start: "2026-03-08T02:00:00Z", total_tokens: 200, input_tokens: 160, output_tokens: 40, cached_input_tokens: 20 }),
    ];

    const result = toLocalDailyBuckets(rows, 480);

    expect(result).toHaveLength(1);
    expect(result[0]!.date).toBe("2026-03-07");
    expect(result[0]!.totalTokens).toBe(300);
    expect(result[0]!.inputTokens).toBe(240);
    expect(result[0]!.outputTokens).toBe(60);
    expect(result[0]!.cachedTokens).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// compareWeekdayWeekend
// ---------------------------------------------------------------------------

describe("compareWeekdayWeekend", () => {
  function makePricingMap(): PricingMap {
    return getDefaultPricingMap();
  }

  it("should return zeros for empty input", () => {
    const result = compareWeekdayWeekend(
      [],
      { from: "2026-03-02", to: "2026-03-08" }, // Mon-Sun = 5 weekdays + 2 weekend
      makePricingMap(),
    );

    expect(result.weekday.avgTokens).toBe(0);
    expect(result.weekday.avgCost).toBe(0);
    expect(result.weekday.totalDays).toBe(5);
    expect(result.weekend.avgTokens).toBe(0);
    expect(result.weekend.avgCost).toBe(0);
    expect(result.weekend.totalDays).toBe(2);
    expect(result.ratio).toBe(0);
  });

  it("should compute averages for all-weekday data", () => {
    // 2026-03-02 (Mon) to 2026-03-06 (Fri) = 5 weekdays, 0 weekend
    // But range also has no weekend days, so weekend totalDays=0
    const rows = [
      makeRow({ hour_start: "2026-03-02T10:00:00Z", total_tokens: 1000, input_tokens: 800, output_tokens: 200, cached_input_tokens: 100 }),
      makeRow({ hour_start: "2026-03-04T14:00:00Z", total_tokens: 2000, input_tokens: 1600, output_tokens: 400, cached_input_tokens: 200 }),
    ];

    const result = compareWeekdayWeekend(
      rows,
      { from: "2026-03-02", to: "2026-03-06" },
      makePricingMap(),
    );

    // 3000 total tokens across 5 weekdays = 600 avg
    expect(result.weekday.avgTokens).toBe(600);
    expect(result.weekday.totalDays).toBe(5);
    expect(result.weekend.avgTokens).toBe(0);
    expect(result.weekend.totalDays).toBe(0);
    // ratio: weekday/weekend — weekend is 0, so Infinity clamped to 0 or special
    expect(result.ratio).toBe(0); // 0 weekend → ratio=0
  });

  it("should compute averages for all-weekend data", () => {
    // 2026-03-07 is Saturday, 2026-03-08 is Sunday
    const rows = [
      makeRow({ hour_start: "2026-03-07T10:00:00Z", total_tokens: 500, input_tokens: 400, output_tokens: 100, cached_input_tokens: 50 }),
      makeRow({ hour_start: "2026-03-08T10:00:00Z", total_tokens: 700, input_tokens: 560, output_tokens: 140, cached_input_tokens: 70 }),
    ];

    const result = compareWeekdayWeekend(
      rows,
      { from: "2026-03-07", to: "2026-03-08" },
      makePricingMap(),
    );

    expect(result.weekday.avgTokens).toBe(0);
    expect(result.weekday.totalDays).toBe(0);
    // 1200 tokens across 2 weekend days = 600 avg
    expect(result.weekend.avgTokens).toBe(600);
    expect(result.weekend.totalDays).toBe(2);
    expect(result.ratio).toBe(0); // 0 weekday → ratio=0
  });

  it("should compute mixed weekday/weekend stats with calendar fill", () => {
    // 2026-03-02 (Mon) to 2026-03-08 (Sun) = 5 weekdays + 2 weekend
    // Data only on Mon and Sat — other days get zero-filled
    const rows = [
      makeRow({ hour_start: "2026-03-02T10:00:00Z", total_tokens: 5000, input_tokens: 4000, output_tokens: 1000, cached_input_tokens: 500 }),
      makeRow({ hour_start: "2026-03-07T10:00:00Z", total_tokens: 2000, input_tokens: 1600, output_tokens: 400, cached_input_tokens: 200 }),
    ];

    const result = compareWeekdayWeekend(
      rows,
      { from: "2026-03-02", to: "2026-03-08" },
      makePricingMap(),
    );

    // Weekday: 5000 tokens / 5 days = 1000 avg
    expect(result.weekday.avgTokens).toBe(1000);
    expect(result.weekday.totalDays).toBe(5);
    // Weekend: 2000 tokens / 2 days = 1000 avg
    expect(result.weekend.avgTokens).toBe(1000);
    expect(result.weekend.totalDays).toBe(2);
    // ratio: 1000/1000 = 1.0
    expect(result.ratio).toBeCloseTo(1.0);
    // Cost should be > 0 for both
    expect(result.weekday.avgCost).toBeGreaterThan(0);
    expect(result.weekend.avgCost).toBeGreaterThan(0);
  });

  it("should handle midnight boundary with tzOffset", () => {
    // 2026-03-08 is Sunday in UTC, but in PST (UTC-8), a record at
    // 2026-03-08T03:00Z is actually 2026-03-07T19:00 PST = Saturday.
    // Date range: 2026-03-07 (Sat) to 2026-03-07 (Sat) in local time
    const rows = [
      makeRow({ hour_start: "2026-03-08T03:00:00Z", total_tokens: 1000, input_tokens: 800, output_tokens: 200, cached_input_tokens: 100 }),
    ];

    const result = compareWeekdayWeekend(
      rows,
      { from: "2026-03-07", to: "2026-03-07" }, // Saturday only
      makePricingMap(),
      480, // PST (UTC-8)
    );

    // Saturday is weekend: 1000 tokens / 1 day = 1000
    expect(result.weekend.avgTokens).toBe(1000);
    expect(result.weekend.totalDays).toBe(1);
    expect(result.weekday.avgTokens).toBe(0);
    expect(result.weekday.totalDays).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeMoMGrowth
// ---------------------------------------------------------------------------

describe("computeMoMGrowth", () => {
  function makePricingMap(): PricingMap {
    return getDefaultPricingMap();
  }

  it("should return zeros for empty input", () => {
    const result = computeMoMGrowth([], makePricingMap(), new Date("2026-03-15"));

    expect(result.currentMonth.tokens).toBe(0);
    expect(result.currentMonth.cost).toBe(0);
    expect(result.currentMonth.days).toBe(0);
    expect(result.previousMonth.tokens).toBe(0);
    expect(result.previousMonth.cost).toBe(0);
    expect(result.previousMonth.days).toBe(0);
    expect(result.tokenGrowth).toBe(0);
    expect(result.costGrowth).toBe(0);
  });

  it("should split rows into current and previous month", () => {
    const rows = [
      // February (previous)
      makeRow({ hour_start: "2026-02-10T10:00:00Z", total_tokens: 1000, input_tokens: 800, output_tokens: 200, cached_input_tokens: 100 }),
      makeRow({ hour_start: "2026-02-20T10:00:00Z", total_tokens: 2000, input_tokens: 1600, output_tokens: 400, cached_input_tokens: 200 }),
      // March (current)
      makeRow({ hour_start: "2026-03-05T10:00:00Z", total_tokens: 4000, input_tokens: 3200, output_tokens: 800, cached_input_tokens: 400 }),
      makeRow({ hour_start: "2026-03-10T10:00:00Z", total_tokens: 2000, input_tokens: 1600, output_tokens: 400, cached_input_tokens: 200 }),
    ];

    const result = computeMoMGrowth(rows, makePricingMap(), new Date("2026-03-15"));

    expect(result.previousMonth.tokens).toBe(3000);
    expect(result.previousMonth.days).toBe(2);
    expect(result.currentMonth.tokens).toBe(6000);
    expect(result.currentMonth.days).toBe(2);
    // Growth: (6000 - 3000) / 3000 * 100 = 100%
    expect(result.tokenGrowth).toBeCloseTo(100);
    expect(result.currentMonth.cost).toBeGreaterThan(0);
    expect(result.previousMonth.cost).toBeGreaterThan(0);
  });

  it("should handle no previous month data (first month)", () => {
    const rows = [
      makeRow({ hour_start: "2026-03-05T10:00:00Z", total_tokens: 5000, input_tokens: 4000, output_tokens: 1000, cached_input_tokens: 500 }),
    ];

    const result = computeMoMGrowth(rows, makePricingMap(), new Date("2026-03-15"));

    expect(result.currentMonth.tokens).toBe(5000);
    expect(result.previousMonth.tokens).toBe(0);
    // No previous data → growth = 0 (not Infinity)
    expect(result.tokenGrowth).toBe(0);
    expect(result.costGrowth).toBe(0);
  });

  it("should handle no current month data", () => {
    const rows = [
      makeRow({ hour_start: "2026-02-10T10:00:00Z", total_tokens: 3000, input_tokens: 2400, output_tokens: 600, cached_input_tokens: 300 }),
    ];

    const result = computeMoMGrowth(rows, makePricingMap(), new Date("2026-03-15"));

    expect(result.previousMonth.tokens).toBe(3000);
    expect(result.currentMonth.tokens).toBe(0);
    // Growth: (0 - 3000) / 3000 * 100 = -100%
    expect(result.tokenGrowth).toBeCloseTo(-100);
  });

  it("should default now to current date", () => {
    // Just verify it doesn't throw without the now param
    const result = computeMoMGrowth([], makePricingMap());
    expect(result.tokenGrowth).toBe(0);
  });

  it("should count distinct active days per month", () => {
    const rows = [
      // Same day in Feb — should count as 1 day
      makeRow({ hour_start: "2026-02-10T08:00:00Z", total_tokens: 500, input_tokens: 400, output_tokens: 100, cached_input_tokens: 50 }),
      makeRow({ hour_start: "2026-02-10T16:00:00Z", total_tokens: 500, input_tokens: 400, output_tokens: 100, cached_input_tokens: 50 }),
      // Two days in March
      makeRow({ hour_start: "2026-03-01T10:00:00Z", total_tokens: 1000, input_tokens: 800, output_tokens: 200, cached_input_tokens: 100 }),
      makeRow({ hour_start: "2026-03-05T10:00:00Z", total_tokens: 1000, input_tokens: 800, output_tokens: 200, cached_input_tokens: 100 }),
    ];

    const result = computeMoMGrowth(rows, makePricingMap(), new Date("2026-03-15"));

    expect(result.previousMonth.days).toBe(1);
    expect(result.currentMonth.days).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// computeStreak
// ---------------------------------------------------------------------------

describe("computeStreak", () => {
  it("should return zeros for empty input", () => {
    const result = computeStreak([], "2026-03-10");

    expect(result.currentStreak).toBe(0);
    expect(result.longestStreak).toBe(0);
    expect(result.longestStreakStart).toBe("");
    expect(result.longestStreakEnd).toBe("");
    expect(result.isActiveToday).toBe(false);
  });

  it("should detect single-day current streak (active today)", () => {
    const rows = [
      makeRow({ hour_start: "2026-03-10T10:00:00Z", total_tokens: 1000, input_tokens: 800, output_tokens: 200, cached_input_tokens: 100 }),
    ];

    const result = computeStreak(rows, "2026-03-10");

    expect(result.currentStreak).toBe(1);
    expect(result.longestStreak).toBe(1);
    expect(result.isActiveToday).toBe(true);
  });

  it("should detect multi-day consecutive streak", () => {
    const rows = [
      makeRow({ hour_start: "2026-03-07T10:00:00Z", total_tokens: 100, input_tokens: 80, output_tokens: 20, cached_input_tokens: 10 }),
      makeRow({ hour_start: "2026-03-08T10:00:00Z", total_tokens: 200, input_tokens: 160, output_tokens: 40, cached_input_tokens: 20 }),
      makeRow({ hour_start: "2026-03-09T10:00:00Z", total_tokens: 300, input_tokens: 240, output_tokens: 60, cached_input_tokens: 30 }),
      makeRow({ hour_start: "2026-03-10T10:00:00Z", total_tokens: 400, input_tokens: 320, output_tokens: 80, cached_input_tokens: 40 }),
    ];

    const result = computeStreak(rows, "2026-03-10");

    expect(result.currentStreak).toBe(4);
    expect(result.longestStreak).toBe(4);
    expect(result.longestStreakStart).toBe("2026-03-07");
    expect(result.longestStreakEnd).toBe("2026-03-10");
    expect(result.isActiveToday).toBe(true);
  });

  it("should count current streak from yesterday if not active today", () => {
    const rows = [
      makeRow({ hour_start: "2026-03-08T10:00:00Z", total_tokens: 100, input_tokens: 80, output_tokens: 20, cached_input_tokens: 10 }),
      makeRow({ hour_start: "2026-03-09T10:00:00Z", total_tokens: 200, input_tokens: 160, output_tokens: 40, cached_input_tokens: 20 }),
    ];

    const result = computeStreak(rows, "2026-03-10");

    expect(result.currentStreak).toBe(2);
    expect(result.isActiveToday).toBe(false);
  });

  it("should track longest streak separately from current", () => {
    // Longest streak: Mar 1-5 (5 days), gap on Mar 6, current: Mar 7-10 (4 days)
    const rows = [
      makeRow({ hour_start: "2026-03-01T10:00:00Z", total_tokens: 100, input_tokens: 80, output_tokens: 20, cached_input_tokens: 10 }),
      makeRow({ hour_start: "2026-03-02T10:00:00Z", total_tokens: 100, input_tokens: 80, output_tokens: 20, cached_input_tokens: 10 }),
      makeRow({ hour_start: "2026-03-03T10:00:00Z", total_tokens: 100, input_tokens: 80, output_tokens: 20, cached_input_tokens: 10 }),
      makeRow({ hour_start: "2026-03-04T10:00:00Z", total_tokens: 100, input_tokens: 80, output_tokens: 20, cached_input_tokens: 10 }),
      makeRow({ hour_start: "2026-03-05T10:00:00Z", total_tokens: 100, input_tokens: 80, output_tokens: 20, cached_input_tokens: 10 }),
      // gap on Mar 6
      makeRow({ hour_start: "2026-03-07T10:00:00Z", total_tokens: 100, input_tokens: 80, output_tokens: 20, cached_input_tokens: 10 }),
      makeRow({ hour_start: "2026-03-08T10:00:00Z", total_tokens: 100, input_tokens: 80, output_tokens: 20, cached_input_tokens: 10 }),
      makeRow({ hour_start: "2026-03-09T10:00:00Z", total_tokens: 100, input_tokens: 80, output_tokens: 20, cached_input_tokens: 10 }),
      makeRow({ hour_start: "2026-03-10T10:00:00Z", total_tokens: 100, input_tokens: 80, output_tokens: 20, cached_input_tokens: 10 }),
    ];

    const result = computeStreak(rows, "2026-03-10");

    expect(result.currentStreak).toBe(4);
    expect(result.longestStreak).toBe(5);
    expect(result.longestStreakStart).toBe("2026-03-01");
    expect(result.longestStreakEnd).toBe("2026-03-05");
    expect(result.isActiveToday).toBe(true);
  });

  it("should handle timezone offset shifting dates across midnight", () => {
    // In PST (UTC-8), a record at 2026-03-11T03:00Z is actually
    // 2026-03-10T19:00 PST → should count as Mar 10 activity
    const rows = [
      makeRow({ hour_start: "2026-03-10T18:00:00Z", total_tokens: 100, input_tokens: 80, output_tokens: 20, cached_input_tokens: 10 }), // Mar 10 10:00 PST
      makeRow({ hour_start: "2026-03-11T03:00:00Z", total_tokens: 200, input_tokens: 160, output_tokens: 40, cached_input_tokens: 20 }), // Mar 10 19:00 PST
    ];

    const result = computeStreak(rows, "2026-03-10", 480); // PST

    expect(result.currentStreak).toBe(1);
    expect(result.isActiveToday).toBe(true);
    expect(result.longestStreak).toBe(1);
  });

  it("should return 0 current streak when gap is more than 1 day from today", () => {
    const rows = [
      makeRow({ hour_start: "2026-03-05T10:00:00Z", total_tokens: 100, input_tokens: 80, output_tokens: 20, cached_input_tokens: 10 }),
      makeRow({ hour_start: "2026-03-06T10:00:00Z", total_tokens: 100, input_tokens: 80, output_tokens: 20, cached_input_tokens: 10 }),
    ];

    // Today is Mar 10, last activity Mar 6 — gap of 4 days
    const result = computeStreak(rows, "2026-03-10");

    expect(result.currentStreak).toBe(0);
    expect(result.longestStreak).toBe(2);
    expect(result.isActiveToday).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// toSourceTrendPoints
// ---------------------------------------------------------------------------

describe("toSourceTrendPoints", () => {
  it("should return empty array for empty input", () => {
    expect(toSourceTrendPoints([])).toEqual([]);
  });

  it("should group single source by date", () => {
    const rows = [
      makeRow({ source: "claude-code", hour_start: "2026-03-07T10:00:00Z", total_tokens: 1000 }),
      makeRow({ source: "claude-code", hour_start: "2026-03-07T14:00:00Z", total_tokens: 2000 }),
      makeRow({ source: "claude-code", hour_start: "2026-03-08T09:00:00Z", total_tokens: 500 }),
    ];
    const result = toSourceTrendPoints(rows);
    expect(result).toHaveLength(2);
    expect(result[0]!.date).toBe("2026-03-07");
    expect(result[0]!.sources["claude-code"]).toBe(3000);
    expect(result[1]!.date).toBe("2026-03-08");
    expect(result[1]!.sources["claude-code"]).toBe(500);
  });

  it("should handle multiple sources on the same dates", () => {
    const rows = [
      makeRow({ source: "claude-code", hour_start: "2026-03-07T10:00:00Z", total_tokens: 1000 }),
      makeRow({ source: "gemini-cli", hour_start: "2026-03-07T12:00:00Z", total_tokens: 2000 }),
      makeRow({ source: "claude-code", hour_start: "2026-03-08T09:00:00Z", total_tokens: 300 }),
    ];
    const result = toSourceTrendPoints(rows);
    expect(result).toHaveLength(2);
    // Day 1: both sources
    expect(result[0]!.sources["claude-code"]).toBe(1000);
    expect(result[0]!.sources["gemini-cli"]).toBe(2000);
    // Day 2: only claude-code, gemini-cli should be 0 (zero-filled)
    expect(result[1]!.sources["claude-code"]).toBe(300);
    expect(result[1]!.sources["gemini-cli"]).toBe(0);
  });

  it("should sort by date ascending", () => {
    const rows = [
      makeRow({ source: "claude-code", hour_start: "2026-03-09T10:00:00Z", total_tokens: 100 }),
      makeRow({ source: "claude-code", hour_start: "2026-03-07T10:00:00Z", total_tokens: 200 }),
    ];
    const result = toSourceTrendPoints(rows);
    expect(result[0]!.date).toBe("2026-03-07");
    expect(result[1]!.date).toBe("2026-03-09");
  });
});

// ---------------------------------------------------------------------------
// toDominantSourceTimeline
// ---------------------------------------------------------------------------

describe("toDominantSourceTimeline", () => {
  it("should return empty array for empty input", () => {
    expect(toDominantSourceTimeline([])).toEqual([]);
  });

  it("should identify clear dominant source per day", () => {
    const rows = [
      makeRow({ source: "claude-code", hour_start: "2026-03-07T10:00:00Z", total_tokens: 5000 }),
      makeRow({ source: "gemini-cli", hour_start: "2026-03-07T14:00:00Z", total_tokens: 1000 }),
      makeRow({ source: "opencode", hour_start: "2026-03-08T09:00:00Z", total_tokens: 3000 }),
      makeRow({ source: "claude-code", hour_start: "2026-03-08T11:00:00Z", total_tokens: 1000 }),
    ];
    const result = toDominantSourceTimeline(rows);
    expect(result).toHaveLength(2);

    // Day 1: claude-code dominates with 5000/6000 = 83.3%
    expect(result[0]!.date).toBe("2026-03-07");
    expect(result[0]!.dominantSource).toBe("claude-code");
    expect(result[0]!.dominantShare).toBeCloseTo(83.33, 0);
    expect(result[0]!.sources["claude-code"]).toBe(5000);
    expect(result[0]!.sources["gemini-cli"]).toBe(1000);

    // Day 2: opencode dominates with 3000/4000 = 75%
    expect(result[1]!.date).toBe("2026-03-08");
    expect(result[1]!.dominantSource).toBe("opencode");
    expect(result[1]!.dominantShare).toBeCloseTo(75, 0);
  });

  it("should pick first source alphabetically when tied", () => {
    const rows = [
      makeRow({ source: "opencode", hour_start: "2026-03-07T10:00:00Z", total_tokens: 2000 }),
      makeRow({ source: "claude-code", hour_start: "2026-03-07T14:00:00Z", total_tokens: 2000 }),
    ];
    const result = toDominantSourceTimeline(rows);
    expect(result).toHaveLength(1);
    // Tied at 50% each — pick alphabetically first: "claude-code"
    expect(result[0]!.dominantSource).toBe("claude-code");
    expect(result[0]!.dominantShare).toBeCloseTo(50, 0);
  });

  it("should handle single source per day", () => {
    const rows = [
      makeRow({ source: "claude-code", hour_start: "2026-03-07T10:00:00Z", total_tokens: 3000 }),
      makeRow({ source: "claude-code", hour_start: "2026-03-07T14:00:00Z", total_tokens: 2000 }),
    ];
    const result = toDominantSourceTimeline(rows);
    expect(result).toHaveLength(1);
    expect(result[0]!.dominantSource).toBe("claude-code");
    expect(result[0]!.dominantShare).toBeCloseTo(100, 0);
    expect(result[0]!.sources["claude-code"]).toBe(5000);
  });

  it("should sort by date ascending", () => {
    const rows = [
      makeRow({ source: "claude-code", hour_start: "2026-03-09T10:00:00Z", total_tokens: 1000 }),
      makeRow({ source: "opencode", hour_start: "2026-03-07T10:00:00Z", total_tokens: 2000 }),
    ];
    const result = toDominantSourceTimeline(rows);
    expect(result[0]!.date).toBe("2026-03-07");
    expect(result[1]!.date).toBe("2026-03-09");
  });
});
