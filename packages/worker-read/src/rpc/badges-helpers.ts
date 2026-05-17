/**
 * Pure helpers extracted from badges.ts to keep that file under the
 * 400-LOC complexity guideline. No runtime behavior change.
 */
import type { BadgeAssignmentStatus } from "@pew/core";

/**
 * Derive the current status of a badge assignment from its revoked/expiry
 * timestamps. Pure function — no I/O.
 *
 * Precedence (first match wins):
 *  1. revokedAt present + revokedAt <= expiresAt → "revoked_early"
 *  2. revokedAt present + revokedAt > expiresAt  → "revoked_post_expiry"
 *  3. expiresAt <= now                           → "expired"
 *  4. otherwise                                  → "active"
 */
export function deriveAssignmentStatus(
  revokedAt: string | null,
  expiresAt: string,
  now: Date = new Date(),
): BadgeAssignmentStatus {
  if (revokedAt) {
    const revokedDate = new Date(revokedAt);
    const expiresDate = new Date(expiresAt);
    return revokedDate <= expiresDate ? "revoked_early" : "revoked_post_expiry";
  }
  if (new Date(expiresAt) <= now) return "expired";
  return "active";
}
