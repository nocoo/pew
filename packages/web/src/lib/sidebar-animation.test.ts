import { describe, expect, it } from "vitest";
import { CHART_RESIZE_DEBOUNCE_MS, SIDEBAR_TRANSITION_MS } from "./sidebar-animation";

describe("CHART_RESIZE_DEBOUNCE_MS", () => {
  it("covers the full sidebar collapse animation", () => {
    expect(CHART_RESIZE_DEBOUNCE_MS).toBe(SIDEBAR_TRANSITION_MS);
  });
});
