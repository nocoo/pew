import { describe, it, expect } from "vitest";
import { cn, formatTokens } from "../lib/utils";

describe("cn()", () => {
  it("should merge class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("should handle conditional classes", () => {
    expect(cn("base", false && "hidden", "visible")).toBe("base visible");
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
