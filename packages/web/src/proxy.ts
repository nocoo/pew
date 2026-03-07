import { auth } from "@/auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Skip auth in E2E test environment
const SKIP_AUTH = process.env.E2E_SKIP_AUTH === "true";

// Build redirect URL respecting reverse proxy headers
function buildRedirectUrl(req: NextRequest, pathname: string): URL {
  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto") || "https";

  if (forwardedHost) {
    return new URL(pathname, `${forwardedProto}://${forwardedHost}`);
  }

  return new URL(pathname, req.nextUrl.origin);
}

// Next.js 16 proxy convention (replaces middleware.ts)
const authHandler = auth((req) => {
  if (SKIP_AUTH) {
    return NextResponse.next();
  }

  const isLoggedIn = !!req.auth;
  const isLoginPage = req.nextUrl.pathname === "/login";
  const isAuthRoute = req.nextUrl.pathname.startsWith("/api/auth");
  const isIngestRoute = req.nextUrl.pathname.startsWith("/api/ingest");
  const isPublicApiRoute = req.nextUrl.pathname.startsWith("/api/users/");
  const isLeaderboardApi = req.nextUrl.pathname.startsWith("/api/leaderboard");
  const isPublicProfile = req.nextUrl.pathname.startsWith("/u/");
  const isLeaderboard = req.nextUrl.pathname === "/leaderboard";

  // Allow public routes through without auth
  if (
    isAuthRoute ||
    isIngestRoute ||
    isPublicApiRoute ||
    isLeaderboardApi ||
    isPublicProfile ||
    isLeaderboard
  ) {
    return NextResponse.next();
  }

  // Redirect to home if logged in and trying to access login page
  if (isLoginPage && isLoggedIn) {
    return NextResponse.redirect(buildRedirectUrl(req, "/"));
  }

  // Redirect to login if not logged in and trying to access protected page
  if (!isLoginPage && !isLoggedIn) {
    return NextResponse.redirect(buildRedirectUrl(req, "/login"));
  }

  return NextResponse.next();
});

// Export as named 'proxy' function for Next.js 16
export function proxy(request: NextRequest) {
  return authHandler(request, {} as never);
}

export const config = {
  matcher: [
    // Match all paths except static files
    "/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.ico$|.*\\.svg$).*)",
  ],
};
