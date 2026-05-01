import { NextResponse } from "next/server";

/**
 * Standard 401 Unauthorized response for API routes.
 *
 * Use after `resolveUser()` returns null. The body shape is locked to
 * `{ error: "Unauthorized" }` to keep API contract stable — many client
 * hooks and tests assert that exact payload.
 *
 * Pure-display: this helper does not perform auth checks itself; the
 * route handler still owns the `if (!authResult) return ...` control flow.
 */
export function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/**
 * Standard 403 Forbidden response for admin-only API routes.
 *
 * Use after `isAdminUser()` returns false. The body shape is locked to
 * `{ error: "Forbidden" }` to keep API contract stable.
 *
 * Pure-display: this helper does not perform admin checks itself; the
 * route handler still owns the `if (!admin) return ...` control flow.
 * Do not use this for owner-only, owner-or-admin, or business-rule 403s
 * whose body text differs from "Forbidden".
 */
export function forbiddenResponse(): NextResponse {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
