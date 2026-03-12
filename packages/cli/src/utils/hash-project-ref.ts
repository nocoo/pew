/**
 * Privacy-safe project reference hashing.
 *
 * All project references are SHA-256 hashed before upload to ensure
 * pew never transmits plaintext project names, paths, or other
 * identifying information. The hash is truncated to 16 hex chars
 * (64 bits) — enough for uniqueness, short enough for display.
 *
 * This module is the single source of truth for project_ref hashing.
 * Parsers should use it directly, and toQueueRecord() applies it as
 * a defense-in-depth gateway before any data leaves the device.
 */

import { createHash } from "node:crypto";

/** Length of the hex prefix used for project_ref hashes */
export const PROJECT_REF_HASH_LENGTH = 16;

/**
 * Hash a project reference string.
 *
 * Returns a 16-char hex prefix of SHA-256(input), or null if input is null/empty.
 * Idempotent in practice: re-hashing a hash produces a different but equally
 * opaque value. The defense-in-depth layer in toQueueRecord() relies on this.
 */
export function hashProjectRef(raw: string | null): string | null {
  if (!raw) return null;
  return createHash("sha256")
    .update(raw)
    .digest("hex")
    .slice(0, PROJECT_REF_HASH_LENGTH);
}
