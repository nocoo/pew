/**
 * Admin authorization helpers.
 *
 * Admin status is determined by the ADMIN_EMAILS environment variable,
 * a comma-separated list of email addresses.
 */

import { resolveUser, type AuthResult } from "./auth-helpers";
import { getDbRead } from "./db";

// ---------------------------------------------------------------------------
// Admin check
// ---------------------------------------------------------------------------

/**
 * Parse the ADMIN_EMAILS env var into a Set of lowercase emails.
 */
function getAdminEmails(): Set<string> {
  const raw = process.env.ADMIN_EMAILS ?? "";
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

/**
 * Check if the given email is an admin.
 */
export function isAdmin(email: string | undefined | null): boolean {
  if (!email) return false;
  return getAdminEmails().has(email.toLowerCase());
}

// ---------------------------------------------------------------------------
// Resolve admin user (auth + admin check combined)
// ---------------------------------------------------------------------------

export interface AdminResult extends AuthResult {
  email: string;
}

/**
 * Resolve the authenticated user AND verify admin status.
 * Returns null if not authenticated or not an admin.
 */
export async function resolveAdmin(
  request: Request
): Promise<AdminResult | null> {
  const authResult = await resolveUser(request);
  if (!authResult) return null;

  // resolveUser may not always have the email (e.g. session without email)
  // If email is missing, look it up from D1
  let email = authResult.email;
  if (!email) {
    const db = await getDbRead();
    const row = await db.firstOrNull<{ email: string }>(
      "SELECT email FROM users WHERE id = ?",
      [authResult.userId]
    );
    email = row?.email;
  }

  if (!isAdmin(email)) return null;

  return { userId: authResult.userId, email: email as string };
}
