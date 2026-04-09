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

/** User slug only (for settings fallback) */
export interface UserSlugOnly {
  slug: string | null;
}

/** User nickname and slug (for settings fallback) */
export interface UserNicknameSlug {
  nickname: string | null;
  slug: string | null;
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
// Projects domain types
// ---------------------------------------------------------------------------

/** Project record */
export interface ProjectRow {
  id: string;
  name: string;
  created_at: string;
}

/** Project tag record */
export interface ProjectTagRow {
  project_id: string;
  tag: string;
}

/** Alias stats row for projects list (from Worker RPC) */
export interface ProjectAliasStatsRow {
  source: string;
  project_ref: string;
  project_id: string | null;
  session_count: number;
  last_active: string | null;
  total_duration_seconds: number;
}

/** Unassigned ref row */
export interface ProjectUnassignedRow {
  source: string;
  project_ref: string;
  session_count: number;
  last_active: string | null;
  total_duration_seconds: number;
}

/** Timeline row for project activity */
export interface ProjectTimelineRow {
  project_id: string;
  day: string;
  session_count: number;
}

// ---------------------------------------------------------------------------
// Seasons domain types
// ---------------------------------------------------------------------------

/** Season list row with team count */
export interface SeasonRow {
  id: string;
  name: string;
  slug: string;
  start_date: string;
  end_date: string;
  created_at: string;
  team_count: number;
  has_snapshot: number;
  allow_late_registration: number;
  allow_roster_changes: number;
  allow_late_withdrawal: number;
}

/** Season detail row */
export interface SeasonDetailRow {
  id: string;
  name: string;
  slug: string;
  start_date: string;
  end_date: string;
  snapshot_ready: number;
  allow_late_registration: number;
  allow_roster_changes: number;
  allow_late_withdrawal: number;
  created_at: string;
  updated_at: string;
}

/** Season team registration row */
export interface SeasonTeamRegistrationRow {
  id: string;
  season_id: string;
  team_id: string;
  registered_by: string;
  created_at: string;
}

/** Aggregated team token data for snapshot generation */
export interface TeamAggRow {
  team_id: string;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
}

/** Aggregated member token data for snapshot generation */
export interface MemberAggRow {
  team_id: string;
  user_id: string;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
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
// Teams domain types
// ---------------------------------------------------------------------------

/** Team record for listing */
export interface TeamRow {
  id: string;
  name: string;
  slug: string;
  invite_code: string;
  created_by: string;
  created_at: string;
  logo_url: string | null;
  member_count: number;
}

/** Team detail record */
export interface TeamDetailRow {
  id: string;
  name: string;
  slug: string;
  invite_code: string;
  created_at: string;
  logo_url: string | null;
  auto_register_season: number | null;
}

/** Team member record */
export interface TeamMemberRow {
  user_id: string;
  name: string | null;
  nickname: string | null;
  slug: string | null;
  image: string | null;
  role: string;
  joined_at: string;
}

/** Team found by invite code */
export interface TeamByInviteCode {
  id: string;
  name: string;
  slug: string;
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

// ---------------------------------------------------------------------------
// Devices domain types
// ---------------------------------------------------------------------------

/** Device record with usage stats */
export interface DeviceRow {
  device_id: string;
  alias: string | null;
  first_seen: string | null;
  last_seen: string | null;
  total_tokens: number;
  sources: string | null;
  model_count: number;
}

/** Device existence check result */
export interface DeviceExistsResult {
  exists: boolean;
  device_id?: string;
}

/** Device usage record count */
export interface DeviceRecordCount {
  cnt: number;
}

// ---------------------------------------------------------------------------
// Auth domain types
// ---------------------------------------------------------------------------

/** Auth code record */
export interface AuthCodeRow {
  code: string;
  user_id: string;
  expires_at: string;
  used_at: string | null;
  failed_attempts: number;
}

/** Invite code record */
export interface InviteCodeRow {
  id: number;
  code: string;
  created_by: string;
  created_by_email: string | null;
  used_by: string | null;
  used_by_email: string | null;
  used_at: string | null;
  created_at: string;
}

/** Simple invite code for validation */
export interface InviteCodeSimple {
  id: number;
  used_by: string | null;
}

/** Invite code by ID for delete check */
export interface InviteCodeById {
  used_by: string | null;
}

// ---------------------------------------------------------------------------
// Settings domain types
// ---------------------------------------------------------------------------

/** App setting record */
export interface AppSettingRow {
  key: string;
  value: string;
  updated_at: string;
}

/** User setting record */
export interface UserSettingRow {
  key: string;
  value: string;
}
