/**
 * GET /api/admin/check — check if the current user is an admin.
 *
 * Returns { isAdmin: true/false }.
 * Used by client-side components to conditionally show admin UI.
 *
 * In E2E mode with admin bypass (the shared gate plus E2E_ADMIN_BYPASS), it
 * always returns { isAdmin: true } so Playwright tests
 * can exercise admin pages.
 */

import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth-helpers";
import { isE2EMode } from "@/lib/e2e-mode";
import { isAdmin } from "@/lib/admin";
import { getDbRead } from "@/lib/db";

/** Check if admin bypass is enabled (for L3 Playwright tests) */
function isAdminBypass(): boolean {
  return isE2EMode() && process.env.E2E_ADMIN_BYPASS === "true";
}

export async function GET(request: Request) {
  // In E2E mode with admin bypass, always return admin for testing
  if (isAdminBypass()) {
    return NextResponse.json({ isAdmin: true });
  }

  const authResult = await resolveUser(request);
  if (!authResult) {
    return NextResponse.json({ isAdmin: false });
  }

  let email: string | null | undefined = authResult.email;
  if (!email) {
    const db = await getDbRead();
    email = await db.getUserEmail(authResult.userId);
  }

  return NextResponse.json({ isAdmin: isAdmin(email) });
}
