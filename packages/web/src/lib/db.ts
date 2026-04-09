/**
 * Database abstraction layer.
 *
 * Read operations go through the pew read Worker (Cloudflare, native D1
 * binding). Write operations go through the D1 REST API.
 */

import type {
  UserProfile,
  UserAuth,
  UserApiKeyAuth,
  UserSettings,
  UserSearchResult,
  UserSlugOnly,
  UserNicknameSlug,
  OrgRow,
  OrgWithCountRow,
  OrgMemberRow,
  ProjectRow,
  ProjectTagRow,
  ProjectAliasStatsRow,
  ProjectUnassignedRow,
  ProjectTimelineRow,
  SeasonRow,
  SeasonDetailRow,
  SeasonTeamRegistrationRow,
  TeamAggRow,
  MemberAggRow,
  SeasonSnapshotRow,
  SeasonMemberSnapshotRow,
  SeasonTeamTokenRow,
  SeasonMemberTokenRow,
  SeasonTeamSessionStatsRow,
  SeasonMemberSessionStatsRow,
  ShowcaseRpcRow,
  ShowcaseOwnerRow,
  ShowcaseExistsResult,
  SessionRecordRow,
  PricingRow,
  AdminStorageUserRow,
  UsageRecordRow,
  UsageDeviceSummaryRow,
  UsageCostDetailRow,
  UsageDeviceTimelineRow,
  TeamRow,
  TeamDetailRow,
  TeamMemberRow,
  TeamByInviteCode,
  DeviceRow,
  AuthCodeRow,
  InviteCodeRow,
  InviteCodeSimple,
  InviteCodeById,
  AppSettingRow,
  UserSettingRow,
  LeaderboardEntryRow,
  LeaderboardUserTeamRow,
  LeaderboardSessionStatsRow,
  AchievementUsageAggregates,
  AchievementDailyUsageRow,
  AchievementDailyCostRow,
  AchievementDiversityCounts,
  AchievementSessionAggregates,
  AchievementHourlyUsageRow,
  AchievementCostByModelSourceRow,
  AchievementEarnerRow,
} from "./rpc-types";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface DbQueryResult<T = Record<string, unknown>> {
  results: T[];
  meta: { changes: number; duration: number };
}

// ---------------------------------------------------------------------------
// Read interface — Worker adapter (pew read Worker)
// ---------------------------------------------------------------------------

export interface DbRead {
  // Legacy SQL proxy (being migrated to typed RPC)
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<DbQueryResult<T>>;

  firstOrNull<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T | null>;

  // ---------------------------------------------------------------------------
  // Users domain RPC methods
  // ---------------------------------------------------------------------------

  /** Get user by ID (for auth) */
  getUserById(id: string): Promise<UserAuth | null>;

  /** Get user profile by slug (for public profile page) */
  getUserBySlug(slug: string): Promise<UserProfile | null>;

  /** Get user by email (for auth) */
  getUserByEmail(email: string): Promise<UserAuth | null>;

  /** Authenticate user by API key */
  getUserByApiKey(apiKey: string): Promise<UserApiKeyAuth | null>;

  /** Get user by OAuth provider account */
  getUserByOAuthAccount(
    provider: string,
    providerAccountId: string,
  ): Promise<UserAuth | null>;

  /** Check if slug exists (optionally excluding a user) */
  checkSlugExists(slug: string, excludeUserId?: string): Promise<boolean>;

  /** Get user settings */
  getUserSettings(userId: string): Promise<UserSettings | null>;

  /** Get user's API key */
  getUserApiKey(userId: string): Promise<string | null>;

  /** Get user email (admin) */
  getUserEmail(userId: string): Promise<string | null>;

  /** Search users by name/email (admin) */
  searchUsers(query: string, limit?: number): Promise<UserSearchResult[]>;

  /** Get user slug only (for settings fallback) */
  getUserSlugOnly(userId: string): Promise<UserSlugOnly | null>;

  /** Get user nickname and slug (for settings fallback) */
  getUserNicknameSlug(userId: string): Promise<UserNicknameSlug | null>;

  /** Check if two users share a team */
  checkSharedTeam(userId1: string, userId2: string): Promise<boolean>;

  /** Check if two users share a season */
  checkSharedSeason(userId1: string, userId2: string): Promise<boolean>;

  /** Get user's first usage record timestamp */
  getUserFirstSeen(userId: string): Promise<string | null>;

  /** Get public user profile by slug or id */
  getPublicUserBySlugOrId(slugOrId: string): Promise<UserProfile | null>;

  // ---------------------------------------------------------------------------
  // Organizations domain RPC methods
  // ---------------------------------------------------------------------------

  /** List all organizations */
  listOrganizations(): Promise<OrgRow[]>;

  /** List all organizations with member counts */
  listOrganizationsWithCount(): Promise<OrgWithCountRow[]>;

  /** List organizations for a user */
  listUserOrganizations(userId: string): Promise<OrgRow[]>;

  /** Get organization by ID */
  getOrganizationById(orgId: string): Promise<OrgRow | null>;

  /** Get organization by slug */
  getOrganizationBySlug(slug: string): Promise<OrgRow | null>;

  /** Check if user is a member of organization */
  checkOrgMembership(orgId: string, userId: string): Promise<boolean>;

  /** List organization members */
  listOrgMembers(orgId: string): Promise<OrgMemberRow[]>;

  // ---------------------------------------------------------------------------
  // Projects domain RPC methods
  // ---------------------------------------------------------------------------

  /** List all projects for a user */
  listProjects(userId: string): Promise<ProjectRow[]>;

  /** List aliases with stats (optionally filtered by date range) */
  listAliasesWithStats(
    userId: string,
    from?: string,
    to?: string,
  ): Promise<ProjectAliasStatsRow[]>;

  /** List unassigned project refs (optionally filtered by date range) */
  listUnassignedRefs(
    userId: string,
    from?: string,
    to?: string,
  ): Promise<ProjectUnassignedRow[]>;

  /** List all project tags for a user */
  listProjectTags(userId: string): Promise<ProjectTagRow[]>;

  /** Get project by name (for uniqueness check) */
  getProjectByName(userId: string, name: string): Promise<{ id: string } | null>;

  /** Get project by ID */
  getProjectById(userId: string, projectId: string): Promise<ProjectRow | null>;

  /** Get project by name excluding a specific ID (for update uniqueness check) */
  getProjectByNameExcluding(
    userId: string,
    name: string,
    excludeId: string,
  ): Promise<{ id: string } | null>;

  /** Check if project exists for user */
  projectExistsForUser(userId: string, projectId: string): Promise<boolean>;

  /** Check if session record exists for alias */
  sessionRecordExists(
    userId: string,
    source: string,
    projectRef: string,
  ): Promise<boolean>;

  /** Get alias owner (project_id) */
  getAliasOwner(
    userId: string,
    source: string,
    projectRef: string,
  ): Promise<{ project_id: string } | null>;

  /** Check if alias is attached to a specific project */
  aliasAttachedToProject(
    userId: string,
    projectId: string,
    source: string,
    projectRef: string,
  ): Promise<boolean>;

  /** Check if project tag exists */
  projectTagExists(
    userId: string,
    projectId: string,
    tag: string,
  ): Promise<boolean>;

  /** Get alias stats for a project */
  getProjectAliasStats(projectId: string): Promise<ProjectAliasStatsRow[]>;

  /** Get tag list for a project */
  getProjectTagList(userId: string, projectId: string): Promise<string[]>;

  /** Get project timeline data */
  getProjectTimeline(
    userId: string,
    from: string,
    to: string,
  ): Promise<ProjectTimelineRow[]>;

  // ---------------------------------------------------------------------------
  // Seasons domain RPC methods
  // ---------------------------------------------------------------------------

  /** List all seasons with team counts */
  listSeasons(): Promise<SeasonRow[]>;

  /** Get season by ID */
  getSeasonById(seasonId: string): Promise<SeasonDetailRow | null>;

  /** Get season by slug */
  getSeasonBySlug(slug: string): Promise<SeasonDetailRow | null>;

  /** Get season team registration */
  getSeasonRegistration(
    seasonId: string,
    teamId: string,
  ): Promise<SeasonTeamRegistrationRow | null>;

  /** Check if user is already registered in season with another team */
  checkSeasonMemberConflict(
    seasonId: string,
    userIds: string[],
  ): Promise<{ user_id: string } | null>;

  /** Aggregate team token usage for snapshot generation */
  aggregateSeasonTeamTokens(
    seasonId: string,
    fromDate: string,
    toDate: string,
  ): Promise<TeamAggRow[]>;

  /** Aggregate member token usage for snapshot generation */
  aggregateSeasonMemberTokens(
    seasonId: string,
    fromDate: string,
    toDate: string,
    teamIds: string[],
  ): Promise<MemberAggRow[]>;

  /** Get frozen season snapshots (leaderboard with snapshot_ready=1) */
  getSeasonSnapshots(seasonId: string): Promise<SeasonSnapshotRow[]>;

  /** Get frozen season member snapshots */
  getSeasonMemberSnapshots(
    seasonId: string,
    publicOnly?: boolean,
  ): Promise<SeasonMemberSnapshotRow[]>;

  /** Get real-time team tokens for leaderboard */
  getSeasonTeamTokens(
    seasonId: string,
    fromDate: string,
    toDate: string,
  ): Promise<SeasonTeamTokenRow[]>;

  /** Get real-time member tokens for leaderboard */
  getSeasonMemberTokens(
    seasonId: string,
    teamIds: string[],
    fromDate: string,
    toDate: string,
    publicOnly?: boolean,
  ): Promise<SeasonMemberTokenRow[]>;

  /** Get team session stats for leaderboard */
  getSeasonTeamSessionStats(
    seasonId: string,
    teamIds: string[],
    fromDate: string,
    toDate: string,
  ): Promise<SeasonTeamSessionStatsRow[]>;

  /** Get member session stats for leaderboard */
  getSeasonMemberSessionStats(
    seasonId: string,
    teamIds: string[],
    fromDate: string,
    toDate: string,
  ): Promise<SeasonMemberSessionStatsRow[]>;

  // ---------------------------------------------------------------------------
  // Showcases domain RPC methods
  // ---------------------------------------------------------------------------

  /** Get showcase by ID */
  getShowcaseById(
    showcaseId: string,
    currentUserId?: string,
  ): Promise<ShowcaseRpcRow | null>;

  /** Get showcase owner info */
  getShowcaseOwner(showcaseId: string): Promise<ShowcaseOwnerRow | null>;

  /** Check if showcase exists by user ID and GitHub URL */
  checkShowcaseExists(
    userId: string,
    githubUrl: string,
  ): Promise<ShowcaseExistsResult>;

  /** Check if showcase exists by repo key */
  checkShowcaseExistsByRepoKey(repoKey: string): Promise<ShowcaseExistsResult>;

  /** Check if user has upvoted a showcase */
  checkShowcaseUpvote(showcaseId: string, userId: string): Promise<boolean>;

  /** Get upvote count for a showcase */
  getShowcaseUpvoteCount(showcaseId: string): Promise<number>;

  /** List showcases */
  listShowcases(options: {
    userId?: string | undefined;
    publicOnly?: boolean | undefined;
    currentUserId?: string | undefined;
    orderBy?: "created_at" | "upvote_count" | undefined;
    limit: number;
    offset: number;
  }): Promise<ShowcaseRpcRow[]>;

  /** Count showcases */
  countShowcases(options?: {
    userId?: string | undefined;
    publicOnly?: boolean | undefined;
  }): Promise<number>;

  // ---------------------------------------------------------------------------
  // Teams domain RPC methods
  // ---------------------------------------------------------------------------

  /** List teams for a user */
  listTeamsForUser(userId: string): Promise<TeamRow[]>;

  /** Check if team slug exists */
  checkTeamSlugExists(slug: string): Promise<boolean>;

  /** Find team by invite code */
  findTeamByInviteCode(inviteCode: string): Promise<TeamByInviteCode | null>;

  /** Check if user is a member of team */
  checkTeamMembershipExists(teamId: string, userId: string): Promise<boolean>;

  /** Get team by ID */
  getTeamById(teamId: string): Promise<TeamDetailRow | null>;

  /** Get team members */
  getTeamMembers(teamId: string): Promise<TeamMemberRow[]>;

  /** Get team season registrations */
  getTeamSeasonRegistrations(teamId: string): Promise<string[]>;

  /** Get team logo URL */
  getTeamLogoUrl(teamId: string): Promise<string | null>;

  /** Count team members */
  countTeamMembers(teamId: string): Promise<number>;

  /** Get user's role in a team (null if not a member) */
  getTeamMembership(teamId: string, userId: string): Promise<string | null>;

  /** Get app setting by key */
  getAppSetting(key: string): Promise<string | null>;

  // ---------------------------------------------------------------------------
  // Admin domain RPC methods
  // ---------------------------------------------------------------------------

  /** Get per-user storage stats for admin page */
  getAdminStorageStats(): Promise<AdminStorageUserRow[]>;

  // ---------------------------------------------------------------------------
  // Sessions domain RPC methods
  // ---------------------------------------------------------------------------

  /** Get session records with project info */
  getSessionRecords(
    userId: string,
    fromDate: string,
    toDate: string,
    options?: {
      source?: string;
      kind?: string;
    },
  ): Promise<SessionRecordRow[]>;

  // ---------------------------------------------------------------------------
  // Pricing domain RPC methods
  // ---------------------------------------------------------------------------

  /** List all model pricing rows */
  listModelPricing(): Promise<PricingRow[]>;

  /** Get model pricing by ID */
  getModelPricingById(id: number): Promise<PricingRow | null>;

  /** Get model pricing by model and source */
  getModelPricingByModelSource(
    model: string,
    source: string | null,
  ): Promise<PricingRow | null>;

  // ---------------------------------------------------------------------------
  // Usage domain RPC methods
  // ---------------------------------------------------------------------------

  /** Get usage records aggregated by time/source/model */
  getUsageRecords(
    userId: string,
    fromDate: string,
    toDate: string,
    options?: {
      source?: string;
      granularity?: "half-hour" | "day";
    },
  ): Promise<UsageRecordRow[]>;

  /** Get device summary for by-device usage */
  getDeviceSummary(
    userId: string,
    fromDate: string,
    toDate: string,
  ): Promise<UsageDeviceSummaryRow[]>;

  /** Get cost details for by-device pricing calculation */
  getDeviceCostDetails(
    userId: string,
    fromDate: string,
    toDate: string,
  ): Promise<UsageCostDetailRow[]>;

  /** Get device timeline for by-device charting */
  getDeviceTimeline(
    userId: string,
    fromDate: string,
    toDate: string,
  ): Promise<UsageDeviceTimelineRow[]>;

  // ---------------------------------------------------------------------------
  // Devices domain RPC methods
  // ---------------------------------------------------------------------------

  /** List devices with usage stats for a user */
  listDevices(userId: string): Promise<DeviceRow[]>;

  /** Check if a device exists for user (in usage_records or device_aliases) */
  checkDeviceExists(userId: string, deviceId: string): Promise<boolean>;

  /** Check for duplicate alias (case-insensitive, different device) */
  checkDuplicateDeviceAlias(
    userId: string,
    alias: string,
    excludeDeviceId: string,
  ): Promise<boolean>;

  /** Check if device has usage records */
  checkDeviceHasRecords(userId: string, deviceId: string): Promise<boolean>;

  // ---------------------------------------------------------------------------
  // Auth domain RPC methods
  // ---------------------------------------------------------------------------

  /** Get auth code by code string */
  getAuthCode(code: string): Promise<AuthCodeRow | null>;

  /** List all invite codes with user info */
  listInviteCodes(): Promise<InviteCodeRow[]>;

  /** Check if invite code exists and get its status */
  checkInviteCodeExists(code: string): Promise<InviteCodeSimple | null>;

  /** Get invite code by ID (for delete check) */
  getInviteCodeById(id: number): Promise<InviteCodeById | null>;

  /** Check if user has unused invite codes */
  checkUserHasUnusedInvite(userId: string): Promise<boolean>;

  // ---------------------------------------------------------------------------
  // Settings domain RPC methods
  // ---------------------------------------------------------------------------

  /** Get all app settings */
  getAllAppSettings(): Promise<AppSettingRow[]>;

  /** Get all user settings */
  getAllUserSettings(userId: string): Promise<UserSettingRow[]>;

  // ---------------------------------------------------------------------------
  // Achievements domain RPC methods
  // ---------------------------------------------------------------------------

  /** Get usage aggregates for achievements computation */
  getAchievementUsageAggregates(userId: string): Promise<AchievementUsageAggregates | null>;

  /** Get daily usage for achievements (streak, big-day, veteran) */
  getAchievementDailyUsage(userId: string): Promise<AchievementDailyUsageRow[]>;

  /** Get daily cost breakdown for achievements (daily-burn) */
  getAchievementDailyCostBreakdown(userId: string): Promise<AchievementDailyCostRow[]>;

  /** Get diversity counts for achievements */
  getAchievementDiversityCounts(userId: string): Promise<AchievementDiversityCounts | null>;

  /** Get session aggregates for achievements */
  getAchievementSessionAggregates(userId: string): Promise<AchievementSessionAggregates | null>;

  /** Get hourly usage for timezone-dependent achievements */
  getAchievementHourlyUsage(userId: string): Promise<AchievementHourlyUsageRow[]>;

  /** Get cost by model/source for big-spender achievement */
  getAchievementCostByModelSource(userId: string): Promise<AchievementCostByModelSourceRow[]>;

  /** Get achievement earners using a dynamic SQL query */
  getAchievementEarners(
    achievementId: string,
    sql: string,
    params: unknown[],
  ): Promise<AchievementEarnerRow[]>;

  /** Get achievement earners count using a dynamic SQL query */
  getAchievementEarnersCount(
    achievementId: string,
    sql: string,
    params: unknown[],
  ): Promise<number>;

  // ---------------------------------------------------------------------------
  // Leaderboard domain RPC methods
  // ---------------------------------------------------------------------------

  /** Get global leaderboard entries */
  getGlobalLeaderboard(options: {
    fromDate?: string;
    teamId?: string;
    orgId?: string;
    limit: number;
    offset?: number;
  }): Promise<LeaderboardEntryRow[]>;

  /** Get user team memberships for leaderboard display */
  getLeaderboardUserTeams(userIds: string[]): Promise<LeaderboardUserTeamRow[]>;

  /** Get user session stats for leaderboard display */
  getLeaderboardSessionStats(
    userIds: string[],
    fromDate?: string,
  ): Promise<LeaderboardSessionStatsRow[]>;

  // ---------------------------------------------------------------------------
  // Live domain RPC methods
  // ---------------------------------------------------------------------------

  /** Ping database (health check) */
  ping(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Write interface — stays on D1 REST API
// ---------------------------------------------------------------------------

export interface DbWrite {
  execute(
    sql: string,
    params?: unknown[],
  ): Promise<{ changes: number; duration: number }>;

  batch(
    statements: Array<{ sql: string; params?: unknown[] }>,
  ): Promise<DbQueryResult[]>;
}

// ---------------------------------------------------------------------------
// Singletons
// ---------------------------------------------------------------------------

let _read: DbRead | undefined;
let _write: DbWrite | undefined;

/**
 * Get the read-only database accessor.
 * Uses the pew read Worker (Cloudflare, native D1 binding).
 */
export async function getDbRead(): Promise<DbRead> {
  if (!_read) {
    const { createWorkerDbRead } = await import("./db-worker");
    _read = createWorkerDbRead();
  }
  return _read;
}

/**
 * Get the write-only database accessor.
 * Stays on D1 REST API.
 */
export async function getDbWrite(): Promise<DbWrite> {
  if (!_write) {
    const { createRestDbWrite } = await import("./db-rest");
    _write = createRestDbWrite();
  }
  return _write;
}

/** Reset singletons (for testing). */
export function resetDb(): void {
  _read = undefined;
  _write = undefined;
}
