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
  };

  return reader;
}
