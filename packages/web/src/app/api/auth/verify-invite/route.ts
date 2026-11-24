/**
 * POST /api/auth/verify-invite — public invite code verification.
 *
 * Validates the code exists and is unused (read-only check), then sets
 * a `pew-invite-code` cookie for the signIn callback to consume.
 *
 * This route is public — it falls under `/api/auth/*` which is already
 * allowed in proxy.ts.
 */

import { NextResponse } from "next/server";
import { getDbRead } from "@/lib/db";
import { validateInviteCode } from "@/lib/invite";
import { shouldUseSecureCookies } from "@/auth";

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ valid: false, error: "Invalid JSON" }, { status: 400 });
  }

  const { code } = body;

  // Format validation
  if (!validateInviteCode(code)) {
    return NextResponse.json(
      { valid: false, error: "Invalid invite code format" },
      { status: 400 },
    );
  }

  const db = await getDbRead();

  try {
    // Read-only check — does NOT consume the code
    const row = await db.checkInviteCodeExists(code);

    if (!row || row.used_by !== null) {
      return NextResponse.json(
        { valid: false, error: "Invalid or already used invite code" },
        { status: 400 },
      );
    }

    // Set the cookie for the signIn callback to read
    const secure = shouldUseSecureCookies();
    const response = NextResponse.json({ valid: true });
    response.cookies.set("pew-invite-code", code, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure,
      maxAge: 600, // 10 minutes
    });

    return response;
  } catch (err) {
    console.error("Failed to verify invite code:", err);
    return NextResponse.json(
      { valid: false, error: "Failed to verify invite code" },
      { status: 500 },
    );
  }
}
