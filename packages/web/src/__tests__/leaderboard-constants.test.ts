import { describe, it, expect } from "vitest";

import { PAGE_SIZE } from "@/lib/leaderboard-constants";

describe("leaderboard-constants", () => {
  it("PAGE_SIZE is 20", () => {
    expect(PAGE_SIZE).toBe(20);
  });

  it("PAGE_SIZE is a positive integer", () => {
    expect(Number.isInteger(PAGE_SIZE)).toBe(true);
    expect(PAGE_SIZE).toBeGreaterThan(0);
  });
});
