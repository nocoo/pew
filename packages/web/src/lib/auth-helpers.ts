/**
 * Shared auth helper for API routes.
 *
 * In E2E mode (E2E_SKIP_AUTH=true + NODE_ENV=development), returns a
 * deterministic test user so that API tests can run without OAuth.
 */

import { auth } from "@/auth";
import { getDbRead } from "@/lib/db";

/** The fixed user ID used when E2E auth is bypassed */
export const E2E_TEST_USER_ID = "e2e-test-user-id";
export const E2E_TEST_USER_EMAIL = "e2e@test.local";

export interface AuthResult {
  userId: string;
  email?: string | undefined;
}

/**
 * Resolve the authenticated user for an API request.
 *
 * Priority:
 * 1. E2E bypass (E2E_SKIP_AUTH=true in development)
 * 2. Auth.js session
 * 3. Bearer api_key
 *
 * Returns null if not authenticated.
 */
export async function resolveUser(
  request: Request,
): Promise<AuthResult | null> {
  // E2E bypass: deterministic test user
  if (isE2EMode()) {
    return { userId: E2E_TEST_USER_ID, email: E2E_TEST_USER_EMAIL };
  }

  // Session auth
  const session = await auth();
  if (session?.user?.id) {
    return { userId: session.user.id, email: session.user.email ?? undefined };
  }

  // Bearer api_key auth
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const apiKey = authHeader.slice(7);
    const db = await getDbRead();
    const row = await db.getUserByApiKey(apiKey);
    if (row) {
      return { userId: row.id, email: row.email };
    }
  }

  return null;
}

/** Check if we're running in E2E skip-auth mode */
function isE2EMode(): boolean {
  return (
    process.env.E2E_SKIP_AUTH === "true" &&
    process.env.NODE_ENV === "development"
  );
}
