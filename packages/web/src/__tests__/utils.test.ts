import { describe, it, expect } from "vitest";
import { cn, formatTokens, formatTokensFull } from "../lib/utils";

describe("cn()", () => {
  it("should merge class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("should handle conditional classes", () => {
    const isHidden = false as boolean;
    expect(cn("base", isHidden && "hidden", "visible")).toBe("base visible");
  });

  it("should merge tailwind conflicts (last wins)", () => {
    expect(cn("p-4", "p-2")).toBe("p-2");
  });

  it("should handle empty input", () => {
    expect(cn()).toBe("");
  });
});

describe("formatTokens()", () => {
  it("should return raw number for < 1000", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(42)).toBe("42");
  });

  it("should format thousands as K", () => {
    expect(formatTokens(1000)).toBe("1.0K");
    expect(formatTokens(1500)).toBe("1.5K");
    expect(formatTokens(45300)).toBe("45.3K");
    expect(formatTokens(999_999)).toBe("1000.0K");
  });

  it("should format millions as M", () => {
    expect(formatTokens(1_000_000)).toBe("1.0M");
    expect(formatTokens(1_200_000)).toBe("1.2M");
    expect(formatTokens(999_999_999)).toBe("1000.0M");
  });

  it("should format billions as B", () => {
    expect(formatTokens(1_000_000_000)).toBe("1.0B");
    expect(formatTokens(2_500_000_000)).toBe("2.5B");
  });
});

describe("formatTokensFull()", () => {
  it("should return small numbers as-is", () => {
    expect(formatTokensFull(0)).toBe("0");
    expect(formatTokensFull(42)).toBe("42");
    expect(formatTokensFull(999)).toBe("999");
  });

  it("should add comma separators for thousands", () => {
    expect(formatTokensFull(1_000)).toBe("1,000");
    expect(formatTokensFull(45_300)).toBe("45,300");
    expect(formatTokensFull(999_999)).toBe("999,999");
  });

  it("should add comma separators for millions", () => {
    expect(formatTokensFull(1_200_000)).toBe("1,200,000");
  });

  it("should add comma separators for billions", () => {
    expect(formatTokensFull(11_832_456_789)).toBe("11,832,456,789");
  });
});
