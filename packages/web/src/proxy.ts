import { auth } from "@/auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Skip auth in E2E test environment
const SKIP_AUTH = process.env.E2E_SKIP_AUTH === "true";

/**
 * Trusted origin derived from NEXTAUTH_URL at startup.
 * Used to pin protocol and host — we never read X-Forwarded-Proto from the
 * request, preventing an attacker from injecting an arbitrary scheme.
 */
const TRUSTED_ORIGIN: { proto: string; host: string } | null = (() => {
  try {
    const raw = process.env.NEXTAUTH_URL;
    if (raw) {
      const u = new URL(raw);
      return { proto: u.protocol.replace(":", ""), host: u.host };
    }
  } catch {
    // Malformed NEXTAUTH_URL — treat as unset.
  }
  return null;
})();

/**
 * Build redirect URL using the pinned origin from NEXTAUTH_URL.
 *
 * The protocol is always derived from NEXTAUTH_URL (or defaults to "https"),
 * never from the X-Forwarded-Proto request header.
 * X-Forwarded-Host is only trusted when it matches the NEXTAUTH_URL host.
 *
 * Exported for unit testing.
 */
export function buildRedirectUrl(req: NextRequest, pathname: string): URL {
  const trustedProto = TRUSTED_ORIGIN?.proto ?? "https";
  const forwardedHost = req.headers.get("x-forwarded-host");

  if (
    forwardedHost &&
    TRUSTED_ORIGIN &&
    TRUSTED_ORIGIN.host === forwardedHost
  ) {
    return new URL(pathname, `${trustedProto}://${forwardedHost}`);
  }

  return new URL(pathname, req.nextUrl.origin);
}

/** Routes that are always public (no auth required). */
export function isPublicRoute(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/privacy" ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/ingest") ||
    pathname.startsWith("/api/users/") ||
    pathname.startsWith("/api/leaderboard") ||
    pathname.startsWith("/u/") ||
    pathname.startsWith("/leaderboard")
  );
}

/**
 * Determine the proxy action for the given request state.
 *
 * Returns:
 * - "next"              → allow through
 * - "redirect:/dashboard" → redirect to dashboard (logged-in user on login page)
 * - "redirect:/login"    → redirect to login (unauthenticated user)
 */
export function resolveProxyAction(
  pathname: string,
  isLoggedIn: boolean,
  skipAuth: boolean,
): "next" | "redirect:/dashboard" | "redirect:/login" {
  if (skipAuth) return "next";
  if (isPublicRoute(pathname)) return "next";
  if (pathname === "/login" && isLoggedIn) return "redirect:/dashboard";
  if (pathname !== "/login" && !isLoggedIn) return "redirect:/login";
  return "next";
}

// Next.js 16 proxy convention (replaces middleware.ts)
//
// With NextAuth's lazy-init pattern (`NextAuth((req) => config)`), the
// `initAuth()` inner function is async (lib/index.js:42). When `auth` is
// called with a callback (`auth((req) => {...})`), the `isReqWrapper` branch
// (line 60-69) returns a function — but because the outer function is async,
// the actual return value is `Promise<Function>`, not `Function`.
// We must `await` the result before calling it.
export async function proxy(request: NextRequest) {
  const authHandler = await auth((req) => {
    const action = resolveProxyAction(
      req.nextUrl.pathname,
      !!req.auth,
      SKIP_AUTH,
    );

    if (action === "next") return NextResponse.next();
    const target = action === "redirect:/dashboard" ? "/dashboard" : "/login";
    return NextResponse.redirect(buildRedirectUrl(req, target));
  });

  return authHandler(request, {} as never);
}

export const config = {
  matcher: [
    // Match all paths except static files and API routes (except /api/auth).
    // API routes handle their own auth via resolveUser() which supports
    // both session cookies and Bearer API key tokens.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.ico$|.*\\.svg$|api/(?!auth)).*)",
  ],
};
