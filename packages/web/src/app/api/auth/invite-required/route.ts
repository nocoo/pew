/**
 * GET /api/auth/invite-required — public endpoint to check if invite code is required.
 *
 * Returns { required: boolean }.
 * This is a public endpoint (no auth required) so the login page can conditionally
 * show/hide the invite code input.
 */

import { NextResponse } from "next/server";
import { getDbRead } from "@/lib/db";

export async function GET() {
  const dbRead = await getDbRead();

  try {
    const row = await dbRead.firstOrNull<{ value: string }>(
      "SELECT value FROM app_settings WHERE key = 'require_invite_code'"
    );

    // Default to true if setting doesn't exist
    const required = row?.value !== "false";

    return NextResponse.json(
      { required },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
        },
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("no such table")) {
      // Table doesn't exist yet — default to required
      return NextResponse.json({ required: true });
    }
    console.error("Failed to check invite requirement:", err);
    // On error, default to required (safer)
    return NextResponse.json({ required: true });
  }
}
