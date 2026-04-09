/**
 * Shared RPC types between worker-read and web packages.
 *
 * These types define the contract for typed RPC calls to the read Worker.
 * Keep in sync with packages/worker-read/src/rpc/users.ts
 */

// ---------------------------------------------------------------------------
// Users domain types
// ---------------------------------------------------------------------------

/** User record for public profile display */
export interface UserProfile {
  id: string;
  name: string | null;
  nickname: string | null;
  image: string | null;
  slug: string | null;
  created_at: string;
  is_public: number;
}

/** User record for auth operations */
export interface UserAuth {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  email_verified: string | null;
}

/** User record for API key authentication */
export interface UserApiKeyAuth {
  id: string;
  email: string;
}

/** User settings */
export interface UserSettings {
  nickname: string | null;
  slug: string | null;
  is_public: number;
}

/** User search result */
export interface UserSearchResult {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
}

// ---------------------------------------------------------------------------
// Organizations domain types
// ---------------------------------------------------------------------------

/** Organization record */
export interface OrgRow {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/** Organization record with member count */
export interface OrgWithCountRow {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  member_count: number;
}

/** Organization member record */
export interface OrgMemberRow {
  user_id: string;
  name: string | null;
  image: string | null;
  slug: string | null;
  joined_at: string;
}

// ---------------------------------------------------------------------------
// Showcases domain types
// ---------------------------------------------------------------------------

/** Showcase record */
export interface ShowcaseRpcRow {
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
  stars: number;
  forks: number;
  language: string | null;
  license: string | null;
  topics: string | null;
  homepage: string | null;
  upvote_count: number;
  user_name: string | null;
  user_nickname: string | null;
  user_image: string | null;
  user_slug: string | null;
  has_upvoted?: number;
}

/** Showcase owner record */
export interface ShowcaseOwnerRow {
  id: string;
  user_id: string;
}

/** Showcase existence check result */
export interface ShowcaseExistsResult {
  exists: boolean;
  id?: string;
}

// ---------------------------------------------------------------------------
// Pricing domain types
// ---------------------------------------------------------------------------

/** Model pricing record */
export interface PricingRow {
  id: number;
  model: string;
  input: number;
  output: number;
  cached: number | null;
  source: string | null;
  note: string | null;
  updated_at: string;
  created_at: string;
}
