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
