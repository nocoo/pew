import { describe, it, expect } from "vitest";
import {
  toUtcHalfHourStart,
  bucketKey,
  addTokens,
  emptyTokenDelta,
} from "../utils/buckets.js";
import type { TokenDelta } from "@zebra/core";

describe("toUtcHalfHourStart", () => {
  it("should floor to :00 for minutes 0-29", () => {
    expect(toUtcHalfHourStart("2026-03-07T10:15:30.000Z")).toBe(
      "2026-03-07T10:00:00.000Z",
    );
  });

  it("should floor to :30 for minutes 30-59", () => {
    expect(toUtcHalfHourStart("2026-03-07T10:45:00.000Z")).toBe(
      "2026-03-07T10:30:00.000Z",
    );
  });

  it("should handle exact boundaries (:00)", () => {
    expect(toUtcHalfHourStart("2026-03-07T10:00:00.000Z")).toBe(
      "2026-03-07T10:00:00.000Z",
    );
  });

  it("should handle exact boundaries (:30)", () => {
    expect(toUtcHalfHourStart("2026-03-07T10:30:00.000Z")).toBe(
      "2026-03-07T10:30:00.000Z",
    );
  });

  it("should handle minute 29 (edge of first half)", () => {
    expect(toUtcHalfHourStart("2026-03-07T10:29:59.999Z")).toBe(
      "2026-03-07T10:00:00.000Z",
    );
  });

  it("should handle midnight", () => {
    expect(toUtcHalfHourStart("2026-03-07T00:00:00.000Z")).toBe(
      "2026-03-07T00:00:00.000Z",
    );
  });

  it("should handle end of day", () => {
    expect(toUtcHalfHourStart("2026-03-07T23:59:59.999Z")).toBe(
      "2026-03-07T23:30:00.000Z",
    );
  });

  it("should return null for invalid timestamp", () => {
    expect(toUtcHalfHourStart("not a date")).toBeNull();
  });

  it("should handle epoch milliseconds as number", () => {
    // 2026-03-07T10:15:00.000Z as epoch ms
    const epochMs = new Date("2026-03-07T10:15:00.000Z").getTime();
    expect(toUtcHalfHourStart(epochMs)).toBe("2026-03-07T10:00:00.000Z");
  });
});

describe("bucketKey", () => {
  it("should create a composite key from source, model, and hourStart", () => {
    const key = bucketKey("claude-code", "claude-sonnet-4", "2026-03-07T10:00:00.000Z");
    expect(key).toBe("claude-code|claude-sonnet-4|2026-03-07T10:00:00.000Z");
  });
});

describe("emptyTokenDelta", () => {
  it("should return all zeros", () => {
    const delta = emptyTokenDelta();
    expect(delta.inputTokens).toBe(0);
    expect(delta.cachedInputTokens).toBe(0);
    expect(delta.outputTokens).toBe(0);
    expect(delta.reasoningOutputTokens).toBe(0);
  });
});

describe("addTokens", () => {
  it("should add delta to target in place", () => {
    const target: TokenDelta = {
      inputTokens: 100,
      cachedInputTokens: 10,
      outputTokens: 50,
      reasoningOutputTokens: 5,
    };
    const delta: TokenDelta = {
      inputTokens: 200,
      cachedInputTokens: 20,
      outputTokens: 100,
      reasoningOutputTokens: 10,
    };
    addTokens(target, delta);
    expect(target.inputTokens).toBe(300);
    expect(target.cachedInputTokens).toBe(30);
    expect(target.outputTokens).toBe(150);
    expect(target.reasoningOutputTokens).toBe(15);
  });

  it("should handle zero deltas", () => {
    const target: TokenDelta = {
      inputTokens: 100,
      cachedInputTokens: 10,
      outputTokens: 50,
      reasoningOutputTokens: 5,
    };
    addTokens(target, emptyTokenDelta());
    expect(target.inputTokens).toBe(100);
    expect(target.outputTokens).toBe(50);
  });
});
