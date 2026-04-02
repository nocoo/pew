/**
 * Auth.js adapter backed by Cloudflare D1 HTTP API.
 *
 * Implements the minimal adapter interface needed for JWT strategy
 * with Google OAuth: createUser, getUser, getUserByEmail,
 * getUserByAccount, linkAccount, updateUser.
 */

import type { Adapter, AdapterUser, AdapterAccount } from "next-auth/adapters";
import type { DbRead, DbWrite } from "./db";

// ---------------------------------------------------------------------------
// Row ↔ AdapterUser mapping
// ---------------------------------------------------------------------------

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  email_verified: string | null;
}

function rowToUser(row: UserRow): AdapterUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    image: row.image,
    emailVerified: row.email_verified ? new Date(row.email_verified) : null,
  };
}

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

export function D1AuthAdapter(dbRead: DbRead, dbWrite: DbWrite): Adapter {
  return {
    async createUser(user) {
      const id = user.id ?? crypto.randomUUID();
      await dbWrite.execute(
        `INSERT INTO users (id, email, name, image, email_verified, is_public)
         VALUES (?, ?, ?, ?, ?, 1)`,
        [
          id,
          user.email,
          user.name ?? null,
          user.image ?? null,
          user.emailVerified?.toISOString() ?? null,
        ]
      );
      return { ...user, id };
    },

    async getUser(id) {
      const row = await dbRead.firstOrNull<UserRow>(
        "SELECT id, email, name, image, email_verified FROM users WHERE id = ?",
        [id]
      );
      return row ? rowToUser(row) : null;
    },

    async getUserByEmail(email) {
      const row = await dbRead.firstOrNull<UserRow>(
        "SELECT id, email, name, image, email_verified FROM users WHERE email = ?",
        [email]
      );
      return row ? rowToUser(row) : null;
    },

    async getUserByAccount({ provider, providerAccountId }) {
      const row = await dbRead.firstOrNull<UserRow>(
        `SELECT u.id, u.email, u.name, u.image, u.email_verified
         FROM users u
         JOIN accounts a ON u.id = a.user_id
         WHERE a.provider = ? AND a.provider_account_id = ?`,
        [provider, providerAccountId]
      );
      return row ? rowToUser(row) : null;
    },

    async linkAccount(account: AdapterAccount) {
      await dbWrite.execute(
        `INSERT INTO accounts (id, user_id, type, provider, provider_account_id,
         access_token, refresh_token, expires_at, token_type, scope, id_token)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(),
          account.userId,
          account.type,
          account.provider,
          account.providerAccountId,
          account.access_token ?? null,
          account.refresh_token ?? null,
          account.expires_at ?? null,
          account.token_type ?? null,
          account.scope ?? null,
          account.id_token ?? null,
        ]
      );
    },

    async updateUser(user) {
      // Build dynamic SET clause from provided fields
      const sets: string[] = [];
      const params: unknown[] = [];

      if (user.name !== undefined) {
        sets.push("name = ?");
        params.push(user.name);
      }
      if (user.email !== undefined) {
        sets.push("email = ?");
        params.push(user.email);
      }
      if (user.image !== undefined) {
        sets.push("image = ?");
        params.push(user.image);
      }
      if (user.emailVerified !== undefined) {
        sets.push("email_verified = ?");
        params.push(user.emailVerified?.toISOString() ?? null);
      }

      if (sets.length > 0) {
        sets.push("updated_at = datetime('now')");
        params.push(user.id);
        await dbWrite.execute(
          `UPDATE users SET ${sets.join(", ")} WHERE id = ?`,
          params
        );
      }

      // Return updated user
      const row = await dbRead.firstOrNull<UserRow>(
        "SELECT id, email, name, image, email_verified FROM users WHERE id = ?",
        [user.id]
      );
      if (!row) throw new Error(`User ${user.id} not found after update`);
      return rowToUser(row);
    },
  };
}
