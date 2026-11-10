/**
 * Admin authorization helpers.
 *
 * Admin status is determined by the ADMIN_EMAILS environment variable,
 * a comma-separated list of email addresses.
 *
 * In E2E mode with admin bypass (the shared gate plus E2E_ADMIN_BYPASS=true),
 * all users are treated as admins so Playwright tests can exercise admin
 * pages. This is separate from E2E_SKIP_AUTH alone, which only bypasses
 * authentication but preserves admin role checks.
 */

import { resolveUser, type AuthResult, E2E_TEST_USER_ID, E2E_TEST_USER_EMAIL } from "./auth-helpers";
import { getDbRead } from "./db";
import { isE2EMode } from "./e2e-mode";

// ---------------------------------------------------------------------------
// E2E mode checks
// ---------------------------------------------------------------------------

/** Check if admin bypass is enabled (for L3 Playwright tests) */
function isAdminBypass(): boolean {
  return isE2EMode() && process.env.E2E_ADMIN_BYPASS === "true";
}

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
  // In E2E mode with admin bypass, all users are admins
  if (isAdminBypass()) return true;
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
 *
 * In E2E mode with admin bypass, returns a synthetic admin user for testing.
 */
export async function resolveAdmin(
  request: Request
): Promise<AdminResult | null> {
  // In E2E mode with admin bypass, return synthetic admin user
  if (isAdminBypass()) {
    return { userId: E2E_TEST_USER_ID, email: E2E_TEST_USER_EMAIL };
  }

  const authResult = await resolveUser(request);
  if (!authResult) return null;

  // resolveUser may not always have the email (e.g. session without email)
  // If email is missing, look it up via RPC
  let email = authResult.email;
  if (!email) {
    const db = await getDbRead();
    email = await db.getUserEmail(authResult.userId) ?? undefined;
  }

  if (!isAdmin(email)) return null;

  return { userId: authResult.userId, email: email as string };
}

/**
 * Check if the given AuthResult represents an admin user.
 * Handles case where email may be missing from the auth result.
 */
export async function isAdminUser(
  authResult: AuthResult
): Promise<boolean> {
  // In E2E mode with admin bypass, all users are admins
  if (isAdminBypass()) return true;

  let email = authResult.email;
  if (!email) {
    const db = await getDbRead();
    email = await db.getUserEmail(authResult.userId) ?? undefined;
  }
  return isAdmin(email);
}
