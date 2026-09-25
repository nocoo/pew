import { describe, expect, it } from "vitest";
import { sumCounts } from "./count-math";

describe("exact count addition", () => {
  it("preserves zero and the safe integer boundary", () => {
    expect(sumCounts()).toBe(0);
    expect(sumCounts(2 ** 52, 2 ** 52 - 1)).toBe(Number.MAX_SAFE_INTEGER);
  });
  it.each([NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid operands %s", (value) => {
    expect(() => sumCounts(value)).toThrow(RangeError);
  });
  it("rejects individually safe operands whose sum cannot be represented exactly", () => {
    expect(() => sumCounts(2 ** 52, 2 ** 52 + 1)).toThrow(RangeError);
  });
});
