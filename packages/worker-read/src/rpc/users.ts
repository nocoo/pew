/**
 * Users domain RPC handlers.
 *
 * Provides typed query methods for user-related read operations,
 * replacing raw SQL queries with named endpoints.
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
  | SearchUsersRequest;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleUsersRpc(
  request: UsersRpcRequest,
  db: D1Database,
): Promise<Response> {
  switch (request.method) {
    case "users.getById":
      return handleGetUserById(request, db);
    case "users.getBySlug":
      return handleGetUserBySlug(request, db);
    case "users.getByEmail":
      return handleGetUserByEmail(request, db);
    case "users.getByApiKey":
      return handleGetUserByApiKey(request, db);
    case "users.getByOAuthAccount":
      return handleGetUserByOAuthAccount(request, db);
    case "users.checkSlugExists":
      return handleCheckSlugExists(request, db);
    case "users.getSettings":
      return handleGetUserSettings(request, db);
    case "users.getApiKey":
      return handleGetUserApiKey(request, db);
    case "users.getEmail":
      return handleGetUserEmail(request, db);
    case "users.search":
      return handleSearchUsers(request, db);
    default:
      return Response.json(
        { error: `Unknown users method: ${(request as { method: string }).method}` },
        { status: 400 },
      );
  }
}

// ---------------------------------------------------------------------------
// Individual handlers
// ---------------------------------------------------------------------------

async function handleGetUserById(
  req: GetUserByIdRequest,
  db: D1Database,
): Promise<Response> {
  if (!req.id) {
    return Response.json({ error: "Missing id" }, { status: 400 });
  }

  const row = await db
    .prepare(
      "SELECT id, email, name, image, email_verified FROM users WHERE id = ?",
    )
    .bind(req.id)
    .first<UserAuth>();

  return Response.json({ result: row ?? null });
}

async function handleGetUserBySlug(
  req: GetUserBySlugRequest,
  db: D1Database,
): Promise<Response> {
  if (!req.slug) {
    return Response.json({ error: "Missing slug" }, { status: 400 });
  }

  const row = await db
    .prepare(
      "SELECT id, name, nickname, image, slug, created_at, is_public FROM users WHERE slug = ?",
    )
    .bind(req.slug)
    .first<UserProfile>();

  return Response.json({ result: row ?? null });
}

async function handleGetUserByEmail(
  req: GetUserByEmailRequest,
  db: D1Database,
): Promise<Response> {
  if (!req.email) {
    return Response.json({ error: "Missing email" }, { status: 400 });
  }

  const row = await db
    .prepare(
      "SELECT id, email, name, image, email_verified FROM users WHERE email = ?",
    )
    .bind(req.email)
    .first<UserAuth>();

  return Response.json({ result: row ?? null });
}

async function handleGetUserByApiKey(
  req: GetUserByApiKeyRequest,
  db: D1Database,
): Promise<Response> {
  if (!req.apiKey) {
    return Response.json({ error: "Missing apiKey" }, { status: 400 });
  }

  const row = await db
    .prepare("SELECT id, email FROM users WHERE api_key = ?")
    .bind(req.apiKey)
    .first<UserApiKeyAuth>();

  return Response.json({ result: row ?? null });
}

async function handleGetUserByOAuthAccount(
  req: GetUserByOAuthAccountRequest,
  db: D1Database,
): Promise<Response> {
  if (!req.provider || !req.providerAccountId) {
    return Response.json(
      { error: "Missing provider or providerAccountId" },
      { status: 400 },
    );
  }

  const row = await db
    .prepare(
      `SELECT u.id, u.email, u.name, u.image, u.email_verified
       FROM users u
       JOIN accounts a ON u.id = a.user_id
       WHERE a.provider = ? AND a.provider_account_id = ?`,
    )
    .bind(req.provider, req.providerAccountId)
    .first<UserAuth>();

  return Response.json({ result: row ?? null });
}

async function handleCheckSlugExists(
  req: CheckSlugExistsRequest,
  db: D1Database,
): Promise<Response> {
  if (!req.slug) {
    return Response.json({ error: "Missing slug" }, { status: 400 });
  }

  let row: { id: string } | null;
  if (req.excludeUserId) {
    row = await db
      .prepare("SELECT id FROM users WHERE slug = ? AND id != ?")
      .bind(req.slug, req.excludeUserId)
      .first<{ id: string }>();
  } else {
    row = await db
      .prepare("SELECT id FROM users WHERE slug = ?")
      .bind(req.slug)
      .first<{ id: string }>();
  }

  return Response.json({ result: { exists: row !== null } });
}

async function handleGetUserSettings(
  req: GetUserSettingsRequest,
  db: D1Database,
): Promise<Response> {
  if (!req.userId) {
    return Response.json({ error: "Missing userId" }, { status: 400 });
  }

  const row = await db
    .prepare("SELECT nickname, slug, is_public FROM users WHERE id = ?")
    .bind(req.userId)
    .first<UserSettings>();

  return Response.json({ result: row ?? null });
}

async function handleGetUserApiKey(
  req: GetUserApiKeyRequest,
  db: D1Database,
): Promise<Response> {
  if (!req.userId) {
    return Response.json({ error: "Missing userId" }, { status: 400 });
  }

  const row = await db
    .prepare("SELECT api_key FROM users WHERE id = ?")
    .bind(req.userId)
    .first<{ api_key: string | null }>();

  return Response.json({ result: row ?? null });
}

async function handleGetUserEmail(
  req: GetUserEmailRequest,
  db: D1Database,
): Promise<Response> {
  if (!req.userId) {
    return Response.json({ error: "Missing userId" }, { status: 400 });
  }

  const row = await db
    .prepare("SELECT email FROM users WHERE id = ?")
    .bind(req.userId)
    .first<{ email: string }>();

  return Response.json({ result: row ?? null });
}

async function handleSearchUsers(
  req: SearchUsersRequest,
  db: D1Database,
): Promise<Response> {
  if (!req.query) {
    return Response.json({ error: "Missing query" }, { status: 400 });
  }

  const limit = Math.min(req.limit ?? 20, 100);
  const pattern = `%${req.query}%`;

  const { results } = await db
    .prepare(
      `SELECT id, name, email, image FROM users
       WHERE name LIKE ? OR email LIKE ?
       ORDER BY name ASC
       LIMIT ?`,
    )
    .bind(pattern, pattern, limit)
    .all<SearchUsersResult>();

  return Response.json({ result: results ?? [] });
}
