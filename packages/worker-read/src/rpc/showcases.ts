/**
 * Showcases domain RPC handlers for worker-read.
 *
 * Handles all showcase-related read queries with typed interfaces.
 */

import type { D1Database } from "@cloudflare/workers-types";

// ---------------------------------------------------------------------------
// Response Types
// ---------------------------------------------------------------------------

export interface ShowcaseRow {
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
  // GitHub stats
  stars: number;
  forks: number;
  language: string | null;
  license: string | null;
  topics: string | null;
  homepage: string | null;
  // Computed via subquery
  upvote_count: number;
  // Joined user fields
  user_name: string | null;
  user_nickname: string | null;
  user_image: string | null;
  user_slug: string | null;
  // Optional (only for authenticated requests)
  has_upvoted?: number;
}

// ---------------------------------------------------------------------------
// RPC Request Types
// ---------------------------------------------------------------------------

export interface GetShowcaseByIdRequest {
  method: "showcases.getById";
  showcaseId: string;
  currentUserId?: string; // For has_upvoted computation
}

export interface GetShowcaseBySlugRequest {
  method: "showcases.getBySlug";
  slug: string;
}

export interface GetShowcaseOwnerRequest {
  method: "showcases.getOwner";
  showcaseId: string;
}

export interface CheckShowcaseExistsRequest {
  method: "showcases.checkExists";
  userId: string;
  githubUrl: string;
}

export interface CheckUpvoteExistsRequest {
  method: "showcases.checkUpvote";
  showcaseId: string;
  visitorId: string;
}

export interface GetUpvoteCountRequest {
  method: "showcases.getUpvoteCount";
  showcaseId: string;
}

export interface ListShowcasesRequest {
  method: "showcases.list";
  userId?: string;
  publicOnly?: boolean;
  currentUserId?: string; // For has_upvoted computation
  orderBy?: "created_at" | "upvote_count";
  limit: number;
  offset: number;
}

export interface CountShowcasesRequest {
  method: "showcases.count";
  userId?: string;
  publicOnly?: boolean;
}

export interface CheckExistsByRepoKeyRequest {
  method: "showcases.checkExistsByRepoKey";
  repoKey: string;
}

export type ShowcasesRpcRequest =
  | GetShowcaseByIdRequest
  | GetShowcaseBySlugRequest
  | GetShowcaseOwnerRequest
  | CheckShowcaseExistsRequest
  | CheckExistsByRepoKeyRequest
  | CheckUpvoteExistsRequest
  | GetUpvoteCountRequest
  | ListShowcasesRequest
  | CountShowcasesRequest;

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleGetShowcaseById(
  req: GetShowcaseByIdRequest,
  db: D1Database
): Promise<Response> {
  if (!req.showcaseId) {
    return Response.json({ error: "showcaseId is required" }, { status: 400 });
  }

  let sql: string;
  const params: unknown[] = [];

  if (req.currentUserId) {
    // Authenticated: include has_upvoted
    sql = `SELECT
        s.id, s.user_id, s.repo_key, s.github_url, s.title, s.description,
        s.tagline, s.og_image_url, s.is_public, s.created_at, s.refreshed_at,
        s.stars, s.forks, s.language, s.license, s.topics, s.homepage,
        u.name as user_name, u.nickname as user_nickname, u.image as user_image, u.slug as user_slug,
        (SELECT COUNT(*) FROM showcase_upvotes WHERE showcase_id = s.id) as upvote_count,
        EXISTS(SELECT 1 FROM showcase_upvotes WHERE showcase_id = s.id AND user_id = ?) as has_upvoted
      FROM showcases s
      JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`;
    params.push(req.currentUserId, req.showcaseId);
  } else {
    // Unauthenticated: no has_upvoted
    sql = `SELECT
        s.id, s.user_id, s.repo_key, s.github_url, s.title, s.description,
        s.tagline, s.og_image_url, s.is_public, s.created_at, s.refreshed_at,
        s.stars, s.forks, s.language, s.license, s.topics, s.homepage,
        u.name as user_name, u.nickname as user_nickname, u.image as user_image, u.slug as user_slug,
        (SELECT COUNT(*) FROM showcase_upvotes WHERE showcase_id = s.id) as upvote_count
      FROM showcases s
      JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`;
    params.push(req.showcaseId);
  }

  const result = await db.prepare(sql).bind(...params).first<ShowcaseRow>();

  return Response.json({ result: result });
}

async function handleGetShowcaseBySlug(
  req: GetShowcaseBySlugRequest,
  db: D1Database
): Promise<Response> {
  if (!req.slug) {
    return Response.json({ error: "slug is required" }, { status: 400 });
  }

  const sql = `SELECT
      s.id, s.user_id, s.repo_key, s.github_url, s.title, s.description,
      s.tagline, s.og_image_url, s.is_public, s.created_at, s.refreshed_at,
      s.stars, s.forks, s.language, s.license, s.topics, s.homepage,
      u.name as user_name, u.nickname as user_nickname, u.image as user_image, u.slug as user_slug,
      (SELECT COUNT(*) FROM showcase_upvotes WHERE showcase_id = s.id) as upvote_count
    FROM showcases s
    JOIN users u ON u.id = s.user_id
    WHERE s.slug = ?`;

  const result = await db.prepare(sql).bind(req.slug).first<ShowcaseRow>();

  return Response.json({ result: result });
}

async function handleGetShowcaseOwner(
  req: GetShowcaseOwnerRequest,
  db: D1Database
): Promise<Response> {
  if (!req.showcaseId) {
    return Response.json({ error: "showcaseId is required" }, { status: 400 });
  }

  const result = await db
    .prepare(`SELECT id, user_id FROM showcases WHERE id = ?`)
    .bind(req.showcaseId)
    .first<{ id: string; user_id: string }>();

  return Response.json({ result: result });
}

async function handleCheckShowcaseExists(
  req: CheckShowcaseExistsRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userId || !req.githubUrl) {
    return Response.json(
      { error: "userId and githubUrl are required" },
      { status: 400 }
    );
  }

  const result = await db
    .prepare(`SELECT id FROM showcases WHERE user_id = ? AND github_url = ?`)
    .bind(req.userId, req.githubUrl)
    .first<{ id: string }>();

  return Response.json({ result: { exists: result !== null, id: result?.id } });
}

async function handleCheckUpvoteExists(
  req: CheckUpvoteExistsRequest,
  db: D1Database
): Promise<Response> {
  if (!req.showcaseId || !req.visitorId) {
    return Response.json(
      { error: "showcaseId and visitorId are required" },
      { status: 400 }
    );
  }

  const result = await db
    .prepare(
      `SELECT id FROM showcase_upvotes
       WHERE showcase_id = ? AND user_id = ?`
    )
    .bind(req.showcaseId, req.visitorId)
    .first<{ id: number }>();

  return Response.json({ result: { exists: result !== null } });
}

async function handleGetUpvoteCount(
  req: GetUpvoteCountRequest,
  db: D1Database
): Promise<Response> {
  if (!req.showcaseId) {
    return Response.json({ error: "showcaseId is required" }, { status: 400 });
  }

  const result = await db
    .prepare(`SELECT COUNT(*) AS count FROM showcase_upvotes WHERE showcase_id = ?`)
    .bind(req.showcaseId)
    .first<{ count: number }>();

  return Response.json({ result: result?.count ?? 0 });
}

async function handleListShowcases(
  req: ListShowcasesRequest,
  db: D1Database
): Promise<Response> {
  const params: unknown[] = [];

  // Build SELECT clause based on whether currentUserId is provided
  let selectClause: string;
  if (req.currentUserId) {
    // Authenticated: include has_upvoted
    selectClause = `SELECT
      s.id, s.user_id, s.repo_key, s.github_url, s.title, s.description,
      s.tagline, s.og_image_url, s.is_public, s.created_at, s.refreshed_at,
      s.stars, s.forks, s.language, s.license, s.topics, s.homepage,
      u.name as user_name, u.nickname as user_nickname, u.image as user_image, u.slug as user_slug,
      (SELECT COUNT(*) FROM showcase_upvotes WHERE showcase_id = s.id) as upvote_count,
      EXISTS(SELECT 1 FROM showcase_upvotes WHERE showcase_id = s.id AND user_id = ?) as has_upvoted`;
    params.push(req.currentUserId);
  } else {
    // Unauthenticated: no has_upvoted
    selectClause = `SELECT
      s.id, s.user_id, s.repo_key, s.github_url, s.title, s.description,
      s.tagline, s.og_image_url, s.is_public, s.created_at, s.refreshed_at,
      s.stars, s.forks, s.language, s.license, s.topics, s.homepage,
      u.name as user_name, u.nickname as user_nickname, u.image as user_image, u.slug as user_slug,
      (SELECT COUNT(*) FROM showcase_upvotes WHERE showcase_id = s.id) as upvote_count`;
  }

  let sql = `${selectClause}
    FROM showcases s
    JOIN users u ON u.id = s.user_id`;

  // Build WHERE clause
  if (req.userId) {
    sql += ` WHERE s.user_id = ?`;
    params.push(req.userId);
  } else if (req.publicOnly) {
    sql += ` WHERE s.is_public = 1`;
  }

  // Build ORDER BY clause
  if (req.orderBy === "upvote_count") {
    sql += ` ORDER BY upvote_count DESC, s.created_at DESC, s.id DESC`;
  } else {
    sql += ` ORDER BY s.created_at DESC, s.id DESC`;
  }

  sql += ` LIMIT ? OFFSET ?`;
  params.push(req.limit, req.offset);

  const results = await db.prepare(sql).bind(...params).all<ShowcaseRow>();

  return Response.json({ result: results.results });
}

async function handleCountShowcases(
  req: CountShowcasesRequest,
  db: D1Database
): Promise<Response> {
  let sql = `SELECT COUNT(*) AS count FROM showcases`;
  const params: unknown[] = [];

  if (req.userId) {
    sql += ` WHERE user_id = ?`;
    params.push(req.userId);
  } else if (req.publicOnly) {
    sql += ` WHERE is_public = 1`;
  }

  const stmt = db.prepare(sql);
  const result = params.length > 0
    ? await stmt.bind(...params).first<{ count: number }>()
    : await stmt.first<{ count: number }>();

  return Response.json({ result: result?.count ?? 0 });
}

async function handleCheckExistsByRepoKey(
  req: CheckExistsByRepoKeyRequest,
  db: D1Database
): Promise<Response> {
  if (!req.repoKey) {
    return Response.json({ error: "repoKey is required" }, { status: 400 });
  }

  const result = await db
    .prepare(`SELECT id FROM showcases WHERE repo_key = ?`)
    .bind(req.repoKey)
    .first<{ id: string }>();

  return Response.json({ result: { exists: result !== null, id: result?.id } });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handleShowcasesRpc(
  request: ShowcasesRpcRequest,
  db: D1Database
): Promise<Response> {
  switch (request.method) {
    case "showcases.getById":
      return handleGetShowcaseById(request, db);
    case "showcases.getBySlug":
      return handleGetShowcaseBySlug(request, db);
    case "showcases.getOwner":
      return handleGetShowcaseOwner(request, db);
    case "showcases.checkExists":
      return handleCheckShowcaseExists(request, db);
    case "showcases.checkExistsByRepoKey":
      return handleCheckExistsByRepoKey(request, db);
    case "showcases.checkUpvote":
      return handleCheckUpvoteExists(request, db);
    case "showcases.getUpvoteCount":
      return handleGetUpvoteCount(request, db);
    case "showcases.list":
      return handleListShowcases(request, db);
    case "showcases.count":
      return handleCountShowcases(request, db);
    default:
      return Response.json(
        { error: `Unknown showcases method: ${(request as { method: string }).method}` },
        { status: 400 }
      );
  }
}
