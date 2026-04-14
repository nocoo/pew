/**
 * GET /api/auth/cli — CLI login callback endpoint.
 *
 * Flow:
 * 1. CLI starts local HTTP server, opens browser to this URL with ?callback=...
 * 2. User is already signed in via Google OAuth (or redirected to /login first)
 * 3. This endpoint generates a fresh api_key (stored as SHA-256 hash, replacing any old one)
 * 4. Redirects back to CLI's local server with api_key in query string
 *
 * Security:
 * - Callback URL must be localhost or 127.0.0.1
 * - API key is stored as SHA-256 hash — the raw key is only returned once
 * - Each login rotates the key, so old keys become invalid
 */

import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth-helpers";
import { getDbWrite } from "@/lib/db";
import { generateApiKey, hashApiKey } from "@/lib/crypto-utils";

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

  // 3. Generate a fresh api_key (key rotation on every login)
  const dbWrite = await getDbWrite();
  const userId = authResult.userId;
  const email = authResult.email ?? "";

  try {
    const rawApiKey = generateApiKey();
    const hashedKey = hashApiKey(rawApiKey);
    await dbWrite.execute(
      "UPDATE users SET api_key = ?, updated_at = datetime('now') WHERE id = ?",
      [hashedKey, userId]
    );

    // 4. Redirect back to CLI with api_key in query string.
    // The localhost callback is only accessible on the user's machine.
    const redirectUrl = new URL(callbackUrl.toString());
    redirectUrl.searchParams.set("api_key", rawApiKey);
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
