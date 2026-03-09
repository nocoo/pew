/**
 * GET /api/admin/check — check if the current user is an admin.
 *
 * Returns { isAdmin: true/false }.
 * Used by client-side components to conditionally show admin UI.
 */

import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth-helpers";
import { isAdmin } from "@/lib/admin";
import { getD1Client } from "@/lib/d1";

export async function GET(request: Request) {
  const authResult = await resolveUser(request);
  if (!authResult) {
    return NextResponse.json({ isAdmin: false });
  }

  let email = authResult.email;
  if (!email) {
    const client = getD1Client();
    const row = await client.firstOrNull<{ email: string }>(
      "SELECT email FROM users WHERE id = ?",
      [authResult.userId]
    );
    email = row?.email;
  }

  return NextResponse.json({ isAdmin: isAdmin(email) });
}
