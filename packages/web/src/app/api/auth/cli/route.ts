/**
 * GET /api/auth/cli — CLI login callback endpoint.
 *
 * Flow:
 * 1. CLI starts local HTTP server, opens browser to this URL with ?callback=...
 * 2. User is already signed in via Google OAuth (or redirected to /login first)
 * 3. This endpoint fetches/generates user's api_key
 * 4. Redirects back to CLI's local server with api_key + email in query params
 *
 * Security: callback URL must be localhost or 127.0.0.1.
 */

import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth-helpers";
import { getD1Client } from "@/lib/d1";

/**
 * Resolve the public-facing origin from the request.
 *
 * In production behind Railway's reverse proxy, `request.url` contains the
 * internal container URL (e.g. `http://0.0.0.0:8080`). We must use the
 * forwarded headers or NEXTAUTH_URL to construct the correct public origin.
 */
export function getPublicOrigin(request: Request): string {
  const fwdHost = request.headers.get("x-forwarded-host");
  if (fwdHost) {
    const fwdProto = request.headers.get("x-forwarded-proto") || "https";
    return `${fwdProto}://${fwdHost}`;
  }

  if (process.env.NEXTAUTH_URL) {
    return process.env.NEXTAUTH_URL;
  }

  return new URL(request.url).origin;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const callback = url.searchParams.get("callback");
  const state = url.searchParams.get("state");

  // 1. Check authentication
  const authResult = await resolveUser(request);
  if (!authResult) {
    // Redirect to login page, preserving the return URL
    const returnUrl = url.pathname + url.search;
    const origin = getPublicOrigin(request);
    return NextResponse.redirect(
      new URL(`/login?callbackUrl=${encodeURIComponent(returnUrl)}`, origin)
    );
  }

  // 2. Validate callback parameter
  if (!callback) {
    return NextResponse.json(
      { error: "Missing callback parameter" },
      { status: 400 }
    );
  }

  let callbackUrl: URL;
  try {
    callbackUrl = new URL(callback);
  } catch {
    return NextResponse.json(
      { error: "Invalid callback URL" },
      { status: 400 }
    );
  }

  // Security: only allow localhost callbacks
  if (
    callbackUrl.hostname !== "localhost" &&
    callbackUrl.hostname !== "127.0.0.1"
  ) {
    return NextResponse.json(
      { error: "callback must be a localhost URL" },
      { status: 400 }
    );
  }

  // 3. Get or generate api_key
  const client = getD1Client();
  const userId = authResult.userId;
  const email = authResult.email ?? "";

  try {
    const row = await client.firstOrNull<{ api_key: string | null }>(
      "SELECT api_key FROM users WHERE id = ?",
      [userId]
    );

    let apiKey = row?.api_key;

    if (!apiKey) {
      // Generate a new api_key
      apiKey = generateApiKey();
      await client.execute(
        "UPDATE users SET api_key = ?, updated_at = datetime('now') WHERE id = ?",
        [apiKey, userId]
      );
    }

    // 4. Redirect back to CLI with api_key + state
    const redirectUrl = new URL(callbackUrl.toString());
    redirectUrl.searchParams.set("api_key", apiKey);
    redirectUrl.searchParams.set("email", email);
    if (state) {
      redirectUrl.searchParams.set("state", state);
    }

    return NextResponse.redirect(redirectUrl.toString());
  } catch (err) {
    console.error("CLI auth error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/** Generate a random API key: pk_ prefix + 32 hex chars */
function generateApiKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    ""
  );
  return `pk_${hex}`;
}
