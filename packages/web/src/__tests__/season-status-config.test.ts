import { describe, it, expect } from "vitest";

import {
  STATUS_LABELS,
  STATUS_BADGE_STYLES,
  TIMELINE_DOT_COLORS,
  LIVE_PILL_STYLE,
  FINAL_PILL_STYLE,
} from "@/lib/season-status-config";

describe("season-status-config", () => {
  const statuses = ["active", "upcoming", "ended"] as const;

  it("STATUS_LABELS covers all statuses", () => {
    for (const s of statuses) {
      expect(STATUS_LABELS[s]).toBeTruthy();
      expect(typeof STATUS_LABELS[s]).toBe("string");
    }
  });

  it("STATUS_BADGE_STYLES covers all statuses", () => {
    for (const s of statuses) {
      expect(STATUS_BADGE_STYLES[s]).toBeTruthy();
    }
  });

  it("TIMELINE_DOT_COLORS covers all statuses", () => {
    for (const s of statuses) {
      expect(TIMELINE_DOT_COLORS[s]).toBeTruthy();
    }
  });

  it("active badge contains green", () => {
    expect(STATUS_BADGE_STYLES.active).toContain("green");
  });

  it("upcoming badge contains blue", () => {
    expect(STATUS_BADGE_STYLES.upcoming).toContain("blue");
  });

  it("LIVE_PILL_STYLE is a non-empty string", () => {
    expect(LIVE_PILL_STYLE.length).toBeGreaterThan(0);
    expect(LIVE_PILL_STYLE).toContain("green");
  });

  it("FINAL_PILL_STYLE is a non-empty string", () => {
    expect(FINAL_PILL_STYLE.length).toBeGreaterThan(0);
    expect(FINAL_PILL_STYLE).toContain("muted");
  });
});
