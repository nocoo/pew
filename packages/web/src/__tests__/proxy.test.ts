import { describe, it, expect, vi } from "vitest";

// Mock @/auth to avoid pulling in next-auth runtime
vi.mock("@/auth", () => ({
  auth: vi.fn((handler: unknown) => handler),
}));

import { buildRedirectUrl, isPublicRoute, resolveProxyAction } from "@/proxy";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Helper: create a minimal NextRequest
// ---------------------------------------------------------------------------

function makeReq(
  pathname: string,
  headers: Record<string, string> = {},
): NextRequest {
  const url = `https://pew.example.com${pathname}`;
  return new NextRequest(url, { headers });
}

// ---------------------------------------------------------------------------
// buildRedirectUrl
// ---------------------------------------------------------------------------

describe("buildRedirectUrl", () => {
  it("should use origin when no forwarded headers", () => {
    const req = makeReq("/dashboard");
    const url = buildRedirectUrl(req, "/login");
    expect(url.pathname).toBe("/login");
    expect(url.origin).toBe("https://pew.example.com");
  });

  it("should use x-forwarded-host and x-forwarded-proto", () => {
    const req = makeReq("/dashboard", {
      "x-forwarded-host": "proxy.example.com",
      "x-forwarded-proto": "http",
    });
    const url = buildRedirectUrl(req, "/login");
    expect(url.href).toBe("http://proxy.example.com/login");
  });

  it("should default to https when x-forwarded-proto is absent", () => {
    const req = makeReq("/dashboard", {
      "x-forwarded-host": "proxy.example.com",
    });
    const url = buildRedirectUrl(req, "/");
    expect(url.href).toBe("https://proxy.example.com/");
  });
});

// ---------------------------------------------------------------------------
// isPublicRoute
// ---------------------------------------------------------------------------

describe("isPublicRoute", () => {
  it.each([
    "/api/auth/callback/google",
    "/api/auth/signin",
    "/api/ingest",
    "/api/ingest/batch",
    "/api/users/john",
    "/api/leaderboard",
    "/api/leaderboard?period=week",
    "/u/john",
    "/",
    "/leaderboard",
  ])("should return true for public route: %s", (path) => {
    expect(isPublicRoute(path)).toBe(true);
  });

  it.each([
    "/dashboard",
    "/settings",
    "/login",
    "/api/usage",
  ])("should return false for protected route: %s", (path) => {
    expect(isPublicRoute(path)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveProxyAction
// ---------------------------------------------------------------------------

describe("resolveProxyAction", () => {
  it("should return 'next' when skipAuth is true", () => {
    expect(resolveProxyAction("/dashboard", false, true)).toBe("next");
  });

  it("should return 'next' for public routes", () => {
    expect(resolveProxyAction("/api/auth/signin", false, false)).toBe("next");
    expect(resolveProxyAction("/api/ingest", false, false)).toBe("next");
    expect(resolveProxyAction("/u/john", false, false)).toBe("next");
  });

  it("should redirect logged-in user away from login page to dashboard", () => {
    expect(resolveProxyAction("/login", true, false)).toBe("redirect:/dashboard");
  });

  it("should redirect unauthenticated user to login", () => {
    expect(resolveProxyAction("/dashboard", false, false)).toBe(
      "redirect:/login",
    );
  });

  it("should return 'next' for unauthenticated user on /leaderboard (public)", () => {
    expect(resolveProxyAction("/leaderboard", false, false)).toBe("next");
  });

  it("should allow unauthenticated user on landing page (/)", () => {
    expect(resolveProxyAction("/", false, false)).toBe("next");
  });

  it("should return 'next' for logged-in user on protected page", () => {
    expect(resolveProxyAction("/dashboard", true, false)).toBe("next");
  });

  it("should return 'next' for unauthenticated user on login page", () => {
    expect(resolveProxyAction("/login", false, false)).toBe("next");
  });
});
