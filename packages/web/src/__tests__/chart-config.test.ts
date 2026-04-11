import { describe, it, expect } from "vitest";
import {
  CHART_AXIS_FONT_SIZE,
  CHART_Y_AXIS_WIDTH_TOKENS,
  CHART_Y_AXIS_WIDTH_CURRENCY,
  CHART_Y_AXIS_WIDTH_LABELS,
  CHART_HEIGHT_CLASS,
  CHART_BAR_HEIGHT,
  BAR_RADIUS_VERTICAL,
  BAR_RADIUS_HORIZONTAL,
  BAR_RADIUS_NONE,
  CHART_GRID,
  LEGEND_DOT_CLASS,
  LEGEND_TEXT_CLASS,
} from "@/lib/chart-config";

describe("chart-config", () => {
  describe("axis configuration", () => {
    it("should export standard font size", () => {
      expect(CHART_AXIS_FONT_SIZE).toBe(11);
    });

    it("should export appropriate Y-axis widths", () => {
      // Tokens width should be narrower than currency (no $ prefix)
      expect(CHART_Y_AXIS_WIDTH_TOKENS).toBe(48);
      expect(CHART_Y_AXIS_WIDTH_CURRENCY).toBe(52);
      expect(CHART_Y_AXIS_WIDTH_CURRENCY).toBeGreaterThan(CHART_Y_AXIS_WIDTH_TOKENS);

      // Labels should be widest (for model/device names)
      expect(CHART_Y_AXIS_WIDTH_LABELS).toBe(140);
      expect(CHART_Y_AXIS_WIDTH_LABELS).toBeGreaterThan(CHART_Y_AXIS_WIDTH_CURRENCY);
    });
  });

  describe("chart dimensions", () => {
    it("should export responsive height class", () => {
      expect(CHART_HEIGHT_CLASS).toBe("h-[240px] md:h-[280px]");
      expect(CHART_HEIGHT_CLASS).toContain("md:");
    });

    it("should export bar height for horizontal charts", () => {
      expect(CHART_BAR_HEIGHT).toBe(32);
    });
  });

  describe("bar radius", () => {
    it("should have correct vertical bar radius (top corners rounded)", () => {
      expect(BAR_RADIUS_VERTICAL).toEqual([2, 2, 0, 0]);
    });

    it("should have correct horizontal bar radius (right corners rounded)", () => {
      expect(BAR_RADIUS_HORIZONTAL).toEqual([0, 4, 4, 0]);
    });

    it("should have no radius for middle bars", () => {
      expect(BAR_RADIUS_NONE).toEqual([0, 0, 0, 0]);
    });
  });

  describe("grid configuration", () => {
    it("should export consistent grid settings", () => {
      expect(CHART_GRID.strokeDasharray).toBe("3 3");
      expect(CHART_GRID.strokeOpacity).toBe(0.15);
    });
  });

  describe("legend configuration", () => {
    it("should export legend dot class", () => {
      expect(LEGEND_DOT_CLASS).toBe("h-2 w-2 rounded-full");
    });

    it("should export legend text class with text-xs", () => {
      expect(LEGEND_TEXT_CLASS).toContain("text-xs");
      expect(LEGEND_TEXT_CLASS).toContain("text-muted-foreground");
    });
  });
});
