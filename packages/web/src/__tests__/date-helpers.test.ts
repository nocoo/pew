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
  it("contains all three period values", () => {
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
