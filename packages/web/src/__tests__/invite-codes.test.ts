import { describe, it, expect, vi } from "vitest";

// Mock auth and db modules to avoid next-auth import chain
vi.mock("@/auth", () => ({
  shouldUseSecureCookies: vi.fn(() => false),
}));
vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
  getDbWrite: vi.fn(),
  resetDb: vi.fn(),
}));

import {
  generateInviteCode,
  validateInviteCode,
  INVITE_ALPHABET,
  INVITE_CODE_LENGTH,
} from "@/lib/invite";

// ---------------------------------------------------------------------------
// Pure logic tests — no mocks needed
// ---------------------------------------------------------------------------

describe("generateInviteCode", () => {
  it("should return an 8-character uppercase alphanumeric string", () => {
    const code = generateInviteCode();
    expect(code).toHaveLength(INVITE_CODE_LENGTH);
    expect(code).toMatch(/^[A-Z0-9]+$/);
  });

  it("should only use characters from INVITE_ALPHABET (no 0, O, 1, I, L)", () => {
    // Generate many codes and check all chars are in the alphabet
    for (let i = 0; i < 50; i++) {
      const code = generateInviteCode();
      for (const ch of code) {
        expect(INVITE_ALPHABET).toContain(ch);
      }
    }
  });

  it("should generate unique codes (100 codes, no collisions)", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 100; i++) {
      codes.add(generateInviteCode());
    }
    expect(codes.size).toBe(100);
  });
});

describe("validateInviteCode", () => {
  it("should accept a valid 8-char code from the alphabet", () => {
    expect(validateInviteCode("A3K9X2M4")).toBe(true);
    expect(validateInviteCode("BCDEFGHJ")).toBe(true);
    expect(validateInviteCode("23456789")).toBe(true);
  });

  it("should reject empty string", () => {
    expect(validateInviteCode("")).toBe(false);
  });

  it("should reject too short codes", () => {
    expect(validateInviteCode("A3K9")).toBe(false);
    expect(validateInviteCode("A3K9X2M")).toBe(false);
  });

  it("should reject too long codes", () => {
    expect(validateInviteCode("A3K9X2M4Z")).toBe(false);
  });

  it("should reject lowercase characters", () => {
    expect(validateInviteCode("a3k9x2m4")).toBe(false);
  });

  it("should reject ambiguous characters (0, O, 1, I, L)", () => {
    expect(validateInviteCode("A3K9X2M0")).toBe(false); // 0
    expect(validateInviteCode("A3K9X2MO")).toBe(false); // O
    expect(validateInviteCode("A3K9X2M1")).toBe(false); // 1
    expect(validateInviteCode("A3K9X2MI")).toBe(false); // I
    expect(validateInviteCode("A3K9X2ML")).toBe(false); // L
  });

  it("should reject non-string values", () => {
    expect(validateInviteCode(null)).toBe(false);
    expect(validateInviteCode(undefined)).toBe(false);
    expect(validateInviteCode(12345678)).toBe(false);
    expect(validateInviteCode({})).toBe(false);
  });
});
