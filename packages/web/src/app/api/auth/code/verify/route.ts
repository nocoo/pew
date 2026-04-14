/**
 * POST /api/auth/code/verify — Verify a one-time code and return API key.
 *
 * Called by CLI with `pew login --code XXXX-XXXX`.
 * Returns the user's api_key (always generating a fresh one) and email.
 *
 * Security:
 * - Any failed verification attempt on an existing code immediately invalidates it
 *   (failed_attempts > 0). Error messages are intentionally generic to avoid
 *   leaking information about code existence.
 * - API keys are stored as SHA-256 hashes — the raw key is returned only once.
 * - Each successful verification rotates the key, replacing any old one.
 *
 * No session required — the code itself is the authentication.
 */

import { NextResponse } from "next/server";
import { getDbRead, getDbWrite } from "@/lib/db";
import { generateApiKey, hashApiKey } from "@/lib/crypto-utils";

// Generic error message for all auth failures (avoids information leakage)
const AUTH_ERROR = "Invalid or expired code";

export async function POST(request: Request) {
  // 1. Parse and validate request body
  let body: { code?: string } | null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Handle null/non-object JSON (e.g. JSON.parse("null") returns null)
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  }

  const code = body.code?.trim().toUpperCase();
  if (!code) {
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  }

  // Normalize: accept with or without hyphen
  const normalizedCode = code.includes("-") ? code : `${code.slice(0, 4)}-${code.slice(4)}`;

  const dbRead = await getDbRead();
  const dbWrite = await getDbWrite();

  try {
    // 2. Look up the code
    const authCode = await dbRead.getAuthCode(normalizedCode);

    // Code not found — return generic error
    if (!authCode) {
      return NextResponse.json({ error: AUTH_ERROR }, { status: 401 });
    }

    // 3. Check if code is still valid (not used, not expired, no failed attempts)
    const now = new Date();
    const expiresAt = new Date(authCode.expires_at);
    const isValid =
      !authCode.used_at &&
      now <= expiresAt &&
      authCode.failed_attempts === 0;

    if (!isValid) {
      // Code exists but is not valid — increment failed_attempts to ensure it stays invalid
      // (This handles edge case where code was valid but expired between check and now)
      await dbWrite.execute(
        `UPDATE auth_codes SET failed_attempts = failed_attempts + 1 WHERE code = ?`,
        [normalizedCode]
      );
      return NextResponse.json({ error: AUTH_ERROR }, { status: 401 });
    }

    // 4. Atomically consume the code FIRST to prevent race conditions.
    // Only one concurrent request can succeed — the loser gets "code already used"
    // and never touches the API key.
    const consumeResult = await dbWrite.execute(
      `UPDATE auth_codes
       SET used_at = datetime('now')
       WHERE code = ? AND used_at IS NULL AND failed_attempts = 0`,
      [normalizedCode]
    );

    if (consumeResult.changes === 0) {
      // Code was already consumed by a concurrent request
      return NextResponse.json({ error: AUTH_ERROR }, { status: 401 });
    }

    // 5. Code is now ours — look up the user
    const user = await dbRead.getUserById(authCode.user_id);

    if (!user) {
      // User was deleted after code creation — code is already consumed, just fail
      return NextResponse.json({ error: "User not found" }, { status: 500 });
    }

    // 6. Generate a fresh api_key (key rotation on every successful verification)
    // Safe from races — only one request reaches this point per code.
    const rawApiKey = generateApiKey();
    const hashedKey = hashApiKey(rawApiKey);
    await dbWrite.execute(
      `UPDATE users SET api_key = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [hashedKey, user.id]
    );

    // 7. Return credentials
    // This is the ONLY time the raw API key is visible to the user.
    return NextResponse.json({
      api_key: rawApiKey,
      email: user.email,
    });
  } catch (err) {
    console.error("Failed to verify auth code:", err);
    return NextResponse.json(
      { error: "Failed to verify code" },
      { status: 500 }
    );
  }
}
