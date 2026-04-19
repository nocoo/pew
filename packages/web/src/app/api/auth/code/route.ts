/**
 * POST /api/auth/code — Generate a one-time CLI authentication code.
 *
 * The code is 8 characters (XXXX-XXXX format), using a human-readable alphabet
 * that excludes ambiguous characters (0/O/I/L/1). Valid for 5 minutes.
 *
 * Requires session authentication (user must be logged in via browser).
 */

import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth-helpers";
import { getDbWrite } from "@/lib/db";
import {
  AUTH_CODE_GENERATE_RATE_LIMIT,
  getClientIp,
  inMemoryRateLimiter,
} from "@/lib/rate-limit";

// Human-readable alphabet: excludes 0/O/I/L/1 to avoid confusion
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8; // 4 + 4 with hyphen
const EXPIRY_MINUTES = 5;

/**
 * Generate a cryptographically random code in XXXX-XXXX format.
 */
function generateCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);

  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    if (i === 4) code += "-";
    const byte = bytes[i];
    if (byte !== undefined) {
      code += ALPHABET[byte % ALPHABET.length];
    }
  }
  return code;
}

export async function POST(request: Request) {
  // Rate limit: 10 code generations per hour per IP
  const ip = getClientIp(request);
  const rl = inMemoryRateLimiter.check(
    `auth-code-generate:${ip}`,
    AUTH_CODE_GENERATE_RATE_LIMIT,
  );
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  // 1. Require session authentication
  const authResult = await resolveUser(request);
  if (!authResult) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = authResult.userId;
  const dbWrite = await getDbWrite();

  try {
    // 2. Generate new code and insert (retry with new code on collision)
    const expiresAt = new Date(Date.now() + EXPIRY_MINUTES * 60 * 1000).toISOString();
    let code = generateCode();
    let attempts = 0;

    while (attempts < 3) {
      try {
        await dbWrite.execute(
          `INSERT INTO auth_codes (code, user_id, expires_at)
           VALUES (?, ?, ?)`,
          [code, userId, expiresAt]
        );
        break;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("UNIQUE constraint") && attempts < 2) {
          attempts++;
          code = generateCode(); // Generate a fresh code for next attempt
          continue;
        }
        throw err;
      }
    }

    // Note: We intentionally do NOT invalidate other codes here.
    // Doing so would create a race condition where concurrent requests
    // could invalidate each other's newly-created codes.
    // Old codes will expire naturally (5 minutes) and each code can
    // only be used once, so having multiple valid codes is safe.

    return NextResponse.json({
      code,
      expires_at: expiresAt,
    });
  } catch (err) {
    console.error("Failed to generate auth code:", err);
    return NextResponse.json(
      { error: "Failed to generate code" },
      { status: 500 }
    );
  }
}
