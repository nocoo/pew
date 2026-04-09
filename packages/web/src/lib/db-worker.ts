/**
 * Worker adapter for DbRead.
 *
 * Sends SQL queries to the pew read Worker (Cloudflare) via HTTP,
 * replacing the D1 REST API with native D1 binding for lower latency.
 */

import type { DbRead, DbQueryResult } from "./db";
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

export function createWorkerDbRead(): DbRead {
  const url = process.env.WORKER_READ_URL;
  const secret = process.env.WORKER_READ_SECRET;

  if (!url || !secret) {
    throw new Error("WORKER_READ_URL and WORKER_READ_SECRET are required");
  }

  /**
   * Call the RPC endpoint with a typed request.
   */
  async function rpc<T>(request: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${url}/api/rpc`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(request),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(
        (body as { error?: string }).error ?? `Worker returned ${res.status}`,
      );
    }

    const body = await res.json() as { result: T };
    return body.result;
  }

  const reader: DbRead = {
    // -------------------------------------------------------------------------
    // Legacy SQL proxy (being migrated to RPC)
    // -------------------------------------------------------------------------

    async query<T>(sql: string, params?: unknown[]): Promise<DbQueryResult<T>> {
      const res = await fetch(`${url}/api/query`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify({ sql, params: params ?? [] }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `Worker returned ${res.status}`,
        );
      }

      return res.json() as Promise<DbQueryResult<T>>;
    },

    async firstOrNull<T>(sql: string, params?: unknown[]): Promise<T | null> {
      const result = await reader.query<T>(sql, params);
      return result.results[0] ?? null;
    },

    // -------------------------------------------------------------------------
    // Users domain RPC methods
    // -------------------------------------------------------------------------

    async getUserById(id: string): Promise<UserAuth | null> {
      return rpc<UserAuth | null>({ method: "users.getById", id });
    },

    async getUserBySlug(slug: string): Promise<UserProfile | null> {
      return rpc<UserProfile | null>({ method: "users.getBySlug", slug });
    },

    async getUserByEmail(email: string): Promise<UserAuth | null> {
      return rpc<UserAuth | null>({ method: "users.getByEmail", email });
    },

    async getUserByApiKey(apiKey: string): Promise<UserApiKeyAuth | null> {
      return rpc<UserApiKeyAuth | null>({ method: "users.getByApiKey", apiKey });
    },

    async getUserByOAuthAccount(
      provider: string,
      providerAccountId: string,
    ): Promise<UserAuth | null> {
      return rpc<UserAuth | null>({
        method: "users.getByOAuthAccount",
        provider,
        providerAccountId,
      });
    },

    async checkSlugExists(
      slug: string,
      excludeUserId?: string,
    ): Promise<boolean> {
      const result = await rpc<{ exists: boolean }>({
        method: "users.checkSlugExists",
        slug,
        excludeUserId,
      });
      return result.exists;
    },

    async getUserSettings(userId: string): Promise<UserSettings | null> {
      return rpc<UserSettings | null>({ method: "users.getSettings", userId });
    },

    async getUserApiKey(userId: string): Promise<string | null> {
      const result = await rpc<{ api_key: string | null } | null>({
        method: "users.getApiKey",
        userId,
      });
      return result?.api_key ?? null;
    },

    async getUserEmail(userId: string): Promise<string | null> {
      const result = await rpc<{ email: string } | null>({
        method: "users.getEmail",
        userId,
      });
      return result?.email ?? null;
    },

    async searchUsers(
      query: string,
      limit?: number,
    ): Promise<UserSearchResult[]> {
      return rpc<UserSearchResult[]>({
        method: "users.search",
        query,
        limit,
      });
    },

    async getUserSlugOnly(userId: string): Promise<UserSlugOnly | null> {
      return rpc<UserSlugOnly | null>({ method: "users.getSlugOnly", userId });
    },

    async getUserNicknameSlug(userId: string): Promise<UserNicknameSlug | null> {
      return rpc<UserNicknameSlug | null>({ method: "users.getNicknameSlug", userId });
    },

    async checkSharedTeam(userId1: string, userId2: string): Promise<boolean> {
      const result = await rpc<{ shared: boolean }>({
        method: "users.checkSharedTeam",
        userId1,
        userId2,
      });
      return result.shared;
    },

    async checkSharedSeason(userId1: string, userId2: string): Promise<boolean> {
      const result = await rpc<{ shared: boolean }>({
        method: "users.checkSharedSeason",
        userId1,
        userId2,
      });
      return result.shared;
    },

    async getUserFirstSeen(userId: string): Promise<string | null> {
      return rpc<string | null>({ method: "users.getFirstSeen", userId });
    },

    async getPublicUserBySlugOrId(slugOrId: string): Promise<UserProfile | null> {
      return rpc<UserProfile | null>({ method: "users.getPublicBySlugOrId", slugOrId });
    },

    // -------------------------------------------------------------------------
    // Organizations domain RPC methods
    // -------------------------------------------------------------------------

    async listOrganizations(): Promise<OrgRow[]> {
      return rpc<OrgRow[]>({ method: "organizations.list" });
    },

    async listOrganizationsWithCount(): Promise<OrgWithCountRow[]> {
      return rpc<OrgWithCountRow[]>({ method: "organizations.listWithCount" });
    },

    async listUserOrganizations(userId: string): Promise<OrgRow[]> {
      return rpc<OrgRow[]>({ method: "organizations.listForUser", userId });
    },

    async getOrganizationById(orgId: string): Promise<OrgRow | null> {
      return rpc<OrgRow | null>({ method: "organizations.getById", orgId });
    },

    async getOrganizationBySlug(slug: string): Promise<OrgRow | null> {
      return rpc<OrgRow | null>({ method: "organizations.getBySlug", slug });
    },

    async checkOrgMembership(orgId: string, userId: string): Promise<boolean> {
      const result = await rpc<{ exists: boolean }>({
        method: "organizations.checkMembership",
        orgId,
        userId,
      });
      return result.exists;
    },

    async listOrgMembers(orgId: string): Promise<OrgMemberRow[]> {
      return rpc<OrgMemberRow[]>({
        method: "organizations.listMembers",
        orgId,
      });
    },

    // -------------------------------------------------------------------------
    // Projects domain RPC methods
    // -------------------------------------------------------------------------

    async listProjects(userId: string): Promise<ProjectRow[]> {
      return rpc<ProjectRow[]>({ method: "projects.list", userId });
    },

    async listAliasesWithStats(
      userId: string,
      from?: string,
      to?: string,
    ): Promise<ProjectAliasStatsRow[]> {
      return rpc<ProjectAliasStatsRow[]>({
        method: "projects.listAliasesWithStats",
        userId,
        from,
        to,
      });
    },

    async listUnassignedRefs(
      userId: string,
      from?: string,
      to?: string,
    ): Promise<ProjectUnassignedRow[]> {
      return rpc<ProjectUnassignedRow[]>({
        method: "projects.listUnassignedRefs",
        userId,
        from,
        to,
      });
    },

    async listProjectTags(userId: string): Promise<ProjectTagRow[]> {
      return rpc<ProjectTagRow[]>({ method: "projects.listTags", userId });
    },

    async getProjectByName(
      userId: string,
      name: string,
    ): Promise<{ id: string } | null> {
      return rpc<{ id: string } | null>({
        method: "projects.getByName",
        userId,
        name,
      });
    },

    async getProjectById(
      userId: string,
      projectId: string,
    ): Promise<ProjectRow | null> {
      return rpc<ProjectRow | null>({
        method: "projects.getById",
        userId,
        projectId,
      });
    },

    async getProjectByNameExcluding(
      userId: string,
      name: string,
      excludeId: string,
    ): Promise<{ id: string } | null> {
      return rpc<{ id: string } | null>({
        method: "projects.getByNameExcluding",
        userId,
        name,
        excludeId,
      });
    },

    async projectExistsForUser(userId: string, projectId: string): Promise<boolean> {
      const result = await rpc<{ exists: boolean }>({
        method: "projects.existsForUser",
        userId,
        projectId,
      });
      return result.exists;
    },

    async sessionRecordExists(
      userId: string,
      source: string,
      projectRef: string,
    ): Promise<boolean> {
      const result = await rpc<{ exists: boolean }>({
        method: "projects.sessionRecordExists",
        userId,
        source,
        projectRef,
      });
      return result.exists;
    },

    async getAliasOwner(
      userId: string,
      source: string,
      projectRef: string,
    ): Promise<{ project_id: string } | null> {
      return rpc<{ project_id: string } | null>({
        method: "projects.getAliasOwner",
        userId,
        source,
        projectRef,
      });
    },

    async aliasAttachedToProject(
      userId: string,
      projectId: string,
      source: string,
      projectRef: string,
    ): Promise<boolean> {
      const result = await rpc<{ attached: boolean }>({
        method: "projects.aliasAttachedToProject",
        userId,
        projectId,
        source,
        projectRef,
      });
      return result.attached;
    },

    async projectTagExists(
      userId: string,
      projectId: string,
      tag: string,
    ): Promise<boolean> {
      const result = await rpc<{ exists: boolean }>({
        method: "projects.tagExists",
        userId,
        projectId,
        tag,
      });
      return result.exists;
    },

    async getProjectAliasStats(projectId: string): Promise<ProjectAliasStatsRow[]> {
      return rpc<ProjectAliasStatsRow[]>({
        method: "projects.getAliasStats",
        projectId,
      });
    },

    async getProjectTagList(userId: string, projectId: string): Promise<string[]> {
      return rpc<string[]>({
        method: "projects.getTagList",
        userId,
        projectId,
      });
    },

    async getProjectTimeline(
      userId: string,
      from: string,
      to: string,
    ): Promise<ProjectTimelineRow[]> {
      return rpc<ProjectTimelineRow[]>({
        method: "projects.getTimeline",
        userId,
        from,
        to,
      });
    },

    // -------------------------------------------------------------------------
    // Seasons domain RPC methods
    // -------------------------------------------------------------------------

    async listSeasons(): Promise<SeasonRow[]> {
      return rpc<SeasonRow[]>({ method: "seasons.list" });
    },

    async getSeasonById(seasonId: string): Promise<SeasonDetailRow | null> {
      return rpc<SeasonDetailRow | null>({ method: "seasons.getById", seasonId });
    },

    async getSeasonBySlug(slug: string): Promise<SeasonDetailRow | null> {
      return rpc<SeasonDetailRow | null>({ method: "seasons.getBySlug", slug });
    },

    async getSeasonRegistration(
      seasonId: string,
      teamId: string,
    ): Promise<SeasonTeamRegistrationRow | null> {
      return rpc<SeasonTeamRegistrationRow | null>({
        method: "seasons.getRegistration",
        seasonId,
        teamId,
      });
    },

    async checkSeasonMemberConflict(
      seasonId: string,
      userIds: string[],
    ): Promise<{ user_id: string } | null> {
      return rpc<{ user_id: string } | null>({
        method: "seasons.checkMemberConflict",
        seasonId,
        userIds,
      });
    },

    async aggregateSeasonTeamTokens(
      seasonId: string,
      fromDate: string,
      toDate: string,
    ): Promise<TeamAggRow[]> {
      return rpc<TeamAggRow[]>({
        method: "seasons.aggregateTeamTokens",
        seasonId,
        fromDate,
        toDate,
      });
    },

    async aggregateSeasonMemberTokens(
      seasonId: string,
      fromDate: string,
      toDate: string,
      teamIds: string[],
    ): Promise<MemberAggRow[]> {
      return rpc<MemberAggRow[]>({
        method: "seasons.aggregateMemberTokens",
        seasonId,
        fromDate,
        toDate,
        teamIds,
      });
    },

    async getSeasonSnapshots(seasonId: string): Promise<SeasonSnapshotRow[]> {
      return rpc<SeasonSnapshotRow[]>({
        method: "seasons.getSnapshots",
        seasonId,
      });
    },

    async getSeasonMemberSnapshots(
      seasonId: string,
      publicOnly?: boolean,
    ): Promise<SeasonMemberSnapshotRow[]> {
      return rpc<SeasonMemberSnapshotRow[]>({
        method: "seasons.getMemberSnapshots",
        seasonId,
        publicOnly,
      });
    },

    async getSeasonTeamTokens(
      seasonId: string,
      fromDate: string,
      toDate: string,
    ): Promise<SeasonTeamTokenRow[]> {
      return rpc<SeasonTeamTokenRow[]>({
        method: "seasons.getTeamTokens",
        seasonId,
        fromDate,
        toDate,
      });
    },

    async getSeasonMemberTokens(
      seasonId: string,
      teamIds: string[],
      fromDate: string,
      toDate: string,
      publicOnly?: boolean,
    ): Promise<SeasonMemberTokenRow[]> {
      return rpc<SeasonMemberTokenRow[]>({
        method: "seasons.getMemberTokens",
        seasonId,
        teamIds,
        fromDate,
        toDate,
        publicOnly,
      });
    },

    async getSeasonTeamSessionStats(
      seasonId: string,
      teamIds: string[],
      fromDate: string,
      toDate: string,
    ): Promise<SeasonTeamSessionStatsRow[]> {
      return rpc<SeasonTeamSessionStatsRow[]>({
        method: "seasons.getTeamSessionStats",
        seasonId,
        teamIds,
        fromDate,
        toDate,
      });
    },

    async getSeasonMemberSessionStats(
      seasonId: string,
      teamIds: string[],
      fromDate: string,
      toDate: string,
    ): Promise<SeasonMemberSessionStatsRow[]> {
      return rpc<SeasonMemberSessionStatsRow[]>({
        method: "seasons.getMemberSessionStats",
        seasonId,
        teamIds,
        fromDate,
        toDate,
      });
    },

    // -------------------------------------------------------------------------
    // Showcases domain RPC methods
    // -------------------------------------------------------------------------

    async getShowcaseById(
      showcaseId: string,
      currentUserId?: string,
    ): Promise<ShowcaseRpcRow | null> {
      return rpc<ShowcaseRpcRow | null>({
        method: "showcases.getById",
        showcaseId,
        currentUserId,
      });
    },

    async getShowcaseOwner(
      showcaseId: string,
    ): Promise<ShowcaseOwnerRow | null> {
      return rpc<ShowcaseOwnerRow | null>({
        method: "showcases.getOwner",
        showcaseId,
      });
    },

    async checkShowcaseExists(
      userId: string,
      githubUrl: string,
    ): Promise<ShowcaseExistsResult> {
      return rpc<ShowcaseExistsResult>({
        method: "showcases.checkExists",
        userId,
        githubUrl,
      });
    },

    async checkShowcaseExistsByRepoKey(
      repoKey: string,
    ): Promise<ShowcaseExistsResult> {
      return rpc<ShowcaseExistsResult>({
        method: "showcases.checkExistsByRepoKey",
        repoKey,
      });
    },

    async checkShowcaseUpvote(
      showcaseId: string,
      userId: string,
    ): Promise<boolean> {
      const result = await rpc<{ exists: boolean }>({
        method: "showcases.checkUpvote",
        showcaseId,
        visitorId: userId,
      });
      return result.exists;
    },

    async getShowcaseUpvoteCount(showcaseId: string): Promise<number> {
      return rpc<number>({ method: "showcases.getUpvoteCount", showcaseId });
    },

    async listShowcases(options: {
      userId?: string;
      publicOnly?: boolean;
      currentUserId?: string;
      orderBy?: "created_at" | "upvote_count";
      limit: number;
      offset: number;
    }): Promise<ShowcaseRpcRow[]> {
      return rpc<ShowcaseRpcRow[]>({
        method: "showcases.list",
        ...options,
      });
    },

    async countShowcases(options?: {
      userId?: string;
      publicOnly?: boolean;
    }): Promise<number> {
      return rpc<number>({
        method: "showcases.count",
        ...options,
      });
    },

    // -------------------------------------------------------------------------
    // Teams domain RPC methods
    // -------------------------------------------------------------------------

    async listTeamsForUser(userId: string): Promise<TeamRow[]> {
      return rpc<TeamRow[]>({ method: "teams.listForUser", userId });
    },

    async checkTeamSlugExists(slug: string): Promise<boolean> {
      const result = await rpc<{ exists: boolean }>({
        method: "teams.checkSlugExists",
        slug,
      });
      return result.exists;
    },

    async findTeamByInviteCode(
      inviteCode: string,
    ): Promise<TeamByInviteCode | null> {
      return rpc<TeamByInviteCode | null>({
        method: "teams.findByInviteCode",
        inviteCode,
      });
    },

    async checkTeamMembershipExists(
      teamId: string,
      userId: string,
    ): Promise<boolean> {
      const result = await rpc<{ exists: boolean }>({
        method: "teams.membershipExists",
        teamId,
        userId,
      });
      return result.exists;
    },

    async getTeamById(teamId: string): Promise<TeamDetailRow | null> {
      return rpc<TeamDetailRow | null>({ method: "teams.getById", teamId });
    },

    async getTeamMembers(teamId: string): Promise<TeamMemberRow[]> {
      return rpc<TeamMemberRow[]>({ method: "teams.getMembers", teamId });
    },

    async getTeamSeasonRegistrations(teamId: string): Promise<string[]> {
      return rpc<string[]>({ method: "teams.getSeasonRegistrations", teamId });
    },

    async getTeamLogoUrl(teamId: string): Promise<string | null> {
      const result = await rpc<{ logo_url: string | null } | null>({
        method: "teams.getLogoUrl",
        teamId,
      });
      return result?.logo_url ?? null;
    },

    async countTeamMembers(teamId: string): Promise<number> {
      const result = await rpc<{ count: number }>({
        method: "teams.countMembers",
        teamId,
      });
      return result.count;
    },

    async getTeamMembership(
      teamId: string,
      userId: string,
    ): Promise<string | null> {
      const result = await rpc<{ role: string } | null>({
        method: "teams.getMembership",
        teamId,
        userId,
      });
      return result?.role ?? null;
    },

    async getAppSetting(key: string): Promise<string | null> {
      return rpc<string | null>({ method: "teams.getAppSetting", key });
    },

    // -------------------------------------------------------------------------
    // Admin domain RPC methods
    // -------------------------------------------------------------------------

    async getAdminStorageStats(): Promise<AdminStorageUserRow[]> {
      return rpc<AdminStorageUserRow[]>({ method: "admin.getStorageStats" });
    },

    // -------------------------------------------------------------------------
    // Sessions domain RPC methods
    // -------------------------------------------------------------------------

    async getSessionRecords(
      userId: string,
      fromDate: string,
      toDate: string,
      options?: {
        source?: string;
        kind?: string;
      },
    ): Promise<SessionRecordRow[]> {
      return rpc<SessionRecordRow[]>({
        method: "sessions.getRecords",
        userId,
        fromDate,
        toDate,
        source: options?.source,
        kind: options?.kind,
      });
    },

    // -------------------------------------------------------------------------
    // Pricing domain RPC methods
    // -------------------------------------------------------------------------

    async listModelPricing(): Promise<PricingRow[]> {
      return rpc<PricingRow[]>({ method: "pricing.listModelPricing" });
    },

    async getModelPricingById(id: number): Promise<PricingRow | null> {
      return rpc<PricingRow | null>({ method: "pricing.getModelPricingById", id });
    },

    async getModelPricingByModelSource(
      model: string,
      source: string | null,
    ): Promise<PricingRow | null> {
      return rpc<PricingRow | null>({
        method: "pricing.getModelPricingByModelSource",
        model,
        source,
      });
    },

    // -------------------------------------------------------------------------
    // Usage domain RPC methods
    // -------------------------------------------------------------------------

    async getUsageRecords(
      userId: string,
      fromDate: string,
      toDate: string,
      options?: {
        source?: string;
        granularity?: "half-hour" | "day";
      },
    ): Promise<UsageRecordRow[]> {
      return rpc<UsageRecordRow[]>({
        method: "usage.get",
        userId,
        fromDate,
        toDate,
        source: options?.source,
        granularity: options?.granularity,
      });
    },

    async getDeviceSummary(
      userId: string,
      fromDate: string,
      toDate: string,
    ): Promise<UsageDeviceSummaryRow[]> {
      return rpc<UsageDeviceSummaryRow[]>({
        method: "usage.getDeviceSummary",
        userId,
        fromDate,
        toDate,
      });
    },

    async getDeviceCostDetails(
      userId: string,
      fromDate: string,
      toDate: string,
    ): Promise<UsageCostDetailRow[]> {
      return rpc<UsageCostDetailRow[]>({
        method: "usage.getDeviceCostDetails",
        userId,
        fromDate,
        toDate,
      });
    },

    async getDeviceTimeline(
      userId: string,
      fromDate: string,
      toDate: string,
    ): Promise<UsageDeviceTimelineRow[]> {
      return rpc<UsageDeviceTimelineRow[]>({
        method: "usage.getDeviceTimeline",
        userId,
        fromDate,
        toDate,
      });
    },

    // -------------------------------------------------------------------------
    // Devices domain RPC methods
    // -------------------------------------------------------------------------

    async listDevices(userId: string): Promise<DeviceRow[]> {
      return rpc<DeviceRow[]>({ method: "devices.list", userId });
    },

    async checkDeviceExists(userId: string, deviceId: string): Promise<boolean> {
      const result = await rpc<{ exists: boolean }>({
        method: "devices.exists",
        userId,
        deviceId,
      });
      return result.exists;
    },

    async checkDuplicateDeviceAlias(
      userId: string,
      alias: string,
      excludeDeviceId: string,
    ): Promise<boolean> {
      const result = await rpc<{ exists: boolean }>({
        method: "devices.checkDuplicateAlias",
        userId,
        alias,
        excludeDeviceId,
      });
      return result.exists;
    },

    async checkDeviceHasRecords(userId: string, deviceId: string): Promise<boolean> {
      const result = await rpc<{ hasRecords: boolean }>({
        method: "devices.hasRecords",
        userId,
        deviceId,
      });
      return result.hasRecords;
    },

    // -------------------------------------------------------------------------
    // Auth domain RPC methods
    // -------------------------------------------------------------------------

    async getAuthCode(code: string): Promise<AuthCodeRow | null> {
      return rpc<AuthCodeRow | null>({ method: "auth.getCode", code });
    },

    async listInviteCodes(): Promise<InviteCodeRow[]> {
      return rpc<InviteCodeRow[]>({ method: "auth.listInviteCodes" });
    },

    async checkInviteCodeExists(code: string): Promise<InviteCodeSimple | null> {
      return rpc<InviteCodeSimple | null>({ method: "auth.checkInviteCode", code });
    },

    async getInviteCodeById(id: number): Promise<InviteCodeById | null> {
      return rpc<InviteCodeById | null>({ method: "auth.getInviteCodeById", id });
    },

    async checkUserHasUnusedInvite(userId: string): Promise<boolean> {
      const result = await rpc<{ hasUnused: boolean }>({
        method: "auth.userHasUnusedInvite",
        userId,
      });
      return result.hasUnused;
    },

    // -------------------------------------------------------------------------
    // Settings domain RPC methods
    // -------------------------------------------------------------------------

    async getAllAppSettings(): Promise<AppSettingRow[]> {
      return rpc<AppSettingRow[]>({ method: "settings.getAllApp" });
    },

    async getAllUserSettings(userId: string): Promise<UserSettingRow[]> {
      return rpc<UserSettingRow[]>({ method: "settings.getAllUser", userId });
    },

    // -------------------------------------------------------------------------
    // Achievements domain RPC methods
    // -------------------------------------------------------------------------

    async getAchievementUsageAggregates(
      userId: string,
    ): Promise<AchievementUsageAggregates | null> {
      return rpc<AchievementUsageAggregates | null>({
        method: "achievements.getUsageAggregates",
        userId,
      });
    },

    async getAchievementDailyUsage(
      userId: string,
    ): Promise<AchievementDailyUsageRow[]> {
      return rpc<AchievementDailyUsageRow[]>({
        method: "achievements.getDailyUsage",
        userId,
      });
    },

    async getAchievementDailyCostBreakdown(
      userId: string,
    ): Promise<AchievementDailyCostRow[]> {
      return rpc<AchievementDailyCostRow[]>({
        method: "achievements.getDailyCostBreakdown",
        userId,
      });
    },

    async getAchievementDiversityCounts(
      userId: string,
    ): Promise<AchievementDiversityCounts | null> {
      return rpc<AchievementDiversityCounts | null>({
        method: "achievements.getDiversityCounts",
        userId,
      });
    },

    async getAchievementSessionAggregates(
      userId: string,
    ): Promise<AchievementSessionAggregates | null> {
      return rpc<AchievementSessionAggregates | null>({
        method: "achievements.getSessionAggregates",
        userId,
      });
    },

    async getAchievementHourlyUsage(
      userId: string,
    ): Promise<AchievementHourlyUsageRow[]> {
      return rpc<AchievementHourlyUsageRow[]>({
        method: "achievements.getHourlyUsage",
        userId,
      });
    },

    async getAchievementCostByModelSource(
      userId: string,
    ): Promise<AchievementCostByModelSourceRow[]> {
      return rpc<AchievementCostByModelSourceRow[]>({
        method: "achievements.getCostByModelSource",
        userId,
      });
    },

    async getAchievementEarners(
      achievementId: string,
      sql: string,
      params: unknown[],
    ): Promise<AchievementEarnerRow[]> {
      return rpc<AchievementEarnerRow[]>({
        method: "achievements.getEarners",
        achievementId,
        sql,
        params,
      });
    },

    async getAchievementEarnersCount(
      achievementId: string,
      sql: string,
      params: unknown[],
    ): Promise<number> {
      return rpc<number>({
        method: "achievements.getEarnersCount",
        achievementId,
        sql,
        params,
      });
    },

    // -------------------------------------------------------------------------
    // Leaderboard domain RPC methods
    // -------------------------------------------------------------------------

    async getGlobalLeaderboard(options: {
      fromDate?: string;
      teamId?: string;
      orgId?: string;
      limit: number;
      offset?: number;
    }): Promise<LeaderboardEntryRow[]> {
      return rpc<LeaderboardEntryRow[]>({
        method: "leaderboard.getGlobal",
        ...(options.fromDate !== undefined && { fromDate: options.fromDate }),
        ...(options.teamId !== undefined && { teamId: options.teamId }),
        ...(options.orgId !== undefined && { orgId: options.orgId }),
        limit: options.limit,
        ...(options.offset !== undefined && { offset: options.offset }),
      });
    },

    async getLeaderboardUserTeams(
      userIds: string[],
    ): Promise<LeaderboardUserTeamRow[]> {
      return rpc<LeaderboardUserTeamRow[]>({
        method: "leaderboard.getUserTeams",
        userIds,
      });
    },

    async getLeaderboardSessionStats(
      userIds: string[],
      fromDate?: string,
    ): Promise<LeaderboardSessionStatsRow[]> {
      return rpc<LeaderboardSessionStatsRow[]>({
        method: "leaderboard.getUserSessionStats",
        userIds,
        ...(fromDate !== undefined && { fromDate }),
      });
    },

    // -------------------------------------------------------------------------
    // Live domain RPC methods
    // -------------------------------------------------------------------------

    async ping(): Promise<void> {
      await rpc<{ ok: boolean }>({ method: "live.ping" });
    },
  };

  return reader;
}
