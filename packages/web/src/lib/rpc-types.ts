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
