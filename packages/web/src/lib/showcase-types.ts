/**
 * Shared types and constants for Showcase feature.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum length for user-provided tagline (tweet-length) */
export const MAX_TAGLINE_LENGTH = 280;

/** Default pagination limit for showcase list */
export const DEFAULT_SHOWCASE_LIMIT = 20;

/** Maximum pagination limit for public showcase list */
export const MAX_SHOWCASE_LIMIT = 100;

/** Maximum pagination limit for admin showcase list */
export const MAX_ADMIN_SHOWCASE_LIMIT = 200;

/** Default pagination limit for admin showcase list */
export const DEFAULT_ADMIN_SHOWCASE_LIMIT = 50;

// ---------------------------------------------------------------------------
// Database Row Types
// ---------------------------------------------------------------------------

/**
 * Base showcase row fields returned from database queries.
 */
export interface ShowcaseRowBase {
  id: string;
  user_id: string;
  repo_key: string;
  github_url: string;
  title: string;
  description: string | null;
  tagline: string | null;
  og_image_url: string | null;
  is_public: number;
  created_at: string;
  refreshed_at: string;
  // GitHub stats
  stars: number;
  forks: number;
  language: string | null;
  license: string | null;
  topics: string | null; // JSON string in DB
  homepage: string | null;
  // Computed via subquery
  upvote_count: number;
}

/**
 * Showcase row with joined user fields for public/user endpoints.
 * Includes optional `has_upvoted` for authenticated requests.
 */
export interface ShowcaseRow extends ShowcaseRowBase {
  // Joined user fields
  user_name: string | null;
  user_nickname: string | null;
  user_image: string | null;
  user_slug: string | null;
  // Computed for authenticated users
  has_upvoted?: number;
}

/**
 * Showcase row for admin endpoints.
 * Includes user email for moderation, excludes has_upvoted.
 */
export interface AdminShowcaseRow extends ShowcaseRowBase {
  // Joined user fields (admin includes email)
  user_name: string | null;
  user_nickname: string | null;
  user_image: string | null;
  user_slug: string | null;
  user_email: string;
}
