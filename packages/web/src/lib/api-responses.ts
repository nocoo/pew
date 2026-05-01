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
