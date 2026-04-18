/**
 * Simple rate limiting utilities.
 *
 * Uses D1 to track request counts within sliding time windows.
 * No external dependencies (Redis, etc.) required.
 */

import { type DbRead } from "./db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RateLimitConfig {
  /** Maximum requests allowed within the window */
  maxRequests: number;
  /** Time window in seconds */
  windowSeconds: number;
}

export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Requests made in current window */
  current: number;
  /** Maximum allowed requests */
  limit: number;
  /** Seconds until window resets (approximate) */
  retryAfter: number;
}

// ---------------------------------------------------------------------------
// Rate Limit Check
// ---------------------------------------------------------------------------

/**
 * Check if a user has exceeded rate limit for showcase creation.
 *
 * Uses the showcases table's created_at to count recent creations.
 * This is a simple per-user rate limit, not a global one.
 *
 * @param dbRead - Database read client
 * @param userId - User ID to check
 * @param config - Rate limit configuration
 * @returns Rate limit result with allowed status and metadata
 */
export async function checkShowcaseRateLimit(
  dbRead: DbRead,
  userId: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const windowStart = new Date(
    Date.now() - config.windowSeconds * 1000
  ).toISOString();

  const result = await dbRead.firstOrNull<{ count: number }>(
    `SELECT COUNT(*) as count FROM showcases
     WHERE user_id = ? AND created_at >= ?`,
    [userId, windowStart]
  );

  const current = result?.count ?? 0;
  const allowed = current < config.maxRequests;

  return {
    allowed,
    current,
    limit: config.maxRequests,
    // Approximate: assume evenly distributed, return full window
    retryAfter: allowed ? 0 : config.windowSeconds,
  };
}

// ---------------------------------------------------------------------------
// In-Memory Sliding-Window Rate Limiter
// ---------------------------------------------------------------------------

/**
 * Simple in-memory rate limiter using a sliding window of timestamps.
 * Suitable for single-instance deployments (e.g. Cloudflare Workers, single Node process).
 * State is lost on restart — this is acceptable for brute-force mitigation.
 */
class InMemoryRateLimiter {
  private windows = new Map<string, number[]>();

  /** Clear all tracked windows (useful for testing). */
  reset(): void {
    this.windows.clear();
  }

  /**
   * Check (and record) a request.
   * @param key   - Unique key (e.g. "team-join:<userId>")
   * @param config - max requests + window size
   */
  check(key: string, config: RateLimitConfig): RateLimitResult {
    const now = Date.now();
    const windowMs = config.windowSeconds * 1000;
    const cutoff = now - windowMs;

    // Get existing timestamps and prune expired ones
    const timestamps = (this.windows.get(key) ?? []).filter((t) => t > cutoff);

    const allowed = timestamps.length < config.maxRequests;
    if (allowed) {
      timestamps.push(now);
    }

    this.windows.set(key, timestamps);

    return {
      allowed,
      current: timestamps.length,
      limit: config.maxRequests,
      retryAfter: allowed
        ? 0
        : Math.ceil(((timestamps[0] ?? now) + windowMs - now) / 1000),
    };
  }
}

/** Singleton in-memory rate limiter */
export const inMemoryRateLimiter = new InMemoryRateLimiter();

// ---------------------------------------------------------------------------
// Default Configurations
// ---------------------------------------------------------------------------

/** Rate limit for showcase creation: 20 showcases per hour */
export const SHOWCASE_CREATE_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 20,
  windowSeconds: 3600, // 1 hour
};

/** Rate limit for team join attempts: 5 per minute per user */
export const TEAM_JOIN_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 5,
  windowSeconds: 60,
};

/** Rate limit for auth code generation: 10 per hour per IP */
export const AUTH_CODE_GENERATE_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 10,
  windowSeconds: 3600, // 1 hour
};

/** Rate limit for auth code verification: 5 per minute per IP */
export const AUTH_CODE_VERIFY_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 5,
  windowSeconds: 60,
};

/** Rate limit for CLI auth callback: 10 per hour per IP */
export const AUTH_CLI_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 10,
  windowSeconds: 3600, // 1 hour
};

/** Rate limit for ingest endpoint: 300 per minute per user (or per IP if unauthenticated) */
export const INGEST_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 300,
  windowSeconds: 60,
};

// ---------------------------------------------------------------------------
// Client IP extraction
// ---------------------------------------------------------------------------

/**
 * Best-effort extraction of the client IP from a Request.
 *
 * Order of precedence:
 * 1. `x-forwarded-for` (first hop)
 * 2. `x-real-ip`
 * 3. `cf-connecting-ip` (Cloudflare)
 *
 * Falls back to "unknown" so rate limiting still applies as a global bucket
 * for requests where no proxy header is present.
 */
export function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  const cf = request.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();

  return "unknown";
}
