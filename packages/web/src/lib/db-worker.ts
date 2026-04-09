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
  OrgRow,
  OrgWithCountRow,
  OrgMemberRow,
  ShowcaseRpcRow,
  ShowcaseOwnerRow,
  ShowcaseExistsResult,
  PricingRow,
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

    async getTeamLogoUrl(teamId: string): Promise<string | null> {
      const result = await rpc<{ logo_url: string | null } | null>({
        method: "teams.getLogoUrl",
        teamId,
      });
      return result?.logo_url ?? null;
    },

    async countTeamMembers(teamId: string): Promise<number> {
      return rpc<number>({ method: "teams.countMembers", teamId });
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
  };

  return reader;
}
