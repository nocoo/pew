/**
 * Tests for @pew/core constants.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_INGEST_BATCH_SIZE,
  MAX_STRING_LENGTH,
  SESSION_KINDS,
  SOURCES,
  RETIRED_SOURCES,
  VALID_SESSION_KINDS,
  VALID_SOURCES,
} from "../constants.js";

describe("SOURCES", () => {
  it("should contain exactly 10 supported AI tools", () => {
    expect(SOURCES).toHaveLength(10);
    expect(SOURCES).toContain("antigravity");
    expect(SOURCES).toContain("claude-code");
    expect(SOURCES).toContain("codex");
    expect(SOURCES).toContain("copilot-cli");
    expect(SOURCES).toContain("grok");
    expect(SOURCES).toContain("hermes");
    expect(SOURCES).toContain("opencode");
    expect(SOURCES).toContain("openclaw");
    expect(SOURCES).toContain("pi");
    expect(SOURCES).toContain("workbuddy");
  });

  it("should be readonly and contain every source", () => {
    // `as const` is a compile-time-only constraint;
    // we verify the array has the correct contents instead.
    expect(SOURCES).toEqual([
      "antigravity",
      "claude-code",
      "codex",
      "copilot-cli",
      "grok",
      "hermes",
      "opencode",
      "openclaw",
      "pi",
      "workbuddy",
    ]);
  });
});

describe("VALID_SOURCES", () => {
  it("retains all historical identities independently of active support", () => {
    expect(VALID_SOURCES.size).toBe(16);
    expect(RETIRED_SOURCES).toEqual(["gemini-cli", "kosmos", "omp", "pmstudio", "vscode-copilot", "zcode"]);
    expect(SOURCES.some((source) => RETIRED_SOURCES.includes(source))).toBe(false);
    for (const s of [...SOURCES, ...RETIRED_SOURCES]) {
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
