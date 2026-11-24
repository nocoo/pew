import { describe, it, expect } from "vitest";
import {
  getYearWeeks,
  getColorIndex,
  formatDateISO,
  computePercentileBoundaries,
} from "@/lib/calendar-helpers";

// ---------------------------------------------------------------------------
// getYearWeeks
// ---------------------------------------------------------------------------

describe("getYearWeeks", () => {
  it("covers all days from Jan 1 through Dec 31", () => {
    const weeks = getYearWeeks(2026);
    const allDates = weeks.flat();

    // Must include Jan 1 and Dec 31
    const dateStrings = allDates.map(formatDateISO);
    expect(dateStrings).toContain("2026-01-01");
    expect(dateStrings).toContain("2026-12-31");
  });

  it("starts each week array on a Sunday", () => {
    const weeks = getYearWeeks(2026);
    for (const week of weeks) {
      // First date in each week should be a Sunday (getDay() === 0)
      // Exception: the last partial week may start on any day
      if (week.length === 7) {
        expect(week[0]!.getDay()).toBe(0);
      }
    }
  });

  it("each full week has exactly 7 days", () => {
    const weeks = getYearWeeks(2026);
    // All weeks except possibly the last should have 7 days
    for (let i = 0; i < weeks.length - 1; i++) {
      expect(weeks[i]!.length).toBe(7);
    }
    // Last week can be partial (1-7 days)
    const last = weeks[weeks.length - 1]!;
    expect(last.length).toBeGreaterThanOrEqual(1);
    expect(last.length).toBeLessThanOrEqual(7);
  });

  it("contains 52 or 53 weeks", () => {
    const weeks = getYearWeeks(2026);
    // A normal year has 52 or 53 weeks depending on start day
    expect(weeks.length).toBeGreaterThanOrEqual(52);
    expect(weeks.length).toBeLessThanOrEqual(54);
  });

  it("dates are in chronological order", () => {
    const weeks = getYearWeeks(2026);
    const allDates = weeks.flat();
    for (let i = 1; i < allDates.length; i++) {
      expect(allDates[i]!.getTime()).toBeGreaterThan(allDates[i - 1]!.getTime());
    }
  });

  it("handles a year where Jan 1 is a Sunday (2023)", () => {
    const weeks = getYearWeeks(2023);
    const first = weeks[0]![0]!;
    expect(first.getDay()).toBe(0);
    expect(formatDateISO(first)).toBe("2023-01-01");
  });

  it("handles a year where Jan 1 is a Saturday (2022)", () => {
    const weeks = getYearWeeks(2022);
    const first = weeks[0]![0]!;
    // Should start from the Sunday before Jan 1 = Dec 26, 2021
    expect(first.getDay()).toBe(0);
    expect(formatDateISO(first)).toBe("2021-12-26");
  });
});

// ---------------------------------------------------------------------------
// computePercentileBoundaries
// ---------------------------------------------------------------------------

describe("computePercentileBoundaries", () => {
  it("returns empty array for empty input", () => {
    expect(computePercentileBoundaries([], 4)).toEqual([]);
  });

  it("returns empty array for zero levels", () => {
    expect(computePercentileBoundaries([1, 2, 3], 0)).toEqual([]);
  });

  it("splits 8 values into 4 equal buckets", () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8];
    const boundaries = computePercentileBoundaries(sorted, 4);
    expect(boundaries).toEqual([2, 4, 6, 8]);
  });

  it("handles single value", () => {
    const boundaries = computePercentileBoundaries([42], 4);
    // All boundaries point to the same single value
    expect(boundaries).toEqual([42, 42, 42, 42]);
  });

  it("handles fewer values than levels", () => {
    const boundaries = computePercentileBoundaries([10, 20], 4);
    expect(boundaries).toHaveLength(4);
    // Each boundary is one of the two values
    for (const b of boundaries) {
      expect([10, 20]).toContain(b);
    }
  });

  it("handles uneven distribution", () => {
    // 100 values: 90 are "1", 10 are "1000"
    const sorted = [...Array(90).fill(1), ...Array(10).fill(1000)] as number[];
    const boundaries = computePercentileBoundaries(sorted, 4);
    // Most boundaries should be 1 since 90% of values are 1
    expect(boundaries[0]).toBe(1);
    expect(boundaries[1]).toBe(1);
    expect(boundaries[2]).toBe(1);
    expect(boundaries[3]).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// getColorIndex (percentile-based)
// ---------------------------------------------------------------------------

describe("getColorIndex", () => {
  const scale = ["#empty", "#low", "#med", "#high", "#max"]; // 5 levels

  it("returns 0 for value 0", () => {
    expect(getColorIndex(0, [25, 50, 75, 100], scale)).toBe(0);
  });

  it("returns 0 for value 0 with empty boundaries", () => {
    expect(getColorIndex(0, [], scale)).toBe(0);
  });

  it("returns 1 for non-zero value with empty boundaries", () => {
    expect(getColorIndex(42, [], scale)).toBe(1);
  });

  it("maps values to correct buckets based on boundaries", () => {
    const boundaries = [25, 50, 75, 100];
    // value <= 25 → index 1
    expect(getColorIndex(10, boundaries, scale)).toBe(1);
    expect(getColorIndex(25, boundaries, scale)).toBe(1);
    // value <= 50 → index 2
    expect(getColorIndex(30, boundaries, scale)).toBe(2);
    expect(getColorIndex(50, boundaries, scale)).toBe(2);
    // value <= 75 → index 3
    expect(getColorIndex(60, boundaries, scale)).toBe(3);
    expect(getColorIndex(75, boundaries, scale)).toBe(3);
    // value <= 100 → index 4
    expect(getColorIndex(80, boundaries, scale)).toBe(4);
    expect(getColorIndex(100, boundaries, scale)).toBe(4);
  });

  it("clamps values exceeding all boundaries to top bucket", () => {
    const boundaries = [25, 50, 75, 100];
    expect(getColorIndex(200, boundaries, scale)).toBe(4);
  });

  it("handles a two-color scale", () => {
    const twoScale = ["#off", "#on"];
    const boundaries = [100];
    expect(getColorIndex(0, boundaries, twoScale)).toBe(0);
    expect(getColorIndex(50, boundaries, twoScale)).toBe(1);
    expect(getColorIndex(100, boundaries, twoScale)).toBe(1);
  });

  it("distributes evenly with percentile boundaries", () => {
    // Simulate: sorted values [1,2,3,4,5,6,7,8], 4 levels
    // boundaries = [2, 4, 6, 8]
    const boundaries = computePercentileBoundaries([1, 2, 3, 4, 5, 6, 7, 8], 4);
    expect(getColorIndex(1, boundaries, scale)).toBe(1); // <= 2
    expect(getColorIndex(3, boundaries, scale)).toBe(2); // <= 4
    expect(getColorIndex(5, boundaries, scale)).toBe(3); // <= 6
    expect(getColorIndex(7, boundaries, scale)).toBe(4); // <= 8
  });
});

// ---------------------------------------------------------------------------
// formatDateISO
// ---------------------------------------------------------------------------

describe("formatDateISO", () => {
  it("formats a date as YYYY-MM-DD", () => {
    expect(formatDateISO(new Date(2026, 2, 10))).toBe("2026-03-10");
  });

  it("zero-pads single-digit months and days", () => {
    expect(formatDateISO(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("handles Dec 31 correctly", () => {
    expect(formatDateISO(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  it("handles Jan 1 correctly", () => {
    expect(formatDateISO(new Date(2026, 0, 1))).toBe("2026-01-01");
  });
});
