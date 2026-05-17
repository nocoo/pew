import { describe, it, expect } from "vitest";
import { parseBoundedInt } from "../query-params";

describe("parseBoundedInt", () => {
  it("returns defaultValue when raw is null and default is provided", () => {
    expect(parseBoundedInt(null, { min: 0, defaultValue: 7 })).toBe(7);
  });

  it("returns 'invalid' when raw is null and no default is provided", () => {
    expect(parseBoundedInt(null, { min: 0 })).toBe("invalid");
  });

  it("returns 'invalid' for non-numeric input", () => {
    expect(parseBoundedInt("xyz", { min: 0 })).toBe("invalid");
    expect(parseBoundedInt("", { min: 0 })).toBe("invalid");
  });

  it("parses integer prefix (parseInt semantics, matches prior code)", () => {
    expect(parseBoundedInt("12abc", { min: 0, max: 100 })).toBe(12);
  });

  it("returns 'invalid' when value is below min", () => {
    expect(parseBoundedInt("-5", { min: 0 })).toBe("invalid");
    expect(parseBoundedInt("0", { min: 1 })).toBe("invalid");
  });

  it("returns 'invalid' when value exceeds max", () => {
    expect(parseBoundedInt("101", { min: 0, max: 100 })).toBe("invalid");
  });

  it("accepts boundary values", () => {
    expect(parseBoundedInt("0", { min: 0, max: 100 })).toBe(0);
    expect(parseBoundedInt("100", { min: 0, max: 100 })).toBe(100);
  });

  it("accepts any large value when no max is configured", () => {
    expect(parseBoundedInt("9999999", { min: 0 })).toBe(9999999);
  });

  it("default of 0 is honored (not treated as missing)", () => {
    expect(parseBoundedInt(null, { min: 0, defaultValue: 0 })).toBe(0);
  });
});
