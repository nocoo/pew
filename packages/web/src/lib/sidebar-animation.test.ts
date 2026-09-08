import { describe, expect, it } from "vitest";
import {
  CHART_RESIZE_DEBOUNCE_MS,
  chartResizeDebounceMs,
  SIDEBAR_TRANSITION_MS,
} from "./sidebar-animation";

describe("chartResizeDebounceMs", () => {
  it("keeps the short debounce when the sidebar is still", () => {
    expect(chartResizeDebounceMs(false)).toBe(CHART_RESIZE_DEBOUNCE_MS);
  });

  it("waits out the full collapse animation before Recharts measures", () => {
    const ms = chartResizeDebounceMs(true);
    expect(ms).toBe(SIDEBAR_TRANSITION_MS + CHART_RESIZE_DEBOUNCE_MS);
    expect(ms).toBeGreaterThan(SIDEBAR_TRANSITION_MS);
  });
});
