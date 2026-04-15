import { describe, expect, it } from "vitest";
import { nextHiddenLegendKeys } from "@/lib/chart-legend-filter";

function toSortedArray(set: Set<string>): string[] {
  return Array.from(set).sort();
}

describe("nextHiddenLegendKeys", () => {
  const keys = ["a", "b", "c"];

  it("isolates the clicked key on normal click", () => {
    const next = nextHiddenLegendKeys({
      keys,
      hiddenKeys: new Set(),
      targetKey: "b",
    });

    expect(toSortedArray(next)).toEqual(["a", "c"]);
  });

  it("resets to all visible when clicking the isolated key again", () => {
    const next = nextHiddenLegendKeys({
      keys,
      hiddenKeys: new Set(["a", "c"]),
      targetKey: "b",
    });

    expect(toSortedArray(next)).toEqual([]);
  });

  it("hides target key on meta/cmd click without isolating", () => {
    const next = nextHiddenLegendKeys({
      keys,
      hiddenKeys: new Set(["c"]),
      targetKey: "a",
      metaKey: true,
    });

    expect(toSortedArray(next)).toEqual(["a", "c"]);
  });

  it("unhides target key on repeated meta/cmd click", () => {
    const next = nextHiddenLegendKeys({
      keys,
      hiddenKeys: new Set(["a", "c"]),
      targetKey: "a",
      metaKey: true,
    });

    expect(toSortedArray(next)).toEqual(["c"]);
  });

  it("keeps current state when target key is unknown", () => {
    const next = nextHiddenLegendKeys({
      keys,
      hiddenKeys: new Set(["a"]),
      targetKey: "x",
      metaKey: true,
    });

    expect(toSortedArray(next)).toEqual(["a"]);
  });
});
