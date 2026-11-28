import { describe, expect, it } from "vitest";
import {
  sourceLabel,
  toDailyPoints,
  toHeatmapData,
  toModelAggregates,
  toSourceAggregates,
  type UsageRow,
} from "@/hooks/use-usage-data";
import { getDefaultPricingMap } from "@/lib/pricing";
import {
  compareWeekdayWeekend,
  computeMoMGrowth,
  computeWoWGrowth,
  rankUsageByRecency,
  toDominantSourceTimeline,
  toHourlyWeekdayWeekend,
  toLocalDailyBuckets,
  toSourceTrendPoints,
} from "@/lib/usage-helpers";

const pricing = getDefaultPricingMap();

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

function rowAt(hour_start: string, total: number, extra: Partial<UsageRow> = {}): UsageRow {
  const input = Math.round(total * 0.8);
  const output = total - input;
  return makeRow({
    hour_start,
    total_tokens: total,
    input_tokens: input,
    output_tokens: output,
    cached_input_tokens: Math.round(total * 0.1),
    ...extra,
  });
}

describe("rankUsageByRecency", () => {
  it("ranks usage in the latest seven calendar days first, then walks backwards by week", () => {
    const samples = [
      { id: "retired", date: "2026-08-01", value: 1_000_000 },
      { id: "current", date: "2026-08-01", value: 1_000_000 },
      { id: "previous-week", date: "2026-09-08", value: 10_000 },
      { id: "regular", date: "2026-09-09", value: 80 },
      { id: "regular", date: "2026-09-11", value: 70 },
      { id: "z-tie", date: "2026-09-12", value: 100 },
      { id: "a-tie", date: "2026-09-13", value: 100 },
      { id: "current", date: "2026-09-15", value: 120 },
      { id: "one-off", date: "2026-09-15", value: 1 },
      { id: "empty", date: "2026-10-01", value: 0 },
    ];
    const expected = [
      "regular",
      "current",
      "a-tie",
      "z-tie",
      "one-off",
      "previous-week",
      "retired",
    ];
    expect(rankUsageByRecency(samples)).toEqual(expected);
    expect(rankUsageByRecency([...samples].reverse())).toEqual(expected);
    expect(rankUsageByRecency([])).toEqual([]);
    expect(rankUsageByRecency([{ id: "empty", date: "2026-09-15", value: 0 }])).toEqual([]);
  });
});

describe("toDailyPoints & toHeatmapData", () => {
  it("aggregates by date ascending, handles empty input, and converts to heatmap", () => {
    expect(toDailyPoints([])).toEqual([]);
    expect(toHeatmapData([])).toEqual([]);

    const daily = toDailyPoints([
      makeRow({
        hour_start: "2026-03-08T00:00:00Z",
        input_tokens: 300,
        output_tokens: 150,
        cached_input_tokens: 30,
        total_tokens: 480,
      }),
      makeRow({
        hour_start: "2026-03-07T12:00:00Z",
        input_tokens: 200,
        output_tokens: 100,
        cached_input_tokens: 20,
        total_tokens: 320,
      }),
      makeRow({
        hour_start: "2026-03-07T00:00:00Z",
        input_tokens: 100,
        output_tokens: 50,
        cached_input_tokens: 10,
        total_tokens: 160,
      }),
    ]);

    expect(daily).toHaveLength(2);
    expect(daily[0]).toMatchObject({
      date: "2026-03-07",
      input: 300,
      output: 150,
      cached: 30,
      total: 480,
    });
    expect(daily[1]).toMatchObject({ date: "2026-03-08", input: 300 });
    expect(toHeatmapData(daily)).toEqual([
      { date: "2026-03-07", value: 480 },
      { date: "2026-03-08", value: 480 },
    ]);
  });

  it.each([
    {
      tzOffset: 480,
      hours: ["2026-03-07T20:00:00Z", "2026-03-08T03:00:00Z"],
      expectedDate: "2026-03-07",
      expectedTotal: 480,
    },
    {
      tzOffset: -540,
      hours: ["2026-03-07T20:00:00Z"],
      expectedDate: "2026-03-08",
      expectedTotal: 240,
    },
  ])(
    "shifts records across midnight for tzOffset=$tzOffset",
    ({ tzOffset, hours, expectedDate, expectedTotal }) => {
      const daily = toDailyPoints(
        hours.map((h) => rowAt(h, 240)),
        tzOffset,
      );
      expect(daily).toHaveLength(1);
      expect(daily[0]).toMatchObject({ date: expectedDate, total: expectedTotal });
    },
  );
});

describe("toSourceAggregates, toModelAggregates & sourceLabel", () => {
  it("aggregates by source descending", () => {
    expect(toSourceAggregates([])).toEqual([]);
    const res = toSourceAggregates([
      makeRow({ source: "claude-code", total_tokens: 1000 }),
      makeRow({ source: "gemini-cli", total_tokens: 3000 }),
      makeRow({ source: "claude-code", total_tokens: 2000 }),
      makeRow({ source: "opencode", total_tokens: 500 }),
    ]);
    expect(res).toEqual([
      { source: "claude-code", label: "claude-code", value: 3000 },
      { source: "gemini-cli", label: "gemini-cli", value: 3000 },
      { source: "opencode", label: "opencode", value: 500 },
    ]);
  });

  it("aggregates by source:model with reasoning and sorts descending", () => {
    expect(toModelAggregates([])).toEqual([]);
    const res = toModelAggregates([
      makeRow({
        source: "claude-code",
        model: "sonnet-4",
        input_tokens: 100,
        output_tokens: 50,
        cached_input_tokens: 10,
        total_tokens: 160,
      }),
      makeRow({
        source: "claude-code",
        model: "sonnet-4",
        input_tokens: 200,
        output_tokens: 100,
        cached_input_tokens: 20,
        total_tokens: 320,
      }),
      makeRow({
        source: "opencode",
        model: "gpt-4.1",
        input_tokens: 500,
        output_tokens: 250,
        cached_input_tokens: 50,
        total_tokens: 800,
      }),
      makeRow({
        source: "grok",
        model: "grok-4.5",
        input_tokens: 100,
        output_tokens: 50,
        cached_input_tokens: 20,
        reasoning_output_tokens: 50,
        total_tokens: 220,
      }),
    ]);
    expect(res.map((r) => r.model)).toEqual(["gpt-4.1", "sonnet-4", "grok-4.5"]);
    expect(res[1]).toMatchObject({ total: 480, input: 300, output: 150, cached: 30, reasoning: 0 });
    expect(res[2]).toMatchObject({ source: "grok", reasoning: 50 });
  });

  it("maps known source labels and falls back for unknown", () => {
    const expected: Record<string, string> = {
      antigravity: "Antigravity",
      "claude-code": "Claude Code",
      codex: "Codex",
      "gemini-cli": "Gemini CLI",
      grok: "Grok",
      opencode: "OpenCode",
      openclaw: "OpenClaw",
      pi: "Pi",
      "vscode-copilot": "VS Code Copilot",
      "copilot-cli": "GitHub Copilot CLI",
      hermes: "Hermes Agent",
    };
    for (const [k, v] of Object.entries(expected)) expect(sourceLabel(k)).toBe(v);
    expect(sourceLabel("something-else")).toBe("something-else");
  });
});

describe("toLocalDailyBuckets", () => {
  it("buckets by UTC and local timezone across midnight", () => {
    expect(toLocalDailyBuckets([])).toEqual([]);

    const utc = toLocalDailyBuckets(
      [
        rowAt("2026-03-07T10:00:00Z", 100),
        rowAt("2026-03-07T22:00:00Z", 200),
        rowAt("2026-03-08T05:00:00Z", 300),
      ],
      0,
    );
    expect(utc.map((b) => [b.date, b.totalTokens])).toEqual([
      ["2026-03-07", 300],
      ["2026-03-08", 300],
    ]);

    const pst = toLocalDailyBuckets(
      [rowAt("2026-03-07T18:00:00Z", 100), rowAt("2026-03-08T03:00:00Z", 200)],
      480,
    );
    expect(pst).toHaveLength(1);
    expect(pst[0]).toMatchObject({
      date: "2026-03-07",
      totalTokens: 300,
      inputTokens: 240,
      outputTokens: 60,
      cachedTokens: 30,
    });

    const jst = toLocalDailyBuckets([rowAt("2026-03-07T20:00:00Z", 700)], -540);
    expect(jst[0]).toMatchObject({ date: "2026-03-08", totalTokens: 700 });
  });
});

describe("compareWeekdayWeekend", () => {
  it("handles empty, weekday-only, weekend-only, mixed calendar fill, and tzOffset boundary", () => {
    expect(
      compareWeekdayWeekend([], { from: "2026-03-02", to: "2026-03-08" }, pricing),
    ).toMatchObject({
      weekday: { avgTokens: 0, avgCost: 0, totalDays: 5 },
      weekend: { avgTokens: 0, avgCost: 0, totalDays: 2 },
      ratio: 0,
    });

    const weekdayOnly = compareWeekdayWeekend(
      [rowAt("2026-03-02T10:00:00Z", 1000), rowAt("2026-03-04T14:00:00Z", 2000)],
      { from: "2026-03-02", to: "2026-03-06" },
      pricing,
    );
    expect(weekdayOnly.weekday).toMatchObject({ avgTokens: 600, totalDays: 5 });
    expect(weekdayOnly.weekend).toMatchObject({ avgTokens: 0, totalDays: 0 });
    expect(weekdayOnly.ratio).toBe(0);

    const weekendOnly = compareWeekdayWeekend(
      [rowAt("2026-03-07T10:00:00Z", 500), rowAt("2026-03-08T10:00:00Z", 700)],
      { from: "2026-03-07", to: "2026-03-08" },
      pricing,
    );
    expect(weekendOnly.weekday.totalDays).toBe(0);
    expect(weekendOnly.weekend).toMatchObject({ avgTokens: 600, totalDays: 2 });
    expect(weekendOnly.ratio).toBe(0);

    const mixed = compareWeekdayWeekend(
      [rowAt("2026-03-02T10:00:00Z", 5000), rowAt("2026-03-07T10:00:00Z", 2000)],
      { from: "2026-03-02", to: "2026-03-08" },
      pricing,
    );
    expect(mixed.weekday.avgTokens).toBe(1000);
    expect(mixed.weekend.avgTokens).toBe(1000);
    expect(mixed.ratio).toBeCloseTo(1.0);
    expect(mixed.weekday.avgCost).toBeGreaterThan(0);
    expect(mixed.weekend.avgCost).toBeGreaterThan(0);

    const shifted = compareWeekdayWeekend(
      [rowAt("2026-03-08T03:00:00Z", 1000)],
      { from: "2026-03-07", to: "2026-03-07" },
      pricing,
      480,
    );
    expect(shifted.weekend).toMatchObject({ avgTokens: 1000, totalDays: 1 });
    expect(shifted.weekday.totalDays).toBe(0);
  });
});

describe("computeMoMGrowth", () => {
  it("handles empty input, default now, and January year wrap", () => {
    const empty = computeMoMGrowth([], pricing, new Date("2026-03-15"));
    expect(empty).toMatchObject({
      currentMonth: { tokens: 0, cost: 0, days: 0 },
      previousMonth: { tokens: 0, cost: 0, days: 0 },
      previousMonthSameDate: { tokens: 0, cost: 0, days: 0 },
      tokenGrowth: 0,
      costGrowth: 0,
      sameDateTokenGrowth: 0,
      sameDateCostGrowth: 0,
    });
    expect(computeMoMGrowth([], pricing).tokenGrowth).toBe(0);

    const janWrap = computeMoMGrowth(
      [rowAt("2025-12-15T10:00:00Z", 100), rowAt("2026-01-05T10:00:00Z", 200)],
      pricing,
      new Date("2026-01-15T12:00:00Z"),
    );
    expect(janWrap.previousMonth.tokens).toBe(100);
    expect(janWrap.currentMonth.tokens).toBe(200);
  });

  it("computes full-month, distinct-days, and same-date growth including boundary day", () => {
    const rows = [
      rowAt("2026-02-05T08:00:00Z", 500),
      rowAt("2026-02-05T16:00:00Z", 500),
      rowAt("2026-02-15T10:00:00Z", 1000), // == currentDay (15) -> included
      rowAt("2026-02-20T10:00:00Z", 3000), // > 15 -> excluded from sameDate
      rowAt("2026-03-05T10:00:00Z", 2000),
      rowAt("2026-03-10T10:00:00Z", 2000),
    ];
    const res = computeMoMGrowth(rows, pricing, new Date("2026-03-15"));
    expect(res.previousMonth).toMatchObject({ tokens: 5000, days: 3 });
    expect(res.currentMonth).toMatchObject({ tokens: 4000, days: 2 });
    expect(res.tokenGrowth).toBeCloseTo(-20);
    expect(res.previousMonthSameDate).toMatchObject({ tokens: 2000, days: 2 });
    expect(res.sameDateTokenGrowth).toBeCloseTo(100);
  });

  it("handles missing previous/current/same-date subsets and tzOffset boundaries", () => {
    const noPrev = computeMoMGrowth(
      [rowAt("2026-03-05T10:00:00Z", 5000)],
      pricing,
      new Date("2026-03-15"),
    );
    expect(noPrev.tokenGrowth).toBe(0);
    expect(noPrev.costGrowth).toBe(0);

    const noCur = computeMoMGrowth(
      [rowAt("2026-02-10T10:00:00Z", 3000)],
      pricing,
      new Date("2026-03-15"),
    );
    expect(noCur.tokenGrowth).toBeCloseTo(-100);

    const noSameDate = computeMoMGrowth(
      [rowAt("2026-02-15T10:00:00Z", 3000), rowAt("2026-03-01T10:00:00Z", 1000)],
      pricing,
      new Date("2026-03-02"),
    );
    expect(noSameDate.previousMonthSameDate.tokens).toBe(0);
    expect(noSameDate.sameDateTokenGrowth).toBe(0);

    expect(
      computeMoMGrowth([rowAt("2026-03-01T01:00:00Z", 1000)], pricing, new Date("2026-03-15"), 480)
        .previousMonth.tokens,
    ).toBe(1000);
    expect(
      computeMoMGrowth([rowAt("2026-02-28T20:00:00Z", 2000)], pricing, new Date("2026-03-15"), -540)
        .currentMonth.tokens,
    ).toBe(2000);
  });
});

describe("toSourceTrendPoints & toDominantSourceTimeline", () => {
  it("groups multi-source trends, zero-fills, sorts ascending, and shifts tzOffset", () => {
    expect(toSourceTrendPoints([])).toEqual([]);
    const res = toSourceTrendPoints([
      makeRow({ source: "claude-code", hour_start: "2026-03-08T09:00:00Z", total_tokens: 300 }),
      makeRow({ source: "claude-code", hour_start: "2026-03-07T10:00:00Z", total_tokens: 1000 }),
      makeRow({ source: "gemini-cli", hour_start: "2026-03-07T12:00:00Z", total_tokens: 2000 }),
    ]);
    expect(res.map((p) => p.date)).toEqual(["2026-03-07", "2026-03-08"]);
    expect(res[0]!.sources).toEqual({ "claude-code": 1000, "gemini-cli": 2000 });
    expect(res[1]!.sources).toEqual({ "claude-code": 300, "gemini-cli": 0 });

    expect(
      toSourceTrendPoints(
        [makeRow({ hour_start: "2026-03-08T03:00:00Z", total_tokens: 2000 })],
        480,
      )[0]!.date,
    ).toBe("2026-03-07");
    expect(
      toSourceTrendPoints(
        [makeRow({ hour_start: "2026-03-07T20:00:00Z", total_tokens: 2000 })],
        -540,
      )[0]!.date,
    ).toBe("2026-03-08");
  });

  it("identifies dominant source, alphabetical tie-break, zero-token days, and tzOffset", () => {
    expect(toDominantSourceTimeline([])).toEqual([]);
    const res = toDominantSourceTimeline([
      makeRow({
        source: "claude-code",
        hour_start: "2026-03-09T10:00:00Z",
        total_tokens: 0,
        input_tokens: 0,
        output_tokens: 0,
        cached_input_tokens: 0,
      }),
      makeRow({ source: "opencode", hour_start: "2026-03-08T09:00:00Z", total_tokens: 2000 }),
      makeRow({ source: "claude-code", hour_start: "2026-03-08T11:00:00Z", total_tokens: 2000 }),
      makeRow({ source: "claude-code", hour_start: "2026-03-07T10:00:00Z", total_tokens: 5000 }),
      makeRow({ source: "gemini-cli", hour_start: "2026-03-07T14:00:00Z", total_tokens: 1000 }),
    ]);
    expect(res.map((p) => p.date)).toEqual(["2026-03-07", "2026-03-08", "2026-03-09"]);
    expect(res[0]!.dominantSource).toBe("claude-code");
    expect(res[0]!.dominantShare).toBeCloseTo(83.33, 0);
    expect(res[1]!.dominantSource).toBe("claude-code"); // alphabetical tie-break at 50%
    expect(res[1]!.dominantShare).toBeCloseTo(50, 0);
    expect(res[2]!.dominantShare).toBe(0);

    const shifted = toDominantSourceTimeline(
      [makeRow({ source: "claude-code", hour_start: "2026-03-08T03:00:00Z", total_tokens: 1000 })],
      480,
    );
    expect(shifted[0]!.date).toBe("2026-03-07");
  });
});

describe("computeWoWGrowth & toHourlyWeekdayWeekend", () => {
  it("computes WoW growth including same-day, missing prev week, and default now", () => {
    expect(computeWoWGrowth([], pricing, new Date("2026-03-15"))).toMatchObject({
      currentWeek: { tokens: 0, cost: 0, days: 0 },
      previousWeek: { tokens: 0, days: 0 },
      tokenGrowth: 0,
      costGrowth: 0,
    });
    expect(computeWoWGrowth([], pricing).tokenGrowth).toBe(0);

    expect(
      computeWoWGrowth([rowAt("2026-03-15T10:00:00Z", 2000)], pricing, new Date("2026-03-15"))
        .tokenGrowth,
    ).toBe(0);

    const wow = computeWoWGrowth(
      [
        rowAt("2026-03-08T10:00:00Z", 500),
        rowAt("2026-03-11T10:00:00Z", 500),
        rowAt("2026-03-13T10:00:00Z", 1000),
        rowAt("2026-03-18T10:00:00Z", 2000),
      ],
      pricing,
      new Date("2026-03-18"),
    );
    expect(wow.previousWeek.tokens).toBe(2000);
    expect(wow.previousWeekSameDay.tokens).toBe(1000);
    expect(wow.currentWeek.tokens).toBe(2000);
    expect(wow.tokenGrowth).toBe(0);
    expect(wow.sameDayTokenGrowth).toBeCloseTo(100);
  });

  it("computes 24-hour weekday/weekend averages with zero-fill and tzOffset", () => {
    const empty = toHourlyWeekdayWeekend([], { from: "2026-03-07", to: "2026-03-07" }, 0);
    expect(empty).toHaveLength(24);
    expect(empty[0]).toEqual({ hour: 0, weekday: 0, weekend: 0 });

    const mixed = toHourlyWeekdayWeekend(
      [
        makeRow({ hour_start: "2026-03-07T10:00:00Z", total_tokens: 1000 }), // Sat
        makeRow({ hour_start: "2026-03-09T10:00:00Z", total_tokens: 2000 }), // Mon
        makeRow({ hour_start: "2026-03-10T10:00:00Z", total_tokens: 4000 }), // Tue
      ],
      { from: "2026-03-07", to: "2026-03-10" },
      0,
    );
    expect(mixed[10]).toEqual({ hour: 10, weekday: 3000, weekend: 500 });
    expect(mixed[0]).toEqual({ hour: 0, weekday: 0, weekend: 0 });

    const shifted = toHourlyWeekdayWeekend(
      [makeRow({ hour_start: "2026-03-07T18:00:00Z", total_tokens: 1000 })],
      { from: "2026-03-07", to: "2026-03-07" },
      480,
    );
    expect(shifted[10]!.weekend).toBe(1000);
    expect(shifted[18]!.weekend).toBe(0);
  });
});
