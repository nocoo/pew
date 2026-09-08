import { describe, it, expect } from "vitest";
import { getHeatmapColor, HOUR_LABELS } from "@/lib/heatmap-helpers";

// ---------------------------------------------------------------------------
// getHeatmapColor
// ---------------------------------------------------------------------------

describe("getHeatmapColor", () => {
  it("returns empty color for value 0", () => {
    const result = getHeatmapColor(0, 100);
    expect(result).toBe("hsl(var(--basalt-muted))");
  });

  it("returns empty color when maxValue is 0", () => {
    const result = getHeatmapColor(5, 0);
    expect(result).toBe("hsl(var(--basalt-muted))");
  });

  it("returns alpha 0.3 for ratio <= 0.25", () => {
    const result = getHeatmapColor(25, 100);
    expect(result).toBe("hsl(var(--chart-1) / 0.3)");
  });

  it("returns alpha 0.5 for ratio <= 0.5", () => {
    const result = getHeatmapColor(50, 100);
    expect(result).toBe("hsl(var(--chart-1) / 0.5)");
  });

  it("returns alpha 0.75 for ratio <= 0.75", () => {
    const result = getHeatmapColor(75, 100);
    expect(result).toBe("hsl(var(--chart-1) / 0.75)");
  });

  it("returns alpha 1 for ratio > 0.75", () => {
    const result = getHeatmapColor(100, 100);
    expect(result).toBe("hsl(var(--chart-1) / 1)");
  });

  it("handles boundary at exactly 0.25", () => {
    // ratio = 1/4 = 0.25 → <= 0.25 → alpha 0.3
    const result = getHeatmapColor(1, 4);
    expect(result).toBe("hsl(var(--chart-1) / 0.3)");
  });

  it("handles value just above 0.25 threshold", () => {
    // ratio = 26/100 = 0.26 → > 0.25, <= 0.5 → alpha 0.5
    const result = getHeatmapColor(26, 100);
    expect(result).toBe("hsl(var(--chart-1) / 0.5)");
  });
});

// ---------------------------------------------------------------------------
// HOUR_LABELS
// ---------------------------------------------------------------------------

describe("HOUR_LABELS", () => {
  it("has exactly 24 entries", () => {
    expect(HOUR_LABELS).toHaveLength(24);
  });

  it("starts with 12a (midnight)", () => {
    expect(HOUR_LABELS[0]).toBe("12a");
  });

  it("has 12p at index 12 (noon)", () => {
    expect(HOUR_LABELS[12]).toBe("12p");
  });

  it("ends with 11p", () => {
    expect(HOUR_LABELS[23]).toBe("11p");
  });

  it("has correct AM labels", () => {
    expect(HOUR_LABELS[1]).toBe("1a");
    expect(HOUR_LABELS[11]).toBe("11a");
  });

  it("has correct PM labels", () => {
    expect(HOUR_LABELS[13]).toBe("1p");
    expect(HOUR_LABELS[23]).toBe("11p");
  });
});
