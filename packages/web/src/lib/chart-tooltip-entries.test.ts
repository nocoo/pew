import { describe, expect, it } from "vitest";
import { summarizeTooltipEntries } from "./chart-tooltip-entries";

describe("tooltip entry presentation", () => {
  it("shows only positive current-point values, sorted without mutating the payload", () => {
    const entries = [
      { dataKey: "zero", value: 0 },
      { dataKey: "small", value: 3 },
      { dataKey: "large", value: 10 },
      { dataKey: "negative", value: -1 },
      { dataKey: "invalid", value: NaN },
    ];
    const original = structuredClone(entries);
    expect(summarizeTooltipEntries(entries)).toEqual({
      visible: [entries[2], entries[1]],
      hiddenCount: 0,
      hiddenTotal: 0,
      total: 13,
    });
    expect(entries).toEqual(original);
  });

  it.each([0, 12, 20, 21, 100])(
    "bounds %s active entries to twenty without changing the total",
    (count) => {
      const entries = Array.from({ length: count }, (_, i) => ({ dataKey: `m${i}`, value: i + 1 }));
      const result = summarizeTooltipEntries(entries);
      expect(result.visible).toHaveLength(Math.min(count, 20));
      expect(result.hiddenCount).toBe(Math.max(0, count - 20));
      expect(result.total).toBe((count * (count + 1)) / 2);
      expect(result.visible.reduce((n, entry) => n + entry.value, 0) + result.hiddenTotal).toBe(
        result.total,
      );
    },
  );

  it("does not count inactive models against the per-point limit", () => {
    const entries = Array.from({ length: 100 }, (_, i) => ({
      dataKey: `m${i}`,
      value: i < 12 ? 1 : 0,
    }));
    expect(summarizeTooltipEntries(entries)).toMatchObject({
      hiddenCount: 0,
      hiddenTotal: 0,
      total: 12,
    });
  });
});
