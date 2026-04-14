/**
 * Shared auth helper for API routes.
 *
 * In E2E mode (E2E_SKIP_AUTH=true + NODE_ENV=development), returns the
 * test user configured via E2E_TEST_USER_ID / E2E_TEST_USER_EMAIL env vars
 * so that API tests can run without OAuth. Defaults to a fixed ID for
 * local dev; the E2E runner overrides these with a per-run unique ID to
 * prevent concurrent CI jobs from colliding on the shared test database.
 */

import { auth } from "@/auth";
import { getDbRead } from "@/lib/db";
import { hashApiKey } from "@/lib/crypto-utils";

/** The user ID used when E2E auth is bypassed (overridable via env) */
export const E2E_TEST_USER_ID =
  process.env.E2E_TEST_USER_ID || "e2e-test-user-id";
export const E2E_TEST_USER_EMAIL =
  process.env.E2E_TEST_USER_EMAIL || "e2e@test.local";

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
  // Try hashed lookup first (new keys), then fall back to plaintext (legacy keys)
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const apiKey = authHeader.slice(7);
    const db = await getDbRead();

    // Try hashed key lookup (new keys stored as "hash:<sha256>")
    const hashedKey = hashApiKey(apiKey);
    const row = await db.getUserByApiKey(hashedKey);
    if (row) {
      return { userId: row.id, email: row.email };
    }

    // Fall back to plaintext lookup (legacy pre-migration keys)
    const legacyRow = await db.getUserByApiKey(apiKey);
    if (legacyRow) {
      return { userId: legacyRow.id, email: legacyRow.email };
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
