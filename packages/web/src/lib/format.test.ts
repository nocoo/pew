import { describe, expect, it } from "vitest";
import {
  formatCost,
  formatDuration,
  formatTokens,
  formatTokensFull,
} from "./format";

describe("formatTokens", () => {
  it("returns plain integer below 1k", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
  });

  it("formats thousands with one decimal", () => {
    expect(formatTokens(1000)).toBe("1.0K");
    expect(formatTokens(45_300)).toBe("45.3K");
    expect(formatTokens(999_999)).toBe("1000.0K");
  });

  it("formats millions with one decimal", () => {
    expect(formatTokens(1_000_000)).toBe("1.0M");
    expect(formatTokens(1_234_567)).toBe("1.2M");
  });

  it("formats billions with one decimal", () => {
    expect(formatTokens(1_000_000_000)).toBe("1.0B");
    expect(formatTokens(11_832_456_789)).toBe("11.8B");
  });
});

describe("formatTokensFull", () => {
  it("uses comma separators", () => {
    expect(formatTokensFull(0)).toBe("0");
    expect(formatTokensFull(1234)).toBe("1,234");
    expect(formatTokensFull(11_832_456_789)).toBe("11,832,456,789");
  });
});

describe("formatCost", () => {
  it("renders zero as $0.00", () => {
    expect(formatCost(0)).toBe("$0.00");
  });

  it("uses 4 decimals below $0.01", () => {
    expect(formatCost(0.0042)).toBe("$0.0042");
    expect(formatCost(0.0001)).toBe("$0.0001");
  });

  it("uses 2 decimals between $0.01 and $100", () => {
    expect(formatCost(0.5)).toBe("$0.50");
    expect(formatCost(12.34)).toBe("$12.34");
    expect(formatCost(99.99)).toBe("$99.99");
  });

  it("rounds to whole dollars at $100+ with thousand separators", () => {
    expect(formatCost(100)).toBe("$100");
    expect(formatCost(1234.56)).toBe("$1,235");
    expect(formatCost(1_000_000)).toBe("$1,000,000");
  });
});

describe("formatDuration", () => {
  it("returns em-dash for non-positive seconds", () => {
    expect(formatDuration(0)).toBe("—");
    expect(formatDuration(-5)).toBe("—");
  });

  it("collapses sub-minute into '< 1m'", () => {
    expect(formatDuration(1)).toBe("< 1m");
    expect(formatDuration(59)).toBe("< 1m");
  });

  it("renders pure-minute durations", () => {
    expect(formatDuration(60)).toBe("1m");
    expect(formatDuration(150)).toBe("2m");
    expect(formatDuration(3599)).toBe("59m");
  });

  it("renders hour-only durations when minutes are zero", () => {
    expect(formatDuration(3600)).toBe("1h");
    expect(formatDuration(86_400)).toBe("24h");
  });

  it("renders hour + minute durations", () => {
    expect(formatDuration(3700)).toBe("1h 1m");
    expect(formatDuration(90_061)).toBe("25h 1m");
  });
});
