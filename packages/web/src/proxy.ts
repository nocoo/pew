import { auth } from "@/auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Skip auth in E2E test environment
const SKIP_AUTH = process.env.E2E_SKIP_AUTH === "true";

/**
 * Build redirect URL respecting reverse proxy headers.
 * Exported for unit testing.
 */
export function buildRedirectUrl(req: NextRequest, pathname: string): URL {
  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto") || "https";

  if (forwardedHost) {
    return new URL(pathname, `${forwardedProto}://${forwardedHost}`);
  }

  return new URL(pathname, req.nextUrl.origin);
}

/** Routes that are always public (no auth required). */
export function isPublicRoute(pathname: string): boolean {
  return (
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
 * - "redirect:/"        → redirect to home (logged-in user on login page)
 * - "redirect:/login"   → redirect to login (unauthenticated user)
 */
export function resolveProxyAction(
  pathname: string,
  isLoggedIn: boolean,
  skipAuth: boolean,
): "next" | "redirect:/" | "redirect:/login" {
  if (skipAuth) return "next";
  if (isPublicRoute(pathname)) return "next";
  if (pathname === "/login" && isLoggedIn) return "redirect:/";
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
    const target = action === "redirect:/" ? "/" : "/login";
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
