import { describe, it, expect } from "vitest";
import { sumBy } from "@/lib/array-helpers";

describe("sumBy", () => {
  it("sums a numeric field across an array of objects", () => {
    const rows = [
      { id: "a", value: 10 },
      { id: "b", value: 20 },
      { id: "c", value: 30 },
    ];
    expect(sumBy(rows, "value")).toBe(60);
  });

  it("returns 0 for an empty array", () => {
    const rows: Array<{ value: number }> = [];
    expect(sumBy(rows, "value")).toBe(0);
  });

  it("handles a single-element array", () => {
    expect(sumBy([{ value: 7 }], "value")).toBe(7);
  });

  it("handles negative and zero values", () => {
    const rows = [{ v: -5 }, { v: 0 }, { v: 10 }];
    expect(sumBy(rows, "v")).toBe(5);
  });

  it("accepts a readonly array", () => {
    const rows: ReadonlyArray<{ value: number }> = [
      { value: 1 },
      { value: 2 },
    ];
    expect(sumBy(rows, "value")).toBe(3);
  });

  it("ignores other fields on the same object", () => {
    const rows = [
      { value: 1, other: "ignored" },
      { value: 2, other: "ignored" },
    ];
    expect(sumBy(rows, "value")).toBe(3);
  });
});
