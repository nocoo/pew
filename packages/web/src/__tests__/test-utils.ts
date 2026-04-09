/**
 * Shared test utilities for @pew/web unit tests.
 *
 * Provides mock factories for the DB abstraction layer and common request
 * builders so individual test files don't need to duplicate boilerplate.
 *
 * NOTE: `vi.mock(...)` calls CANNOT be extracted here — vitest hoists them
 * to the top of each test file at compile time. Each test file must still
 * declare its own `vi.mock("@/lib/db", ...)` etc.
 */

import { vi } from "vitest";
import type { DbRead, DbWrite } from "@/lib/db";

// ---------------------------------------------------------------------------
// Mock DB factories
// ---------------------------------------------------------------------------

/** Mock DbRead with all methods (legacy SQL proxy + users RPC). */
export function createMockDbRead() {
  return {
    // Legacy SQL proxy
    query: vi.fn(),
    firstOrNull: vi.fn(),
    // Users RPC methods
    getUserById: vi.fn(),
    getUserBySlug: vi.fn(),
    getUserByEmail: vi.fn(),
    getUserByApiKey: vi.fn(),
    getUserByOAuthAccount: vi.fn(),
    checkSlugExists: vi.fn(),
    getUserSettings: vi.fn(),
    getUserApiKey: vi.fn(),
    getUserEmail: vi.fn(),
    searchUsers: vi.fn(),
    getUserSlugOnly: vi.fn(),
    getUserNicknameSlug: vi.fn(),
    checkSharedTeam: vi.fn(),
    checkSharedSeason: vi.fn(),
    getUserFirstSeen: vi.fn(),
    getPublicUserBySlugOrId: vi.fn(),
    // Organizations RPC methods
    listOrganizations: vi.fn(),
    listOrganizationsWithCount: vi.fn(),
    listUserOrganizations: vi.fn(),
    getOrganizationById: vi.fn(),
    getOrganizationBySlug: vi.fn(),
    checkOrgMembership: vi.fn(),
    listOrgMembers: vi.fn(),
    // Projects RPC methods
    listProjects: vi.fn(),
    listAliasesWithStats: vi.fn(),
    listUnassignedRefs: vi.fn(),
    listProjectTags: vi.fn(),
    getProjectByName: vi.fn(),
    getProjectById: vi.fn(),
    getProjectByNameExcluding: vi.fn(),
    projectExistsForUser: vi.fn(),
    sessionRecordExists: vi.fn(),
    getAliasOwner: vi.fn(),
    aliasAttachedToProject: vi.fn(),
    projectTagExists: vi.fn(),
    getProjectAliasStats: vi.fn(),
    getProjectTagList: vi.fn(),
    getProjectTimeline: vi.fn(),
    // Seasons RPC methods
    listSeasons: vi.fn(),
    getSeasonById: vi.fn(),
    getSeasonBySlug: vi.fn(),
    getSeasonRegistration: vi.fn(),
    checkSeasonMemberConflict: vi.fn(),
    aggregateSeasonTeamTokens: vi.fn(),
    aggregateSeasonMemberTokens: vi.fn(),
    // Showcases RPC methods
    getShowcaseById: vi.fn(),
    getShowcaseOwner: vi.fn(),
    checkShowcaseExists: vi.fn(),
    checkShowcaseExistsByRepoKey: vi.fn(),
    checkShowcaseUpvote: vi.fn(),
    getShowcaseUpvoteCount: vi.fn(),
    listShowcases: vi.fn(),
    countShowcases: vi.fn(),
    // Teams RPC methods
    listTeamsForUser: vi.fn(),
    checkTeamSlugExists: vi.fn(),
    findTeamByInviteCode: vi.fn(),
    checkTeamMembershipExists: vi.fn(),
    getTeamById: vi.fn(),
    getTeamMembers: vi.fn(),
    getTeamSeasonRegistrations: vi.fn(),
    getTeamLogoUrl: vi.fn(),
    countTeamMembers: vi.fn(),
    getTeamMembership: vi.fn(),
    getAppSetting: vi.fn(),
    // Pricing RPC methods
    listModelPricing: vi.fn(),
    getModelPricingById: vi.fn(),
    getModelPricingByModelSource: vi.fn(),
    // Devices RPC methods
    listDevices: vi.fn(),
    checkDeviceExists: vi.fn(),
    checkDuplicateDeviceAlias: vi.fn(),
    checkDeviceHasRecords: vi.fn(),
    // Auth RPC methods
    getAuthCode: vi.fn(),
    listInviteCodes: vi.fn(),
    checkInviteCodeExists: vi.fn(),
    getInviteCodeById: vi.fn(),
    checkUserHasUnusedInvite: vi.fn(),
    // Settings RPC methods
    getAllAppSettings: vi.fn(),
    getAllUserSettings: vi.fn(),
    // Live RPC methods
    ping: vi.fn(),
  } as unknown as DbRead & {
    query: ReturnType<typeof vi.fn>;
    firstOrNull: ReturnType<typeof vi.fn>;
    getUserById: ReturnType<typeof vi.fn>;
    getUserBySlug: ReturnType<typeof vi.fn>;
    getUserByEmail: ReturnType<typeof vi.fn>;
    getUserByApiKey: ReturnType<typeof vi.fn>;
    getUserByOAuthAccount: ReturnType<typeof vi.fn>;
    checkSlugExists: ReturnType<typeof vi.fn>;
    getUserSettings: ReturnType<typeof vi.fn>;
    getUserApiKey: ReturnType<typeof vi.fn>;
    getUserEmail: ReturnType<typeof vi.fn>;
    searchUsers: ReturnType<typeof vi.fn>;
    getUserSlugOnly: ReturnType<typeof vi.fn>;
    getUserNicknameSlug: ReturnType<typeof vi.fn>;
    checkSharedTeam: ReturnType<typeof vi.fn>;
    checkSharedSeason: ReturnType<typeof vi.fn>;
    getUserFirstSeen: ReturnType<typeof vi.fn>;
    getPublicUserBySlugOrId: ReturnType<typeof vi.fn>;
    listOrganizations: ReturnType<typeof vi.fn>;
    listOrganizationsWithCount: ReturnType<typeof vi.fn>;
    listUserOrganizations: ReturnType<typeof vi.fn>;
    getOrganizationById: ReturnType<typeof vi.fn>;
    getOrganizationBySlug: ReturnType<typeof vi.fn>;
    checkOrgMembership: ReturnType<typeof vi.fn>;
    listOrgMembers: ReturnType<typeof vi.fn>;
    listProjects: ReturnType<typeof vi.fn>;
    listAliasesWithStats: ReturnType<typeof vi.fn>;
    listUnassignedRefs: ReturnType<typeof vi.fn>;
    listProjectTags: ReturnType<typeof vi.fn>;
    getProjectByName: ReturnType<typeof vi.fn>;
    getProjectById: ReturnType<typeof vi.fn>;
    getProjectByNameExcluding: ReturnType<typeof vi.fn>;
    projectExistsForUser: ReturnType<typeof vi.fn>;
    sessionRecordExists: ReturnType<typeof vi.fn>;
    getAliasOwner: ReturnType<typeof vi.fn>;
    aliasAttachedToProject: ReturnType<typeof vi.fn>;
    projectTagExists: ReturnType<typeof vi.fn>;
    getProjectAliasStats: ReturnType<typeof vi.fn>;
    getProjectTagList: ReturnType<typeof vi.fn>;
    getProjectTimeline: ReturnType<typeof vi.fn>;
    listSeasons: ReturnType<typeof vi.fn>;
    getSeasonById: ReturnType<typeof vi.fn>;
    getSeasonBySlug: ReturnType<typeof vi.fn>;
    getSeasonRegistration: ReturnType<typeof vi.fn>;
    checkSeasonMemberConflict: ReturnType<typeof vi.fn>;
    aggregateSeasonTeamTokens: ReturnType<typeof vi.fn>;
    aggregateSeasonMemberTokens: ReturnType<typeof vi.fn>;
    getShowcaseById: ReturnType<typeof vi.fn>;
    getShowcaseOwner: ReturnType<typeof vi.fn>;
    checkShowcaseExists: ReturnType<typeof vi.fn>;
    checkShowcaseExistsByRepoKey: ReturnType<typeof vi.fn>;
    checkShowcaseUpvote: ReturnType<typeof vi.fn>;
    getShowcaseUpvoteCount: ReturnType<typeof vi.fn>;
    listShowcases: ReturnType<typeof vi.fn>;
    countShowcases: ReturnType<typeof vi.fn>;
    listTeamsForUser: ReturnType<typeof vi.fn>;
    checkTeamSlugExists: ReturnType<typeof vi.fn>;
    findTeamByInviteCode: ReturnType<typeof vi.fn>;
    checkTeamMembershipExists: ReturnType<typeof vi.fn>;
    getTeamById: ReturnType<typeof vi.fn>;
    getTeamMembers: ReturnType<typeof vi.fn>;
    getTeamSeasonRegistrations: ReturnType<typeof vi.fn>;
    getTeamLogoUrl: ReturnType<typeof vi.fn>;
    countTeamMembers: ReturnType<typeof vi.fn>;
    getTeamMembership: ReturnType<typeof vi.fn>;
    getAppSetting: ReturnType<typeof vi.fn>;
    listModelPricing: ReturnType<typeof vi.fn>;
    getModelPricingById: ReturnType<typeof vi.fn>;
    getModelPricingByModelSource: ReturnType<typeof vi.fn>;
    listDevices: ReturnType<typeof vi.fn>;
    checkDeviceExists: ReturnType<typeof vi.fn>;
    checkDuplicateDeviceAlias: ReturnType<typeof vi.fn>;
    checkDeviceHasRecords: ReturnType<typeof vi.fn>;
    getAuthCode: ReturnType<typeof vi.fn>;
    listInviteCodes: ReturnType<typeof vi.fn>;
    checkInviteCodeExists: ReturnType<typeof vi.fn>;
    getInviteCodeById: ReturnType<typeof vi.fn>;
    checkUserHasUnusedInvite: ReturnType<typeof vi.fn>;
    getAllAppSettings: ReturnType<typeof vi.fn>;
    getAllUserSettings: ReturnType<typeof vi.fn>;
    ping: ReturnType<typeof vi.fn>;
  };
}

/** Mock DbWrite with `execute` + `batch`. */
export function createMockDbWrite() {
  return {
    execute: vi.fn(),
    batch: vi.fn(),
  } as unknown as DbWrite & {
    execute: ReturnType<typeof vi.fn>;
    batch: ReturnType<typeof vi.fn>;
  };
}

/**
 * Legacy "god mock" that combines read + write methods.
 * Prefer `createMockDbRead()` + `createMockDbWrite()` for new tests.
 */
export function createMockClient() {
  return {
    // Legacy SQL proxy
    query: vi.fn(),
    execute: vi.fn(),
    batch: vi.fn(),
    firstOrNull: vi.fn(),
    // Users RPC methods
    getUserById: vi.fn(),
    getUserBySlug: vi.fn(),
    getUserByEmail: vi.fn(),
    getUserByApiKey: vi.fn(),
    getUserByOAuthAccount: vi.fn(),
    checkSlugExists: vi.fn(),
    getUserSettings: vi.fn(),
    getUserApiKey: vi.fn(),
    getUserEmail: vi.fn(),
    searchUsers: vi.fn(),
    getUserSlugOnly: vi.fn(),
    getUserNicknameSlug: vi.fn(),
    checkSharedTeam: vi.fn(),
    checkSharedSeason: vi.fn(),
    getUserFirstSeen: vi.fn(),
    getPublicUserBySlugOrId: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Request builders
// ---------------------------------------------------------------------------

const BASE = "http://localhost:7020";

/** Build a GET request with optional query params. */
export function makeGetRequest(
  path: string,
  params: Record<string, string> = {},
): Request {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new Request(url.toString());
}

/** Build a JSON request with method + optional body. */
export function makeJsonRequest(
  method: string,
  path: string,
  body?: unknown,
): Request {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return new Request(`${BASE}${path}`, init);
}
