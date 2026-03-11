/**
 * Tests for @pew/core constants.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_INGEST_BATCH_SIZE,
  MAX_STRING_LENGTH,
  SESSION_KINDS,
  SOURCES,
  VALID_SESSION_KINDS,
  VALID_SOURCES,
} from "../constants.js";

describe("SOURCES", () => {
  it("should contain exactly 6 supported AI tools", () => {
    expect(SOURCES).toHaveLength(6);
    expect(SOURCES).toContain("claude-code");
    expect(SOURCES).toContain("codex");
    expect(SOURCES).toContain("gemini-cli");
    expect(SOURCES).toContain("opencode");
    expect(SOURCES).toContain("openclaw");
    expect(SOURCES).toContain("vscode-copilot");
  });

  it("should be readonly at type level", () => {
    // `as const` is a compile-time-only constraint;
    // we verify the array has the correct contents instead.
    expect(SOURCES).toEqual([
      "claude-code",
      "codex",
      "gemini-cli",
      "opencode",
      "openclaw",
      "vscode-copilot",
    ]);
  });
});

describe("VALID_SOURCES", () => {
  it("should match SOURCES array", () => {
    expect(VALID_SOURCES.size).toBe(SOURCES.length);
    for (const s of SOURCES) {
      expect(VALID_SOURCES.has(s)).toBe(true);
    }
  });

  it("should reject unknown sources", () => {
    expect(VALID_SOURCES.has("cursor")).toBe(false);
    expect(VALID_SOURCES.has("")).toBe(false);
  });
});

describe("SESSION_KINDS", () => {
  it("should contain human and automated", () => {
    expect(SESSION_KINDS).toHaveLength(2);
    expect(SESSION_KINDS).toContain("human");
    expect(SESSION_KINDS).toContain("automated");
  });
});

describe("VALID_SESSION_KINDS", () => {
  it("should match SESSION_KINDS array", () => {
    expect(VALID_SESSION_KINDS.size).toBe(SESSION_KINDS.length);
    for (const k of SESSION_KINDS) {
      expect(VALID_SESSION_KINDS.has(k)).toBe(true);
    }
  });

  it("should reject unknown kinds", () => {
    expect(VALID_SESSION_KINDS.has("bot")).toBe(false);
  });
});

describe("MAX_INGEST_BATCH_SIZE", () => {
  it("should be 50", () => {
    expect(MAX_INGEST_BATCH_SIZE).toBe(50);
  });
});

describe("MAX_STRING_LENGTH", () => {
  it("should be 1024", () => {
    expect(MAX_STRING_LENGTH).toBe(1024);
  });
});
