import { describe, it, expect, vi, afterEach } from "vitest";

// Mock heavy next-auth dependencies to avoid runtime errors
vi.mock("next-auth", () => ({
  default: vi.fn(() => ({
    handlers: {},
    auth: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
  })),
}));
vi.mock("next-auth/providers/google", () => ({ default: {} }));
vi.mock("@/lib/auth-adapter", () => ({
  D1AuthAdapter: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
  getDbWrite: vi.fn(),
}));
vi.mock("@/lib/invite", () => ({
  handleInviteGate: vi.fn(() => true),
}));

import {
  shouldUseSecureCookies,
  jwtCallback,
  sessionCallback,
} from "@/auth";
import type { JWT } from "next-auth/jwt";
import type { Session } from "next-auth";

// ---------------------------------------------------------------------------
// shouldUseSecureCookies
// ---------------------------------------------------------------------------

describe("shouldUseSecureCookies", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("should return true when NODE_ENV is production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(shouldUseSecureCookies()).toBe(true);
  });

  it("should return true when NEXTAUTH_URL starts with https", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXTAUTH_URL", "https://pew.example.com");
    expect(shouldUseSecureCookies()).toBe(true);
  });

  it("should return true when USE_SECURE_COOKIES is true", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("USE_SECURE_COOKIES", "true");
    expect(shouldUseSecureCookies()).toBe(true);
  });

  it("should return false when none of the conditions are met", () => {
    vi.stubEnv("NODE_ENV", "test");
    delete process.env.NEXTAUTH_URL;
    delete process.env.USE_SECURE_COOKIES;
    expect(shouldUseSecureCookies()).toBe(false);
  });

  it("should return false when NEXTAUTH_URL is http", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXTAUTH_URL", "http://localhost:7030");
    delete process.env.USE_SECURE_COOKIES;
    expect(shouldUseSecureCookies()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// jwtCallback
// ---------------------------------------------------------------------------

describe("jwtCallback", () => {
  it("should persist user.id into token.userId", () => {
    const token = { sub: "abc" } as JWT;
    const result = jwtCallback({ token, user: { id: "user-123" } });
    expect(result.userId).toBe("user-123");
  });

  it("should not overwrite existing token when no user", () => {
    const token = { sub: "abc", userId: "existing" } as JWT;
    const result = jwtCallback({ token });
    expect(result.userId).toBe("existing");
  });

  it("should not set userId when user has no id", () => {
    const token = { sub: "abc" } as JWT;
    const result = jwtCallback({ token, user: {} });
    expect(result.userId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// sessionCallback
// ---------------------------------------------------------------------------

describe("sessionCallback", () => {
  it("should expose token.userId in session.user.id", () => {
    const session = { user: { id: "", name: "Alice" }, expires: "2026-12-31" } as Session;
    const token = { userId: "user-123" } as JWT;
    const result = sessionCallback({ session, token });
    expect(result.user?.id).toBe("user-123");
  });

  it("should not modify session when token has no userId", () => {
    const session = { user: { id: "old", name: "Bob" }, expires: "2026-12-31" } as Session;
    const token = {} as JWT;
    const result = sessionCallback({ session, token });
    expect(result.user?.id).toBe("old");
  });

  it("should not crash when session.user is undefined", () => {
    const session = { expires: "2026-12-31" } as Session;
    const token = { userId: "user-123" } as JWT;
    const result = sessionCallback({ session, token });
    expect(result.user).toBeUndefined();
  });
});
