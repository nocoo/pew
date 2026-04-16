import { describe, it, expect } from "vitest";

import {
  ROW_CLASSES,
  COL_RANK,
  COL_SESSIONS,
  COL_DURATION,
  COL_TOKENS,
} from "@/components/leaderboard/leaderboard-layout";

describe("leaderboard-layout", () => {
  it("ROW_CLASSES contains expected Tailwind classes", () => {
    expect(ROW_CLASSES).toContain("rounded-");
    expect(ROW_CLASSES).toContain("bg-secondary");
  });

  it("COL_RANK defines a width", () => {
    expect(COL_RANK).toContain("w-");
  });

  it("COL_SESSIONS is hidden on mobile", () => {
    expect(COL_SESSIONS).toContain("hidden");
    expect(COL_SESSIONS).toContain("sm:block");
  });

  it("COL_DURATION is hidden on mobile", () => {
    expect(COL_DURATION).toContain("hidden");
    expect(COL_DURATION).toContain("sm:block");
  });

  it("COL_TOKENS has responsive width", () => {
    expect(COL_TOKENS).toContain("w-");
    expect(COL_TOKENS).toContain("sm:w-");
  });

  it("all exports are non-empty strings", () => {
    for (const val of [ROW_CLASSES, COL_RANK, COL_SESSIONS, COL_DURATION, COL_TOKENS]) {
      expect(typeof val).toBe("string");
      expect(val.length).toBeGreaterThan(0);
    }
  });
});
