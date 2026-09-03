import { describe, it, expect } from "vitest";
import { clampedJsonlEndOffset } from "../utils/jsonl-offset.js";

describe("clampedJsonlEndOffset", () => {
  it("returns file size when startOffset is past EOF", () => {
    expect(clampedJsonlEndOffset(5240354, 2800)).toBe(2800);
  });

  it("returns file size when startOffset equals size", () => {
    expect(clampedJsonlEndOffset(100, 100)).toBe(100);
  });

  it("adds complete bytes without passing the snapshot size", () => {
    expect(clampedJsonlEndOffset(10, 100, 20)).toBe(30);
    expect(clampedJsonlEndOffset(10, 25, 20)).toBe(25);
  });

  it("returns 0 for empty files", () => {
    expect(clampedJsonlEndOffset(0, 0, 10)).toBe(0);
  });
});
