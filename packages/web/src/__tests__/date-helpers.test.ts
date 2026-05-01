import { describe, it, expect, vi, afterEach } from "vitest";
import {
  PERIOD_OPTIONS,
  periodToDateRange,
  periodLabel,
  formatDate,
  formatMemberSince,
  getMonthRange,
  formatMonth,
  detectPeakHours,
  getLocalToday,
  formatDuration,
  fillDateRange,
  fillTimelineGaps,
  aggregateHourlyTokens,
} from "@/lib/date-helpers";
import type { UsageRow } from "@/hooks/use-usage-data";

// ---------------------------------------------------------------------------
// Test data factory for UsageRow
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<UsageRow> = {}): UsageRow {
  return {
    source: "claude-code",
    model: "claude-sonnet-4-20250514",
    hour_start: "2026-03-09T10:00:00.000Z",
    input_tokens: 100_000,
    cached_input_tokens: 20_000,
    output_tokens: 50_000,
    reasoning_output_tokens: 0,
    total_tokens: 150_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// PERIOD_OPTIONS constant
// ---------------------------------------------------------------------------

describe("PERIOD_OPTIONS", () => {
  it("contains all three period values in order: all, month, week", () => {
    const values = PERIOD_OPTIONS.map((o) => o.value);
    expect(values).toEqual(["all", "month", "week"]);
  });

  it("has human-readable labels", () => {
    for (const opt of PERIOD_OPTIONS) {
      expect(opt.label.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// periodToDateRange
// ---------------------------------------------------------------------------

describe("periodToDateRange", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns from="2020-01-01" for "all"', () => {
    const result = periodToDateRange("all");
    expect(result).toEqual({ from: "2020-01-01" });
  });

  it('returns first day of current month for "month"', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 15)); // March 15, 2026
    const result = periodToDateRange("month");
    expect(result.from).toBe("2026-03-01");
    expect(result.to).toBeUndefined();
  });

  it('returns last Sunday for "week"', () => {
    vi.useFakeTimers();
    // Wednesday March 11, 2026 — previous Sunday = March 8
    vi.setSystemTime(new Date(2026, 2, 11));
    const result = periodToDateRange("week");
    expect(result.from).toBe("2026-03-08");
  });

  it('returns same day if today is Sunday for "week"', () => {
    vi.useFakeTimers();
    // March 8, 2026 is a Sunday
    vi.setSystemTime(new Date(2026, 2, 8));
    const result = periodToDateRange("week");
    expect(result.from).toBe("2026-03-08");
  });

  it("should not pad from for positive tzOffset (west of UTC)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 15)); // March 15, 2026
    const result = periodToDateRange("month", 480); // UTC-8
    expect(result.from).toBe("2026-03-01");
  });

  it("should pad from by one day for negative tzOffset (east of UTC)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 15)); // March 15, 2026
    const result = periodToDateRange("month", -540); // UTC+9
    // Local Mar 1 00:00 JST = Feb 28 15:00 UTC, so from must include Feb 28
    expect(result.from).toBe("2026-02-28");
  });

  it("should pad week from by one day for negative tzOffset", () => {
    vi.useFakeTimers();
    // Wednesday March 11, 2026 — previous Sunday = March 8
    vi.setSystemTime(new Date(2026, 2, 11));
    const result = periodToDateRange("week", -540); // UTC+9
    // Sunday is March 8, padded back to March 7
    expect(result.from).toBe("2026-03-07");
  });

  it('should not pad "all" period regardless of tzOffset', () => {
    const result = periodToDateRange("all", -540);
    expect(result.from).toBe("2020-01-01");
  });
});

// ---------------------------------------------------------------------------
// periodLabel
// ---------------------------------------------------------------------------

describe("periodLabel", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "All time" for "all"', () => {
    expect(periodLabel("all")).toBe("All time");
  });

  it('returns "This week" for "week"', () => {
    expect(periodLabel("week")).toBe("This week");
  });

  it("returns month + year for 'month'", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 10));
    expect(periodLabel("month")).toBe("March 2026");
  });
});

// ---------------------------------------------------------------------------
// formatDate
// ---------------------------------------------------------------------------

describe("formatDate", () => {
  it('formats "2026-03-10" as a short weekday + month + day', () => {
    const result = formatDate("2026-03-10");
    // "Tue, Mar 10" — exact format varies by locale but should contain these parts
    expect(result).toContain("Mar");
    expect(result).toContain("10");
  });

  it("handles January 1st correctly", () => {
    const result = formatDate("2026-01-01");
    expect(result).toContain("Jan");
    expect(result).toContain("1");
  });
});

// ---------------------------------------------------------------------------
// formatMemberSince
// ---------------------------------------------------------------------------

describe("formatMemberSince", () => {
  it("formats ISO date as month + year", () => {
    const result = formatMemberSince("2025-01-15T12:00:00Z");
    expect(result).toBe("January 2025");
  });

  it("handles date-only strings", () => {
    const result = formatMemberSince("2024-12-25");
    expect(result).toContain("December");
    expect(result).toContain("2024");
  });
});

// ---------------------------------------------------------------------------
// getMonthRange
// ---------------------------------------------------------------------------

describe("getMonthRange", () => {
  it("returns correct range for March 2026", () => {
    const result = getMonthRange(2026, 2); // month is 0-indexed
    expect(result.from).toBe("2026-03-01");
    expect(result.to).toBe("2026-03-31");
  });

  it("handles February in a non-leap year", () => {
    const result = getMonthRange(2025, 1);
    expect(result.from).toBe("2025-02-01");
    expect(result.to).toBe("2025-02-28");
  });

  it("handles February in a leap year", () => {
    const result = getMonthRange(2024, 1);
    expect(result.from).toBe("2024-02-01");
    expect(result.to).toBe("2024-02-29");
  });

  it("handles December (month wrapping)", () => {
    const result = getMonthRange(2026, 11);
    expect(result.from).toBe("2026-12-01");
    expect(result.to).toBe("2026-12-31");
  });
});

// ---------------------------------------------------------------------------
// formatMonth
// ---------------------------------------------------------------------------

describe("formatMonth", () => {
  it("formats March 2026", () => {
    expect(formatMonth(2026, 2)).toBe("March 2026");
  });

  it("formats January 2025", () => {
    expect(formatMonth(2025, 0)).toBe("January 2025");
  });

  it("formats December 2024", () => {
    expect(formatMonth(2024, 11)).toBe("December 2024");
  });
});

// ---------------------------------------------------------------------------
// detectPeakHours
// ---------------------------------------------------------------------------

describe("detectPeakHours", () => {
  it("should return empty array for empty input", () => {
    const result = detectPeakHours([], 3, 0);
    expect(result).toEqual([]);
  });

  it("should return the single busiest slot for a single record (UTC)", () => {
    // 2026-03-09 is a Monday, 10:00 UTC
    const rows = [makeRow({ hour_start: "2026-03-09T10:00:00.000Z", total_tokens: 50_000 })];

    const result = detectPeakHours(rows, 3, 0);

    expect(result).toHaveLength(1);
    expect(result[0]!.dayOfWeek).toBe("Monday");
    expect(result[0]!.timeSlot).toBe("10:00 AM – 10:30 AM");
    expect(result[0]!.totalTokens).toBe(50_000);
  });

  it("should group same day+slot and sum tokens", () => {
    // Two records on the same Monday 10:00 UTC slot
    const rows = [
      makeRow({ hour_start: "2026-03-09T10:00:00.000Z", total_tokens: 30_000 }),
      makeRow({ hour_start: "2026-03-16T10:00:00.000Z", total_tokens: 20_000 }), // also Monday 10:00 UTC
    ];

    const result = detectPeakHours(rows, 3, 0);

    expect(result).toHaveLength(1);
    expect(result[0]!.dayOfWeek).toBe("Monday");
    expect(result[0]!.timeSlot).toBe("10:00 AM – 10:30 AM");
    expect(result[0]!.totalTokens).toBe(50_000);
  });

  it("should return top N sorted by total descending", () => {
    const rows = [
      makeRow({ hour_start: "2026-03-09T10:00:00.000Z", total_tokens: 10_000 }), // Mon 10:00
      makeRow({ hour_start: "2026-03-09T14:00:00.000Z", total_tokens: 50_000 }), // Mon 14:00
      makeRow({ hour_start: "2026-03-10T09:00:00.000Z", total_tokens: 30_000 }), // Tue 09:00
      makeRow({ hour_start: "2026-03-10T09:30:00.000Z", total_tokens: 25_000 }), // Tue 09:30
    ];

    const result = detectPeakHours(rows, 2, 0);

    expect(result).toHaveLength(2);
    expect(result[0]!.totalTokens).toBe(50_000); // Mon 14:00
    expect(result[0]!.dayOfWeek).toBe("Monday");
    expect(result[1]!.totalTokens).toBe(30_000); // Tue 09:00
    expect(result[1]!.dayOfWeek).toBe("Tuesday");
  });

  it("should apply positive tzOffset (PST, UTC-8 = 480)", () => {
    // 2026-03-09 Mon 02:00 UTC → PST: Sun 18:00 (shifted back 8h)
    const rows = [makeRow({ hour_start: "2026-03-09T02:00:00.000Z", total_tokens: 40_000 })];

    const result = detectPeakHours(rows, 3, 480);

    expect(result).toHaveLength(1);
    expect(result[0]!.dayOfWeek).toBe("Sunday");
    expect(result[0]!.timeSlot).toBe("6:00 PM – 6:30 PM");
    expect(result[0]!.totalTokens).toBe(40_000);
  });

  it("should apply negative tzOffset (JST, UTC+9 = -540)", () => {
    // 2026-03-08 Sun 22:00 UTC → JST: Mon 07:00 (shifted forward 9h)
    const rows = [makeRow({ hour_start: "2026-03-08T22:00:00.000Z", total_tokens: 60_000 })];

    const result = detectPeakHours(rows, 3, -540);

    expect(result).toHaveLength(1);
    expect(result[0]!.dayOfWeek).toBe("Monday");
    expect(result[0]!.timeSlot).toBe("7:00 AM – 7:30 AM");
    expect(result[0]!.totalTokens).toBe(60_000);
  });

  it("should default topN to 3", () => {
    const rows = [
      makeRow({ hour_start: "2026-03-09T08:00:00.000Z", total_tokens: 10_000 }),
      makeRow({ hour_start: "2026-03-09T09:00:00.000Z", total_tokens: 20_000 }),
      makeRow({ hour_start: "2026-03-09T10:00:00.000Z", total_tokens: 30_000 }),
      makeRow({ hour_start: "2026-03-09T11:00:00.000Z", total_tokens: 40_000 }),
      makeRow({ hour_start: "2026-03-09T12:00:00.000Z", total_tokens: 50_000 }),
    ];

    const result = detectPeakHours(rows);

    expect(result).toHaveLength(3);
    expect(result[0]!.totalTokens).toBe(50_000);
    expect(result[1]!.totalTokens).toBe(40_000);
    expect(result[2]!.totalTokens).toBe(30_000);
  });

  it("should handle half-hour boundaries (:30) correctly", () => {
    const rows = [makeRow({ hour_start: "2026-03-09T10:30:00.000Z", total_tokens: 35_000 })];

    const result = detectPeakHours(rows, 3, 0);

    expect(result).toHaveLength(1);
    expect(result[0]!.dayOfWeek).toBe("Monday");
    expect(result[0]!.timeSlot).toBe("10:30 AM – 11:00 AM");
    expect(result[0]!.totalTokens).toBe(35_000);
  });
});

// ---------------------------------------------------------------------------
// getLocalToday
// ---------------------------------------------------------------------------

describe("getLocalToday", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns UTC date when tzOffset is 0", () => {
    vi.useFakeTimers();
    // 2026-03-10 15:00 UTC
    vi.setSystemTime(new Date("2026-03-10T15:00:00.000Z"));
    expect(getLocalToday(0)).toBe("2026-03-10");
  });

  it("shifts to previous day for positive tzOffset (west of UTC)", () => {
    vi.useFakeTimers();
    // 2026-03-10 02:00 UTC → PST (UTC-8, tzOffset=480): Mar 9, 6pm local
    vi.setSystemTime(new Date("2026-03-10T02:00:00.000Z"));
    expect(getLocalToday(480)).toBe("2026-03-09");
  });

  it("shifts to next day for negative tzOffset (east of UTC)", () => {
    vi.useFakeTimers();
    // 2026-03-10 22:00 UTC → JST (UTC+9, tzOffset=-540): Mar 11, 7am local
    vi.setSystemTime(new Date("2026-03-10T22:00:00.000Z"));
    expect(getLocalToday(-540)).toBe("2026-03-11");
  });

  it("matches toLocalDailyBuckets timezone math", () => {
    vi.useFakeTimers();
    // The same shift: localMs = Date.now() - tzOffset * 60_000
    // This is the same formula used in toLocalDailyBuckets
    vi.setSystemTime(new Date("2026-03-10T03:00:00.000Z"));

    // UTC+5:30 (IST, tzOffset = -330): local = 8:30am Mar 10
    expect(getLocalToday(-330)).toBe("2026-03-10");

    // UTC-5 (EST, tzOffset = 300): local = 10pm Mar 9
    expect(getLocalToday(300)).toBe("2026-03-09");
  });

  it("defaults tzOffset to 0", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T12:00:00.000Z"));
    expect(getLocalToday()).toBe("2026-03-10");
  });
});

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------

describe("formatDuration", () => {
  it('returns "—" for 0 seconds', () => {
    expect(formatDuration(0)).toBe("—");
  });

  it('returns "—" for negative values', () => {
    expect(formatDuration(-10)).toBe("—");
  });

  it('returns "< 1m" for values under 60 seconds', () => {
    expect(formatDuration(1)).toBe("< 1m");
    expect(formatDuration(30)).toBe("< 1m");
    expect(formatDuration(59)).toBe("< 1m");
  });

  it("returns minutes only when under 1 hour", () => {
    expect(formatDuration(60)).toBe("1m");
    expect(formatDuration(150)).toBe("2m");
    expect(formatDuration(3540)).toBe("59m");
  });

  it("returns hours only when minutes are zero", () => {
    expect(formatDuration(3600)).toBe("1h");
    expect(formatDuration(7200)).toBe("2h");
    expect(formatDuration(86400)).toBe("24h");
  });

  it("returns hours and minutes combined", () => {
    expect(formatDuration(3660)).toBe("1h 1m");
    expect(formatDuration(3700)).toBe("1h 1m");
    expect(formatDuration(5400)).toBe("1h 30m");
    expect(formatDuration(90061)).toBe("25h 1m");
  });
});

// ---------------------------------------------------------------------------
// fillDateRange — fills gaps + extends to today
// ---------------------------------------------------------------------------

describe("fillDateRange", () => {
  it("returns empty array when input is empty and no today is given", () => {
    const result = fillDateRange([], "date", () => ({ date: "", val: 0 }));
    expect(result).toEqual([]);
  });

  it("fills gap between two non-adjacent dates", () => {
    const data = [
      { date: "2026-03-10", val: 100 },
      { date: "2026-03-13", val: 200 },
    ];
    const result = fillDateRange(data, "date", (d) => ({ date: d, val: 0 }));
    expect(result).toEqual([
      { date: "2026-03-10", val: 100 },
      { date: "2026-03-11", val: 0 },
      { date: "2026-03-12", val: 0 },
      { date: "2026-03-13", val: 200 },
    ]);
  });

  it("extends to today when last data date is before today", () => {
    const data = [
      { date: "2026-03-14", val: 50 },
      { date: "2026-03-15", val: 60 },
    ];
    const today = "2026-03-18";
    const result = fillDateRange(data, "date", (d) => ({ date: d, val: 0 }), today);
    expect(result).toEqual([
      { date: "2026-03-14", val: 50 },
      { date: "2026-03-15", val: 60 },
      { date: "2026-03-16", val: 0 },
      { date: "2026-03-17", val: 0 },
      { date: "2026-03-18", val: 0 },
    ]);
  });

  it("does not trim when last data date is after today", () => {
    // Edge case: data extends beyond "today" — keep it all
    const data = [
      { date: "2026-03-16", val: 10 },
      { date: "2026-03-18", val: 20 },
    ];
    const today = "2026-03-17";
    const result = fillDateRange(data, "date", (d) => ({ date: d, val: 0 }), today);
    expect(result).toEqual([
      { date: "2026-03-16", val: 10 },
      { date: "2026-03-17", val: 0 },
      { date: "2026-03-18", val: 20 },
    ]);
  });

  it("handles single-element input with today", () => {
    const data = [{ date: "2026-03-14", val: 99 }];
    const today = "2026-03-16";
    const result = fillDateRange(data, "date", (d) => ({ date: d, val: 0 }), today);
    expect(result).toEqual([
      { date: "2026-03-14", val: 99 },
      { date: "2026-03-15", val: 0 },
      { date: "2026-03-16", val: 0 },
    ]);
  });

  it("returns data as-is when already contiguous up to today", () => {
    const data = [
      { date: "2026-03-15", val: 10 },
      { date: "2026-03-16", val: 20 },
    ];
    const today = "2026-03-16";
    const result = fillDateRange(data, "date", (d) => ({ date: d, val: 0 }), today);
    expect(result).toEqual(data);
  });

  it("preserves original objects (no cloning)", () => {
    const original = { date: "2026-03-15", val: 42 };
    const data = [original];
    const result = fillDateRange(data, "date", (d) => ({ date: d, val: 0 }), "2026-03-15");
    expect(result[0]).toBe(original);
  });

  it("works with a custom date key name", () => {
    const data = [
      { day: "2026-03-10", count: 5 },
      { day: "2026-03-12", count: 8 },
    ];
    const result = fillDateRange(data, "day", (d) => ({ day: d, count: 0 }));
    expect(result).toEqual([
      { day: "2026-03-10", count: 5 },
      { day: "2026-03-11", count: 0 },
      { day: "2026-03-12", count: 8 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// fillTimelineGaps — fills gaps in multi-row-per-date timelines
// ---------------------------------------------------------------------------

describe("fillTimelineGaps", () => {
  type Row = { date: string; device_id: string; tokens: number };

  const makeZeroRows = (d: string): Row[] => [
    { date: d, device_id: "a", tokens: 0 },
    { date: d, device_id: "b", tokens: 0 },
  ];

  it("returns empty array when input is empty", () => {
    const result = fillTimelineGaps<Row>([], "date", makeZeroRows);
    expect(result).toEqual([]);
  });

  it("fills gap between two non-adjacent dates with zero rows for all entities", () => {
    const data: Row[] = [
      { date: "2026-03-10", device_id: "a", tokens: 100 },
      { date: "2026-03-10", device_id: "b", tokens: 50 },
      { date: "2026-03-12", device_id: "a", tokens: 200 },
    ];
    const result = fillTimelineGaps(data, "date", makeZeroRows);
    expect(result).toEqual([
      { date: "2026-03-10", device_id: "a", tokens: 100 },
      { date: "2026-03-10", device_id: "b", tokens: 50 },
      { date: "2026-03-11", device_id: "a", tokens: 0 },
      { date: "2026-03-11", device_id: "b", tokens: 0 },
      { date: "2026-03-12", device_id: "a", tokens: 200 },
    ]);
  });

  it("extends to today with zero rows", () => {
    const data: Row[] = [
      { date: "2026-03-14", device_id: "a", tokens: 10 },
    ];
    const result = fillTimelineGaps(data, "date", makeZeroRows, "2026-03-16");
    expect(result).toEqual([
      { date: "2026-03-14", device_id: "a", tokens: 10 },
      { date: "2026-03-15", device_id: "a", tokens: 0 },
      { date: "2026-03-15", device_id: "b", tokens: 0 },
      { date: "2026-03-16", device_id: "a", tokens: 0 },
      { date: "2026-03-16", device_id: "b", tokens: 0 },
    ]);
  });

  it("preserves original objects by reference", () => {
    const original: Row = { date: "2026-03-15", device_id: "a", tokens: 42 };
    const data = [original];
    const result = fillTimelineGaps(data, "date", makeZeroRows, "2026-03-15");
    expect(result[0]).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// aggregateHourlyTokens
// ---------------------------------------------------------------------------

describe("aggregateHourlyTokens", () => {
  it("returns 24-element zero array for empty input", () => {
    const out = aggregateHourlyTokens([], 0);
    expect(out).toHaveLength(24);
    expect(out.every((v) => v === 0)).toBe(true);
  });

  it("buckets by UTC hour when tzOffset is 0", () => {
    const rows = [
      makeRow({ hour_start: "2026-03-09T10:00:00.000Z", total_tokens: 100 }),
      makeRow({ hour_start: "2026-03-09T10:30:00.000Z", total_tokens: 50 }),
      makeRow({ hour_start: "2026-03-09T22:00:00.000Z", total_tokens: 30 }),
    ];
    const out = aggregateHourlyTokens(rows, 0);
    expect(out[10]).toBe(150);
    expect(out[22]).toBe(30);
    expect(out[0]).toBe(0);
  });

  it("shifts hour bucket according to tzOffset (PST = +480 minutes west)", () => {
    // 10:00 UTC → 02:00 PST
    const rows = [makeRow({ hour_start: "2026-03-09T10:00:00.000Z", total_tokens: 100 })];
    const out = aggregateHourlyTokens(rows, 480);
    expect(out[2]).toBe(100);
  });
});
