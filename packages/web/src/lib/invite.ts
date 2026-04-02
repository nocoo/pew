/**
 * Invite code helpers.
 *
 * - generateInviteCode: create random 8-char codes
 * - validateInviteCode: format validation
 * - handleInviteGate: signIn callback logic to gate new registrations
 */

import { getDbRead, getDbWrite } from "./db";
import { shouldUseSecureCookies } from "@/auth";
import type { DbRead, DbWrite } from "./db";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Alphabet for invite codes — uppercase alphanumeric excluding
 * ambiguous characters: 0/O, 1/I/L.
 */
export const INVITE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const INVITE_CODE_LENGTH = 8;

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

/**
 * Generate a single random invite code.
 * Uses crypto.getRandomValues for secure randomness.
 */
export function generateInviteCode(): string {
  const bytes = new Uint8Array(INVITE_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    code += INVITE_ALPHABET[(bytes[i] as number) % INVITE_ALPHABET.length];
  }
  return code;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const INVITE_CODE_RE = new RegExp(
  `^[${INVITE_ALPHABET}]{${INVITE_CODE_LENGTH}}$`
);

/**
 * Validate that a string matches the invite code format.
 * Returns true if the code is syntactically valid.
 */
export function validateInviteCode(code: unknown): code is string {
  return typeof code === "string" && INVITE_CODE_RE.test(code);
}

// ---------------------------------------------------------------------------
// Invite gate (signIn callback logic)
// ---------------------------------------------------------------------------

/**
 * Minimal request interface for the invite gate.
 * Matches NextRequest shape without importing Next.js types.
 */
export interface InviteGateRequest {
  cookies: {
    get(name: string): { value: string } | undefined;
  };
}

/**
 * Account info passed by Auth.js signIn callback.
 */
export interface InviteGateAccount {
  provider: string;
  providerAccountId: string;
  email?: string | null;
}

/**
 * Handle the invite gate in the signIn callback.
 *
 * Returns:
 * - `true` to allow sign-in (existing user or valid invite code)
 * - a redirect URL string to deny sign-in (redirect to /login?error=InviteRequired)
 *
 * @param req - The request object (from lazy init closure), may be undefined
 * @param account - The OAuth account info
 * @param dbReadOverride - Optional DbRead (for testing; defaults to singleton)
 * @param dbWriteOverride - Optional DbWrite (for testing; defaults to singleton)
 */
export async function handleInviteGate(
  req: InviteGateRequest | undefined | null,
  account: InviteGateAccount | null,
  dbReadOverride?: DbRead,
  dbWriteOverride?: DbWrite
): Promise<true | string> {
  // E2E test bypass
  if (
    process.env.E2E_SKIP_AUTH === "true" &&
    process.env.NODE_ENV !== "production"
  ) {
    return true;
  }

  // No request context (Server Component call) — allow
  if (!req) return true;

  // No account info — shouldn't happen but allow (Auth.js will handle)
  if (!account) return true;

  const dbRead = dbReadOverride ?? (await getDbRead());
  const dbWrite = dbWriteOverride ?? (await getDbWrite());

  // Check if user already exists (existing users bypass invite check)
  const existingUser = await dbRead.firstOrNull<{ id: string }>(
    `SELECT u.id
     FROM users u
     JOIN accounts a ON u.id = a.user_id
     WHERE a.provider = ? AND a.provider_account_id = ?`,
    [account.provider, account.providerAccountId]
  );

  if (existingUser) return true;

  // Check if invite code is required (default: true)
  const requireInviteSetting = await dbRead.firstOrNull<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = 'require_invite_code'"
  );
  const requireInviteCode = requireInviteSetting?.value !== "false";

  // If invite code is not required, allow all new registrations
  if (!requireInviteCode) return true;

  // New user — check invite code cookie
  const inviteCode = req.cookies.get("pew-invite-code")?.value;
  if (!inviteCode || !validateInviteCode(inviteCode)) {
    return buildInviteRequiredUrl(req);
  }

  // Atomically consume the invite code
  // pending:<email> so admin can diagnose burned codes by email;
  // fall back to providerAccountId if email is unavailable
  const pendingLabel = account.email || account.providerAccountId;
  const meta = await dbWrite.execute(
    `UPDATE invite_codes
     SET used_by = ?, used_at = datetime('now')
     WHERE code = ? AND used_by IS NULL`,
    [`pending:${pendingLabel}`, inviteCode]
  );

  if (meta.changes === 0) {
    // Code was invalid or already used
    return buildInviteRequiredUrl(req);
  }

  // Code consumed — Auth.js will proceed to createUser
  return true;
}

/**
 * Build the /login?error=InviteRequired&callbackUrl=... redirect URL.
 * Reads callbackUrl from the Auth.js callback-url cookie.
 */
function buildInviteRequiredUrl(req: InviteGateRequest): string {
  const cookieName = shouldUseSecureCookies()
    ? "__Secure-authjs.callback-url"
    : "authjs.callback-url";
  const callbackUrl = req.cookies.get(cookieName)?.value ?? "/";
  return `/login?error=InviteRequired&callbackUrl=${encodeURIComponent(callbackUrl)}`;
}
