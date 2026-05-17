/**
 * Type-only definitions for the users RPC. Extracted from users.ts so the
 * handler file stays under the 400-LOC complexity guideline.
 */

// ---------------------------------------------------------------------------
// Types
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

// ---------------------------------------------------------------------------
// Request/Response types for each RPC method
// ---------------------------------------------------------------------------

export interface GetUserByIdRequest {
  method: "users.getById";
  id: string;
}

export interface GetUserBySlugRequest {
  method: "users.getBySlug";
  slug: string;
}

export interface GetUserByEmailRequest {
  method: "users.getByEmail";
  email: string;
}

export interface GetUserByApiKeyRequest {
  method: "users.getByApiKey";
  apiKey: string;
}

export interface GetUserByOAuthAccountRequest {
  method: "users.getByOAuthAccount";
  provider: string;
  providerAccountId: string;
}

export interface CheckSlugExistsRequest {
  method: "users.checkSlugExists";
  slug: string;
  excludeUserId?: string;
}

export interface GetUserSettingsRequest {
  method: "users.getSettings";
  userId: string;
}

export interface GetUserApiKeyRequest {
  method: "users.getApiKey";
  userId: string;
}

export interface GetUserEmailRequest {
  method: "users.getEmail";
  userId: string;
}

export interface SearchUsersRequest {
  method: "users.search";
  query: string;
  limit?: number;
}

export interface SearchUsersResult {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
}

export interface GetUserSlugOnlyRequest {
  method: "users.getSlugOnly";
  userId: string;
}

export interface GetUserNicknameSlugRequest {
  method: "users.getNicknameSlug";
  userId: string;
}

export interface CheckSharedTeamRequest {
  method: "users.checkSharedTeam";
  userId1: string;
  userId2: string;
}

export interface CheckSharedSeasonRequest {
  method: "users.checkSharedSeason";
  userId1: string;
  userId2: string;
}

export interface GetUserFirstSeenRequest {
  method: "users.getFirstSeen";
  userId: string;
}

export interface GetPublicUserBySlugOrIdRequest {
  method: "users.getPublicBySlugOrId";
  slugOrId: string;
}

/** Union of all users RPC requests */
export type UsersRpcRequest =
  | GetUserByIdRequest
  | GetUserBySlugRequest
  | GetUserByEmailRequest
  | GetUserByApiKeyRequest
  | GetUserByOAuthAccountRequest
  | CheckSlugExistsRequest
  | GetUserSettingsRequest
  | GetUserApiKeyRequest
  | GetUserEmailRequest
  | SearchUsersRequest
  | GetUserSlugOnlyRequest
  | GetUserNicknameSlugRequest
  | CheckSharedTeamRequest
  | CheckSharedSeasonRequest
  | GetUserFirstSeenRequest
  | GetPublicUserBySlugOrIdRequest;
