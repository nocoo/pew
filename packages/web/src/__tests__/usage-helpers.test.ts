import { describe, it, expect } from "vitest";
import {
  toDailyPoints,
  toSourceAggregates,
  toHeatmapData,
  toModelAggregates,
  sourceLabel,
  type UsageRow,
} from "@/hooks/use-usage-data";
import {
  toLocalDailyBuckets,
  compareWeekdayWeekend,
  computeMoMGrowth,
  computeWoWGrowth,
  computeStreak,
  toSourceTrendPoints,
  toDominantSourceTimeline,
  groupByModel,
  groupByAgent,
  groupByDate,
  extractSources,
  extractModels,
  toHourlyWeekdayWeekend,
  toLocalDateStr,
} from "@/lib/usage-helpers";
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

  it("should shift records across midnight for positive tzOffset (UTC-8 PST)", () => {
    // 2026-03-08T03:00Z → 2026-03-07T19:00 PST → local date 2026-03-07
    const records = [
      makeRow({ hour_start: "2026-03-07T20:00:00Z", input_tokens: 100, output_tokens: 50, cached_input_tokens: 10, reasoning_output_tokens: 0, total_tokens: 160 }),
      makeRow({ hour_start: "2026-03-08T03:00:00Z", input_tokens: 200, output_tokens: 100, cached_input_tokens: 20, reasoning_output_tokens: 0, total_tokens: 320 }),
    ];

    const daily = toDailyPoints(records, 480); // UTC-8

    expect(daily).toHaveLength(1);
    expect(daily[0]!.date).toBe("2026-03-07");
    expect(daily[0]!.input).toBe(300);
    expect(daily[0]!.total).toBe(480);
  });

  it("should shift records across midnight for negative tzOffset (UTC+9 JST)", () => {
    // 2026-03-07T20:00Z → 2026-03-08T05:00 JST → local date 2026-03-08
    const records = [
      makeRow({ hour_start: "2026-03-07T20:00:00Z", input_tokens: 500, output_tokens: 200, cached_input_tokens: 50, reasoning_output_tokens: 0, total_tokens: 750 }),
    ];

    const daily = toDailyPoints(records, -540); // UTC+9

    expect(daily).toHaveLength(1);
    expect(daily[0]!.date).toBe("2026-03-08");
    expect(daily[0]!.total).toBe(750);
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
    expect(result[0]).toEqual({ source: "claude-code", label: "claude-code", value: 3000 });
    expect(result[1]).toEqual({ source: "gemini-cli", label: "gemini-cli", value: 3000 });
    expect(result[2]).toEqual({ source: "opencode", label: "opencode", value: 500 });
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
    expect(sourceLabel("vscode-copilot")).toBe("VS Code Copilot");
    expect(sourceLabel("copilot-cli")).toBe("GitHub Copilot CLI");
    expect(sourceLabel("hermes")).toBe("Hermes Agent");
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
    expect(result.previousMonthSameDate.tokens).toBe(0);
    expect(result.previousMonthSameDate.cost).toBe(0);
    expect(result.previousMonthSameDate.days).toBe(0);
    expect(result.tokenGrowth).toBe(0);
    expect(result.costGrowth).toBe(0);
    expect(result.sameDateTokenGrowth).toBe(0);
    expect(result.sameDateCostGrowth).toBe(0);
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

  it("should compute same-date comparison (only previous month days <= current day)", () => {
    // ref date = March 15 → only include Feb 1-15 for same-date comparison
    const rows = [
      // February: day 5 (included), day 10 (included), day 20 (excluded)
      makeRow({ hour_start: "2026-02-05T10:00:00Z", total_tokens: 1000, input_tokens: 800, output_tokens: 200, cached_input_tokens: 100 }),
      makeRow({ hour_start: "2026-02-10T10:00:00Z", total_tokens: 1000, input_tokens: 800, output_tokens: 200, cached_input_tokens: 100 }),
      makeRow({ hour_start: "2026-02-20T10:00:00Z", total_tokens: 3000, input_tokens: 2400, output_tokens: 600, cached_input_tokens: 300 }),
      // March (current): day 5 and day 10
      makeRow({ hour_start: "2026-03-05T10:00:00Z", total_tokens: 2000, input_tokens: 1600, output_tokens: 400, cached_input_tokens: 200 }),
      makeRow({ hour_start: "2026-03-10T10:00:00Z", total_tokens: 2000, input_tokens: 1600, output_tokens: 400, cached_input_tokens: 200 }),
    ];

    const result = computeMoMGrowth(rows, makePricingMap(), new Date("2026-03-15"));

    // Full month: prev=5000, cur=4000 → tokenGrowth = -20%
    expect(result.previousMonth.tokens).toBe(5000);
    expect(result.currentMonth.tokens).toBe(4000);
    expect(result.tokenGrowth).toBeCloseTo(-20);

    // Same-date (Feb 1-15 only): prev=2000, cur=4000 → sameDateTokenGrowth = +100%
    expect(result.previousMonthSameDate.tokens).toBe(2000);
    expect(result.previousMonthSameDate.days).toBe(2);
    expect(result.sameDateTokenGrowth).toBeCloseTo(100);
  });

  it("should include previous month day equal to current day in same-date subset", () => {
    // ref date = March 15 → Feb 15 should be INCLUDED (d <= currentDay)
    const rows = [
      makeRow({ hour_start: "2026-02-15T10:00:00Z", total_tokens: 1000, input_tokens: 800, output_tokens: 200, cached_input_tokens: 100 }),
      makeRow({ hour_start: "2026-03-10T10:00:00Z", total_tokens: 2000, input_tokens: 1600, output_tokens: 400, cached_input_tokens: 200 }),
    ];

    const result = computeMoMGrowth(rows, makePricingMap(), new Date("2026-03-15"));

    expect(result.previousMonthSameDate.tokens).toBe(1000);
    expect(result.sameDateTokenGrowth).toBeCloseTo(100);
  });

  it("should return zero same-date growth when no previous same-date data", () => {
    // ref date = March 2 → only Feb 1-2 for same-date; all Feb data is after day 2
    const rows = [
      makeRow({ hour_start: "2026-02-15T10:00:00Z", total_tokens: 3000, input_tokens: 2400, output_tokens: 600, cached_input_tokens: 300 }),
      makeRow({ hour_start: "2026-03-01T10:00:00Z", total_tokens: 1000, input_tokens: 800, output_tokens: 200, cached_input_tokens: 100 }),
    ];

    const result = computeMoMGrowth(rows, makePricingMap(), new Date("2026-03-02"));

    // Full month comparison still works
    expect(result.previousMonth.tokens).toBe(3000);
    expect(result.tokenGrowth).toBeCloseTo(-66.67, 1);

    // Same-date: no Feb data in days 1-2 → growth = 0
    expect(result.previousMonthSameDate.tokens).toBe(0);
    expect(result.sameDateTokenGrowth).toBe(0);
  });

  it("should assign UTC midnight row to previous month for west-of-UTC timezone (tzOffset=480, PST)", () => {
    // 2026-03-01T01:00:00Z → PST local = 2026-02-28T17:00:00 → February
    const rows = [
      makeRow({ hour_start: "2026-03-01T01:00:00Z", total_tokens: 1000, input_tokens: 800, output_tokens: 200, cached_input_tokens: 100 }),
    ];

    const result = computeMoMGrowth(rows, makePricingMap(), new Date("2026-03-15"), 480);

    // Should be assigned to February (previous month), not March
    expect(result.previousMonth.tokens).toBe(1000);
    expect(result.currentMonth.tokens).toBe(0);
  });

  it("should keep row in current month for east-of-UTC timezone (tzOffset=-540, JST)", () => {
    // 2026-02-28T20:00:00Z → JST local = 2026-03-01T05:00:00 → March
    const rows = [
      makeRow({ hour_start: "2026-02-28T20:00:00Z", total_tokens: 2000, input_tokens: 1600, output_tokens: 400, cached_input_tokens: 200 }),
    ];

    const result = computeMoMGrowth(rows, makePricingMap(), new Date("2026-03-15"), -540);

    // Should be assigned to March (current month), not February
    expect(result.currentMonth.tokens).toBe(2000);
    expect(result.previousMonth.tokens).toBe(0);
  });

  it("should match zero-offset behavior when tzOffset=0", () => {
    const rows = [
      makeRow({ hour_start: "2026-02-10T10:00:00Z", total_tokens: 1000, input_tokens: 800, output_tokens: 200, cached_input_tokens: 100 }),
      makeRow({ hour_start: "2026-03-05T10:00:00Z", total_tokens: 4000, input_tokens: 3200, output_tokens: 800, cached_input_tokens: 400 }),
    ];

    const withTz = computeMoMGrowth(rows, makePricingMap(), new Date("2026-03-15"), 0);
    const without = computeMoMGrowth(rows, makePricingMap(), new Date("2026-03-15"));

    expect(withTz.currentMonth.tokens).toBe(without.currentMonth.tokens);
    expect(withTz.previousMonth.tokens).toBe(without.previousMonth.tokens);
  });
});

// ---------------------------------------------------------------------------
// computeWoWGrowth
// ---------------------------------------------------------------------------

describe("computeWoWGrowth", () => {
  function makePricingMap(): PricingMap {
    return getDefaultPricingMap();
  }

  // 2026-03-18 is a Wednesday
  // With Sunday-start weeks:
  // Current week Sun: 2026-03-15 → Sat: 2026-03-21
  // Previous week Sun: 2026-03-08 → Sat: 2026-03-14

  it("should return zeros for empty input", () => {
    const result = computeWoWGrowth([], makePricingMap(), new Date("2026-03-18T12:00:00Z"));

    expect(result.currentWeek.tokens).toBe(0);
    expect(result.currentWeek.cost).toBe(0);
    expect(result.currentWeek.days).toBe(0);
    expect(result.previousWeek.tokens).toBe(0);
    expect(result.previousWeek.cost).toBe(0);
    expect(result.previousWeek.days).toBe(0);
    expect(result.previousWeekSameDay.tokens).toBe(0);
    expect(result.previousWeekSameDay.cost).toBe(0);
    expect(result.previousWeekSameDay.days).toBe(0);
    expect(result.tokenGrowth).toBe(0);
    expect(result.costGrowth).toBe(0);
    expect(result.sameDayTokenGrowth).toBe(0);
    expect(result.sameDayCostGrowth).toBe(0);
  });

  it("should split rows into current and previous week", () => {
    // With Sunday-start: current week = Sun Mar 15 → Wed Mar 18
    // Previous week = Sun Mar 8 → Sat Mar 14
    const rows = [
      // Previous week: Sun Mar 8 – Sat Mar 14
      makeRow({ hour_start: "2026-03-10T10:00:00Z", total_tokens: 1000, input_tokens: 800, output_tokens: 200, cached_input_tokens: 100 }),
      makeRow({ hour_start: "2026-03-12T10:00:00Z", total_tokens: 2000, input_tokens: 1600, output_tokens: 400, cached_input_tokens: 200 }),
      // Current week: Sun Mar 15 – Wed Mar 18
      makeRow({ hour_start: "2026-03-17T10:00:00Z", total_tokens: 4000, input_tokens: 3200, output_tokens: 800, cached_input_tokens: 400 }),
    ];

    const result = computeWoWGrowth(rows, makePricingMap(), new Date("2026-03-18T12:00:00Z"));

    expect(result.previousWeek.tokens).toBe(3000);
    expect(result.previousWeek.days).toBe(2);
    expect(result.currentWeek.tokens).toBe(4000);
    expect(result.currentWeek.days).toBe(1);
    // Growth: (4000 - 3000) / 3000 * 100 ≈ 33.33%
    expect(result.tokenGrowth).toBeCloseTo(33.33, 1);
    expect(result.currentWeek.cost).toBeGreaterThan(0);
    expect(result.previousWeek.cost).toBeGreaterThan(0);
  });

  it("should handle no previous week data", () => {
    const rows = [
      makeRow({ hour_start: "2026-03-17T10:00:00Z", total_tokens: 5000, input_tokens: 4000, output_tokens: 1000, cached_input_tokens: 500 }),
    ];

    const result = computeWoWGrowth(rows, makePricingMap(), new Date("2026-03-18T12:00:00Z"));

    expect(result.currentWeek.tokens).toBe(5000);
    expect(result.previousWeek.tokens).toBe(0);
    expect(result.tokenGrowth).toBe(0);
    expect(result.costGrowth).toBe(0);
  });

  it("should handle no current week data", () => {
    const rows = [
      makeRow({ hour_start: "2026-03-10T10:00:00Z", total_tokens: 3000, input_tokens: 2400, output_tokens: 600, cached_input_tokens: 300 }),
    ];

    const result = computeWoWGrowth(rows, makePricingMap(), new Date("2026-03-18T12:00:00Z"));

    expect(result.previousWeek.tokens).toBe(3000);
    expect(result.currentWeek.tokens).toBe(0);
    // Growth: (0 - 3000) / 3000 * 100 = -100%
    expect(result.tokenGrowth).toBeCloseTo(-100);
  });

  it("should count distinct active days per week", () => {
    // With Sunday-start: prev week = Sun Mar 8 – Sat Mar 14, cur week = Sun Mar 15 – Wed Mar 18
    const rows = [
      // Same day in prev week — should count as 1 day
      makeRow({ hour_start: "2026-03-10T08:00:00Z", total_tokens: 500, input_tokens: 400, output_tokens: 100, cached_input_tokens: 50 }),
      makeRow({ hour_start: "2026-03-10T16:00:00Z", total_tokens: 500, input_tokens: 400, output_tokens: 100, cached_input_tokens: 50 }),
      // Two days in current week (Sun Mar 15 and Tue Mar 17)
      makeRow({ hour_start: "2026-03-15T10:00:00Z", total_tokens: 1000, input_tokens: 800, output_tokens: 200, cached_input_tokens: 100 }),
      makeRow({ hour_start: "2026-03-17T10:00:00Z", total_tokens: 1000, input_tokens: 800, output_tokens: 200, cached_input_tokens: 100 }),
    ];

    const result = computeWoWGrowth(rows, makePricingMap(), new Date("2026-03-18T12:00:00Z"));

    expect(result.previousWeek.days).toBe(1);
    expect(result.currentWeek.days).toBe(2);
  });

  it("should compute same-day comparison (previous week up to same day-of-week)", () => {
    // ref = Wed Mar 18, dow=3 (Sun=0, Mon=1, Tue=2, Wed=3)
    // With Sunday-start: current week = Sun Mar 15 → Wed Mar 18
    // Previous week = Sun Mar 8 → Sat Mar 14
    // Same-day cutoff = prev Sun + 3 = Wed Mar 11
    // So same-day subset includes: Sun Mar 8, Mon Mar 9, Tue Mar 10, Wed Mar 11
    const rows = [
      // Previous week: Sun Mar 8 (included in same-day), Wed Mar 11 (included in same-day), Fri Mar 13 (excluded from same-day)
      makeRow({ hour_start: "2026-03-08T10:00:00Z", total_tokens: 1000, input_tokens: 800, output_tokens: 200, cached_input_tokens: 100 }),
      makeRow({ hour_start: "2026-03-11T10:00:00Z", total_tokens: 1000, input_tokens: 800, output_tokens: 200, cached_input_tokens: 100 }),
      makeRow({ hour_start: "2026-03-13T10:00:00Z", total_tokens: 3000, input_tokens: 2400, output_tokens: 600, cached_input_tokens: 300 }),
      // Current week: Sun Mar 15, Wed Mar 18
      makeRow({ hour_start: "2026-03-15T10:00:00Z", total_tokens: 2000, input_tokens: 1600, output_tokens: 400, cached_input_tokens: 200 }),
      makeRow({ hour_start: "2026-03-18T10:00:00Z", total_tokens: 2000, input_tokens: 1600, output_tokens: 400, cached_input_tokens: 200 }),
    ];

    const result = computeWoWGrowth(rows, makePricingMap(), new Date("2026-03-18T12:00:00Z"));

    // Full week: prev=5000, cur=4000 → tokenGrowth = -20%
    expect(result.previousWeek.tokens).toBe(5000);
    expect(result.currentWeek.tokens).toBe(4000);
    expect(result.tokenGrowth).toBeCloseTo(-20);

    // Same-day (Sun-Wed only): prev=2000 (Mar 8 + Mar 11), cur=4000 → sameDayTokenGrowth = +100%
    expect(result.previousWeekSameDay.tokens).toBe(2000);
    expect(result.previousWeekSameDay.days).toBe(2);
    expect(result.sameDayTokenGrowth).toBeCloseTo(100);
  });

  it("should include same day-of-week in same-day subset (boundary test)", () => {
    // ref = Wed Mar 18 → prev week Wed = Mar 11 should be INCLUDED
    // With Sunday-start: prev week = Sun Mar 8 – Sat Mar 14
    const rows = [
      makeRow({ hour_start: "2026-03-11T10:00:00Z", total_tokens: 1000, input_tokens: 800, output_tokens: 200, cached_input_tokens: 100 }),
      // Current week (Sun Mar 15)
      makeRow({ hour_start: "2026-03-15T10:00:00Z", total_tokens: 2000, input_tokens: 1600, output_tokens: 400, cached_input_tokens: 200 }),
    ];

    const result = computeWoWGrowth(rows, makePricingMap(), new Date("2026-03-18T12:00:00Z"));

    expect(result.previousWeekSameDay.tokens).toBe(1000);
    expect(result.sameDayTokenGrowth).toBeCloseTo(100);
  });

  it("should return zero same-day growth when no previous same-day data", () => {
    // ref = Sun Mar 15 (dow=0) → same-day cutoff = Sun of prev week = Mar 8
    // With Sunday-start: prev week = Sun Mar 8 – Sat Mar 14
    // All prev week data is after Sunday (Mar 12)
    const rows = [
      makeRow({ hour_start: "2026-03-12T10:00:00Z", total_tokens: 3000, input_tokens: 2400, output_tokens: 600, cached_input_tokens: 300 }),
      makeRow({ hour_start: "2026-03-15T10:00:00Z", total_tokens: 1000, input_tokens: 800, output_tokens: 200, cached_input_tokens: 100 }),
    ];

    const result = computeWoWGrowth(rows, makePricingMap(), new Date("2026-03-15T12:00:00Z"));

    // Full week comparison still works
    expect(result.previousWeek.tokens).toBe(3000);
    expect(result.tokenGrowth).toBeCloseTo(-66.67, 1);

    // Same-day: only Sun Mar 8 would count, but no data there → growth = 0
    expect(result.previousWeekSameDay.tokens).toBe(0);
    expect(result.sameDayTokenGrowth).toBe(0);
  });

  it("should handle Saturday reference (full previous week is same-day subset)", () => {
    // 2026-03-14 is a Saturday, dow=6 (last day of the week in Sunday-start)
    // With Sunday-start: current week = Sun Mar 8 → Sat Mar 14
    // Previous week = Sun Mar 1 → Sat Mar 7
    // Same-day cutoff = prev Sun + 6 = prev Sat = Mar 7 (entire prev week)
    const rows = [
      makeRow({ hour_start: "2026-03-03T10:00:00Z", total_tokens: 1000, input_tokens: 800, output_tokens: 200, cached_input_tokens: 100 }),
      makeRow({ hour_start: "2026-03-07T10:00:00Z", total_tokens: 2000, input_tokens: 1600, output_tokens: 400, cached_input_tokens: 200 }),
      makeRow({ hour_start: "2026-03-10T10:00:00Z", total_tokens: 5000, input_tokens: 4000, output_tokens: 1000, cached_input_tokens: 500 }),
    ];

    const result = computeWoWGrowth(rows, makePricingMap(), new Date("2026-03-14T12:00:00Z"));

    // Previous week: Sun Mar 1 – Sat Mar 7 → 1000 + 2000 = 3000
    expect(result.previousWeek.tokens).toBe(3000);
    // Same-day subset = entire previous week (dow=6, cutoff = Sat)
    expect(result.previousWeekSameDay.tokens).toBe(3000);
    // Current week: Sun Mar 8 – Sat Mar 14 → 5000
    expect(result.currentWeek.tokens).toBe(5000);
  });

  it("should assign UTC midnight row to previous week for west-of-UTC timezone (tzOffset=480, PST)", () => {
    // 2026-03-15T01:00:00Z → PST local = 2026-03-14T17:00:00 → Saturday → previous week
    // ref = 2026-03-18 (Wed), with Sunday-start: current week = Sun Mar 15 → Sat Mar 21
    // Previous week = Sun Mar 8 → Sat Mar 14
    const rows = [
      makeRow({ hour_start: "2026-03-15T01:00:00Z", total_tokens: 1000, input_tokens: 800, output_tokens: 200, cached_input_tokens: 100 }),
    ];

    const result = computeWoWGrowth(rows, makePricingMap(), new Date("2026-03-18T12:00:00Z"), 480);

    // Should be assigned to previous week (Saturday in PST = Mar 14), not current week
    expect(result.previousWeek.tokens).toBe(1000);
    expect(result.currentWeek.tokens).toBe(0);
  });

  it("should keep row in current week for east-of-UTC timezone (tzOffset=-540, JST)", () => {
    // 2026-03-14T20:00:00Z → JST local = 2026-03-15T05:00:00 → Sunday → current week start
    // ref = 2026-03-18 (Wed), with Sunday-start: current week = Sun Mar 15 → Sat Mar 21
    const rows = [
      makeRow({ hour_start: "2026-03-14T20:00:00Z", total_tokens: 2000, input_tokens: 1600, output_tokens: 400, cached_input_tokens: 200 }),
    ];

    const result = computeWoWGrowth(rows, makePricingMap(), new Date("2026-03-18T12:00:00Z"), -540);

    // Should be assigned to current week (Sunday in JST = Mar 15), not previous week
    expect(result.currentWeek.tokens).toBe(2000);
    expect(result.previousWeek.tokens).toBe(0);
  });

  it("should default now to current date", () => {
    const result = computeWoWGrowth([], makePricingMap());
    expect(result.tokenGrowth).toBe(0);
  });

  it("should match zero-offset behavior when tzOffset=0", () => {
    const rows = [
      makeRow({ hour_start: "2026-03-10T10:00:00Z", total_tokens: 1000, input_tokens: 800, output_tokens: 200, cached_input_tokens: 100 }),
      makeRow({ hour_start: "2026-03-17T10:00:00Z", total_tokens: 4000, input_tokens: 3200, output_tokens: 800, cached_input_tokens: 400 }),
    ];

    const withTz = computeWoWGrowth(rows, makePricingMap(), new Date("2026-03-18T12:00:00Z"), 0);
    const without = computeWoWGrowth(rows, makePricingMap(), new Date("2026-03-18T12:00:00Z"));

    expect(withTz.currentWeek.tokens).toBe(without.currentWeek.tokens);
    expect(withTz.previousWeek.tokens).toBe(without.previousWeek.tokens);
  });
});

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

  it("should shift records across midnight with tzOffset (UTC-8)", () => {
    // 2026-03-08T03:00Z → 2026-03-07T19:00 PST → local date 2026-03-07
    const rows = [
      makeRow({ source: "claude-code", hour_start: "2026-03-07T20:00:00Z", total_tokens: 1000 }),
      makeRow({ source: "claude-code", hour_start: "2026-03-08T03:00:00Z", total_tokens: 2000 }),
    ];
    const result = toSourceTrendPoints(rows, 480); // UTC-8

    expect(result).toHaveLength(1);
    expect(result[0]!.date).toBe("2026-03-07");
    expect(result[0]!.sources["claude-code"]).toBe(3000);
  });

  it("should shift records across midnight with tzOffset (UTC+9)", () => {
    // 2026-03-07T20:00Z → 2026-03-08T05:00 JST → local date 2026-03-08
    const rows = [
      makeRow({ source: "claude-code", hour_start: "2026-03-07T10:00:00Z", total_tokens: 1000 }),
      makeRow({ source: "claude-code", hour_start: "2026-03-07T20:00:00Z", total_tokens: 2000 }),
    ];
    const result = toSourceTrendPoints(rows, -540); // UTC+9

    expect(result).toHaveLength(2);
    expect(result[0]!.date).toBe("2026-03-07");
    expect(result[0]!.sources["claude-code"]).toBe(1000);
    expect(result[1]!.date).toBe("2026-03-08");
    expect(result[1]!.sources["claude-code"]).toBe(2000);
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

  it("should shift records across midnight with tzOffset (UTC-8)", () => {
    // 2026-03-08T03:00Z → 2026-03-07T19:00 PST → local date 2026-03-07
    const rows = [
      makeRow({ source: "claude-code", hour_start: "2026-03-07T20:00:00Z", total_tokens: 5000 }),
      makeRow({ source: "gemini-cli", hour_start: "2026-03-08T03:00:00Z", total_tokens: 1000 }),
    ];
    const result = toDominantSourceTimeline(rows, 480); // UTC-8

    expect(result).toHaveLength(1);
    expect(result[0]!.date).toBe("2026-03-07");
    expect(result[0]!.dominantSource).toBe("claude-code");
    expect(result[0]!.sources["claude-code"]).toBe(5000);
    expect(result[0]!.sources["gemini-cli"]).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// groupByModel
// ---------------------------------------------------------------------------

describe("groupByModel", () => {
  function makePricingMap(): PricingMap {
    return getDefaultPricingMap();
  }

  it("should return empty array for empty input", () => {
    expect(groupByModel([], makePricingMap())).toEqual([]);
  });

  it("should group records by model and compute aggregates", () => {
    const rows = [
      makeRow({ model: "claude-sonnet-4-20250514", source: "claude-code", input_tokens: 1000, output_tokens: 500, cached_input_tokens: 200, total_tokens: 1700 }),
      makeRow({ model: "claude-sonnet-4-20250514", source: "opencode", input_tokens: 2000, output_tokens: 1000, cached_input_tokens: 400, total_tokens: 3400 }),
      makeRow({ model: "gpt-4.1", source: "opencode", input_tokens: 500, output_tokens: 250, cached_input_tokens: 100, total_tokens: 850 }),
    ];

    const result = groupByModel(rows, makePricingMap());

    expect(result).toHaveLength(2);
    // Sorted by totalTokens descending
    expect(result[0]!.model).toBe("claude-sonnet-4-20250514");
    expect(result[0]!.totalTokens).toBe(5100);
    expect(result[0]!.inputTokens).toBe(3000);
    expect(result[0]!.outputTokens).toBe(1500);
    expect(result[0]!.cachedTokens).toBe(600);
    expect(result[0]!.sources).toContain("claude-code");
    expect(result[0]!.sources).toContain("opencode");
    expect(result[0]!.estimatedCost).toBeGreaterThan(0);

    expect(result[1]!.model).toBe("gpt-4.1");
    expect(result[1]!.totalTokens).toBe(850);
  });

  it("should compute pctOfTotal correctly", () => {
    const rows = [
      makeRow({ model: "model-a", total_tokens: 7500, input_tokens: 5000, output_tokens: 2500, cached_input_tokens: 0 }),
      makeRow({ model: "model-b", total_tokens: 2500, input_tokens: 2000, output_tokens: 500, cached_input_tokens: 0 }),
    ];

    const result = groupByModel(rows, makePricingMap());

    // model-a: 7500 / 10000 = 75%
    expect(result[0]!.pctOfTotal).toBeCloseTo(75, 0);
    // model-b: 2500 / 10000 = 25%
    expect(result[1]!.pctOfTotal).toBeCloseTo(25, 0);
  });

  it("should handle single record", () => {
    const rows = [
      makeRow({ model: "test-model", total_tokens: 1000, input_tokens: 800, output_tokens: 200, cached_input_tokens: 100 }),
    ];

    const result = groupByModel(rows, makePricingMap());

    expect(result).toHaveLength(1);
    expect(result[0]!.pctOfTotal).toBeCloseTo(100, 0);
  });

  it("should return 0 pctOfTotal when grandTotal is 0", () => {
    const rows = [
      makeRow({ model: "test-model", total_tokens: 0, input_tokens: 0, output_tokens: 0, cached_input_tokens: 0 }),
    ];

    const result = groupByModel(rows, makePricingMap());

    expect(result).toHaveLength(1);
    expect(result[0]!.pctOfTotal).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// groupByAgent
// ---------------------------------------------------------------------------

describe("groupByAgent", () => {
  function makePricingMap(): PricingMap {
    return getDefaultPricingMap();
  }

  it("should return empty array for empty input", () => {
    expect(groupByAgent([], makePricingMap())).toEqual([]);
  });

  it("should group records by source and compute aggregates", () => {
    const rows = [
      makeRow({ source: "claude-code", model: "sonnet-4", input_tokens: 1000, output_tokens: 500, cached_input_tokens: 200, total_tokens: 1700 }),
      makeRow({ source: "claude-code", model: "opus-4", input_tokens: 2000, output_tokens: 1000, cached_input_tokens: 400, total_tokens: 3400 }),
      makeRow({ source: "opencode", model: "gpt-4.1", input_tokens: 500, output_tokens: 250, cached_input_tokens: 100, total_tokens: 850 }),
    ];

    const result = groupByAgent(rows, makePricingMap());

    expect(result).toHaveLength(2);
    // Sorted by totalTokens descending
    expect(result[0]!.source).toBe("claude-code");
    expect(result[0]!.label).toBe("Claude Code");
    expect(result[0]!.totalTokens).toBe(5100);
    expect(result[0]!.inputTokens).toBe(3000);
    expect(result[0]!.outputTokens).toBe(1500);
    expect(result[0]!.cachedTokens).toBe(600);
    expect(result[0]!.records).toHaveLength(2);
    expect(result[0]!.estimatedCost).toBeGreaterThan(0);

    expect(result[1]!.source).toBe("opencode");
    expect(result[1]!.totalTokens).toBe(850);
  });

  it("should include nested models breakdown sorted by total descending", () => {
    const rows = [
      makeRow({ source: "claude-code", model: "sonnet-4", total_tokens: 1000, input_tokens: 800, output_tokens: 200, cached_input_tokens: 100 }),
      makeRow({ source: "claude-code", model: "opus-4", total_tokens: 3000, input_tokens: 2400, output_tokens: 600, cached_input_tokens: 300 }),
      makeRow({ source: "claude-code", model: "haiku-4", total_tokens: 500, input_tokens: 400, output_tokens: 100, cached_input_tokens: 50 }),
    ];

    const result = groupByAgent(rows, makePricingMap());

    expect(result).toHaveLength(1);
    expect(result[0]!.models).toHaveLength(3);
    // Sorted by total descending
    expect(result[0]!.models[0]!.model).toBe("opus-4");
    expect(result[0]!.models[0]!.total).toBe(3000);
    expect(result[0]!.models[1]!.model).toBe("sonnet-4");
    expect(result[0]!.models[1]!.total).toBe(1000);
    expect(result[0]!.models[2]!.model).toBe("haiku-4");
    expect(result[0]!.models[2]!.total).toBe(500);
  });

  it("should aggregate multiple records of same model within same source", () => {
    const rows = [
      makeRow({ source: "claude-code", model: "sonnet-4", input_tokens: 100, output_tokens: 50, cached_input_tokens: 10, total_tokens: 160 }),
      makeRow({ source: "claude-code", model: "sonnet-4", input_tokens: 200, output_tokens: 100, cached_input_tokens: 20, total_tokens: 320 }),
    ];

    const result = groupByAgent(rows, makePricingMap());

    expect(result).toHaveLength(1);
    expect(result[0]!.models).toHaveLength(1);
    expect(result[0]!.models[0]!.input).toBe(300);
    expect(result[0]!.models[0]!.output).toBe(150);
    expect(result[0]!.models[0]!.cached).toBe(30);
    expect(result[0]!.models[0]!.total).toBe(480);
  });
});

// ---------------------------------------------------------------------------
// groupByDate
// ---------------------------------------------------------------------------

describe("groupByDate", () => {
  function makePricingMap(): PricingMap {
    return getDefaultPricingMap();
  }

  it("should return empty array for empty input", () => {
    expect(groupByDate([], makePricingMap())).toEqual([]);
  });

  it("should group records by date and compute aggregates", () => {
    const rows = [
      makeRow({ hour_start: "2026-03-07T10:00:00Z", input_tokens: 1000, output_tokens: 500, cached_input_tokens: 200, total_tokens: 1700 }),
      makeRow({ hour_start: "2026-03-07T14:00:00Z", input_tokens: 500, output_tokens: 250, cached_input_tokens: 100, total_tokens: 850 }),
      makeRow({ hour_start: "2026-03-08T10:00:00Z", input_tokens: 2000, output_tokens: 1000, cached_input_tokens: 400, total_tokens: 3400 }),
    ];

    const result = groupByDate(rows, makePricingMap());

    expect(result).toHaveLength(2);
    // Sorted by date descending (newest first)
    expect(result[0]!.date).toBe("2026-03-08");
    expect(result[0]!.totalTokens).toBe(3400);
    expect(result[0]!.inputTokens).toBe(2000);
    expect(result[0]!.outputTokens).toBe(1000);
    expect(result[0]!.cachedTokens).toBe(400);
    expect(result[0]!.records).toHaveLength(1);
    expect(result[0]!.estimatedCost).toBeGreaterThan(0);

    expect(result[1]!.date).toBe("2026-03-07");
    expect(result[1]!.totalTokens).toBe(2550);
    expect(result[1]!.records).toHaveLength(2);
  });

  it("should apply tzOffset to shift dates across midnight", () => {
    // 2026-03-08T03:00Z → 2026-03-07T19:00 PST → local date 2026-03-07
    const rows = [
      makeRow({ hour_start: "2026-03-07T20:00:00Z", total_tokens: 1000, input_tokens: 800, output_tokens: 200, cached_input_tokens: 100 }),
      makeRow({ hour_start: "2026-03-08T03:00:00Z", total_tokens: 2000, input_tokens: 1600, output_tokens: 400, cached_input_tokens: 200 }),
    ];

    const result = groupByDate(rows, makePricingMap(), 480); // UTC-8

    expect(result).toHaveLength(1);
    expect(result[0]!.date).toBe("2026-03-07");
    expect(result[0]!.totalTokens).toBe(3000);
  });

  it("should handle bare date strings (day-granularity queries)", () => {
    const rows = [
      makeRow({ hour_start: "2026-03-07", total_tokens: 1000, input_tokens: 800, output_tokens: 200, cached_input_tokens: 100 }),
      makeRow({ hour_start: "2026-03-08", total_tokens: 2000, input_tokens: 1600, output_tokens: 400, cached_input_tokens: 200 }),
    ];

    // Even with tzOffset, bare dates should NOT be shifted
    const result = groupByDate(rows, makePricingMap(), 480);

    expect(result).toHaveLength(2);
    expect(result[0]!.date).toBe("2026-03-08");
    expect(result[1]!.date).toBe("2026-03-07");
  });
});

// ---------------------------------------------------------------------------
// extractSources
// ---------------------------------------------------------------------------

describe("extractSources", () => {
  it("should return empty array for empty input", () => {
    expect(extractSources([])).toEqual([]);
  });

  it("should extract unique sources sorted alphabetically", () => {
    const rows = [
      makeRow({ source: "opencode" }),
      makeRow({ source: "claude-code" }),
      makeRow({ source: "gemini-cli" }),
      makeRow({ source: "claude-code" }), // duplicate
    ];

    const result = extractSources(rows);

    expect(result).toEqual(["claude-code", "gemini-cli", "opencode"]);
  });

  it("should handle single source", () => {
    const rows = [
      makeRow({ source: "claude-code" }),
      makeRow({ source: "claude-code" }),
    ];

    const result = extractSources(rows);

    expect(result).toEqual(["claude-code"]);
  });
});

// ---------------------------------------------------------------------------
// extractModels
// ---------------------------------------------------------------------------

describe("extractModels", () => {
  it("should return empty array for empty input", () => {
    expect(extractModels([])).toEqual([]);
  });

  it("should extract unique models sorted alphabetically", () => {
    const rows = [
      makeRow({ model: "sonnet-4" }),
      makeRow({ model: "gpt-4.1" }),
      makeRow({ model: "opus-4" }),
      makeRow({ model: "sonnet-4" }), // duplicate
    ];

    const result = extractModels(rows);

    expect(result).toEqual(["gpt-4.1", "opus-4", "sonnet-4"]);
  });

  it("should handle single model", () => {
    const rows = [
      makeRow({ model: "sonnet-4" }),
      makeRow({ model: "sonnet-4" }),
    ];

    const result = extractModels(rows);

    expect(result).toEqual(["sonnet-4"]);
  });
});

// ---------------------------------------------------------------------------
// toHourlyWeekdayWeekend
// ---------------------------------------------------------------------------

describe("toHourlyWeekdayWeekend", () => {
  it("should return 24 hourly buckets for empty input", () => {
    const result = toHourlyWeekdayWeekend([], { from: "2026-03-02", to: "2026-03-08" });

    expect(result).toHaveLength(24);
    expect(result[0]!.hour).toBe(0);
    expect(result[0]!.weekday).toBe(0);
    expect(result[0]!.weekend).toBe(0);
    expect(result[23]!.hour).toBe(23);
  });

  it("should compute average hourly usage for weekdays and weekends", () => {
    // 2026-03-02 (Mon) to 2026-03-08 (Sun) = 5 weekdays + 2 weekend days
    // Add data at 10:00 on a weekday and a weekend day
    const rows = [
      // Weekday usage at 10:00 (March 2 is Monday)
      makeRow({ hour_start: "2026-03-02T10:00:00Z", total_tokens: 5000, input_tokens: 4000, output_tokens: 1000, cached_input_tokens: 500 }),
      // Weekend usage at 10:00 (March 7 is Saturday)
      makeRow({ hour_start: "2026-03-07T10:00:00Z", total_tokens: 2000, input_tokens: 1600, output_tokens: 400, cached_input_tokens: 200 }),
    ];

    const result = toHourlyWeekdayWeekend(rows, { from: "2026-03-02", to: "2026-03-08" });

    // Hour 10: weekday avg = 5000/5 = 1000, weekend avg = 2000/2 = 1000
    expect(result[10]!.weekday).toBe(1000);
    expect(result[10]!.weekend).toBe(1000);

    // Other hours should be 0
    expect(result[9]!.weekday).toBe(0);
    expect(result[9]!.weekend).toBe(0);
  });

  it("should accumulate multiple records in the same hour", () => {
    // 2026-03-02 (Mon) to 2026-03-02 (Mon) = 1 weekday
    const rows = [
      makeRow({ hour_start: "2026-03-02T14:00:00Z", total_tokens: 1000, input_tokens: 800, output_tokens: 200, cached_input_tokens: 100 }),
      makeRow({ hour_start: "2026-03-02T14:30:00Z", total_tokens: 2000, input_tokens: 1600, output_tokens: 400, cached_input_tokens: 200 }),
    ];

    const result = toHourlyWeekdayWeekend(rows, { from: "2026-03-02", to: "2026-03-02" });

    // Hour 14: 3000 tokens / 1 weekday = 3000
    expect(result[14]!.weekday).toBe(3000);
    expect(result[14]!.weekend).toBe(0);
  });

  it("should apply tzOffset to shift hours and days", () => {
    // 2026-03-02T01:00Z → PST = 2026-03-01T17:00 → hour 17, Sunday (prev day)
    // But our range is 2026-03-02 to 2026-03-02, so Sunday is not in the range
    // Let's use a simpler test: shift hour across midnight
    // 2026-03-07 (Sat) in UTC, but 2026-03-08T03:00Z → 2026-03-07T19:00 PST = hour 19, Saturday
    const rows = [
      makeRow({ hour_start: "2026-03-08T03:00:00Z", total_tokens: 4800, input_tokens: 3840, output_tokens: 960, cached_input_tokens: 480 }),
    ];

    const result = toHourlyWeekdayWeekend(rows, { from: "2026-03-07", to: "2026-03-07" }, 480); // UTC-8

    // In PST: hour 19 on Saturday (weekend), range has 0 weekdays, 1 weekend day
    expect(result[19]!.weekend).toBe(4800);
    expect(result[19]!.weekday).toBe(0);
  });

  it("should return 0 averages when range has no weekdays or weekends", () => {
    // 2026-03-07 (Sat) to 2026-03-08 (Sun) = 0 weekdays, 2 weekend days
    const rows = [
      makeRow({ hour_start: "2026-03-07T10:00:00Z", total_tokens: 2000, input_tokens: 1600, output_tokens: 400, cached_input_tokens: 200 }),
    ];

    const result = toHourlyWeekdayWeekend(rows, { from: "2026-03-07", to: "2026-03-08" });

    // No weekdays in range → weekday average = 0
    expect(result[10]!.weekday).toBe(0);
    expect(result[10]!.weekend).toBe(1000); // 2000 / 2 weekend days
  });

  it("should handle range with only weekdays", () => {
    // 2026-03-02 (Mon) to 2026-03-06 (Fri) = 5 weekdays, 0 weekend days
    const rows = [
      makeRow({ hour_start: "2026-03-03T08:00:00Z", total_tokens: 5000, input_tokens: 4000, output_tokens: 1000, cached_input_tokens: 500 }),
    ];

    const result = toHourlyWeekdayWeekend(rows, { from: "2026-03-02", to: "2026-03-06" });

    // Hour 8: 5000 / 5 weekdays = 1000
    expect(result[8]!.weekday).toBe(1000);
    // No weekend days → weekend average = 0
    expect(result[8]!.weekend).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// toLocalDateStr (edge cases)
// ---------------------------------------------------------------------------

describe("toLocalDateStr", () => {
  it("should return bare date as-is (no shift)", () => {
    // Bare dates from day-granularity queries should not be shifted
    expect(toLocalDateStr("2026-03-07", 480)).toBe("2026-03-07");
    expect(toLocalDateStr("2026-03-07", -540)).toBe("2026-03-07");
  });

  it("should return date portion when tzOffset is 0", () => {
    expect(toLocalDateStr("2026-03-07T14:30:00Z", 0)).toBe("2026-03-07");
  });

  it("should shift date for positive tzOffset (west of UTC)", () => {
    // 2026-03-08T03:00Z → UTC-8 = 2026-03-07T19:00 → date 2026-03-07
    expect(toLocalDateStr("2026-03-08T03:00:00Z", 480)).toBe("2026-03-07");
  });

  it("should shift date for negative tzOffset (east of UTC)", () => {
    // 2026-03-07T20:00Z → UTC+9 = 2026-03-08T05:00 → date 2026-03-08
    expect(toLocalDateStr("2026-03-07T20:00:00Z", -540)).toBe("2026-03-08");
  });
});
