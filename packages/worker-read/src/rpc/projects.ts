/**
 * Projects domain RPC handlers for worker-read.
 *
 * Handles all project-related read queries with typed interfaces.
 */

import type { D1Database } from "@cloudflare/workers-types";

// ---------------------------------------------------------------------------
// Request/Response Types
// ---------------------------------------------------------------------------

export interface ProjectRow {
  id: string;
  name: string;
  created_at: string;
}

export interface AliasStatsRow {
  source: string;
  project_ref: string;
  project_id: string | null;
  session_count: number;
  last_active: string | null;
  total_duration_seconds: number;
}

export interface UnassignedRow {
  source: string;
  project_ref: string;
  session_count: number;
  last_active: string | null;
  total_duration_seconds: number;
}

export interface TagRow {
  project_id: string;
  tag: string;
}

export interface TimelineRow {
  project_id: string;
  day: string;
  session_count: number;
}

// ---------------------------------------------------------------------------
// RPC Request Types
// ---------------------------------------------------------------------------

export interface ListProjectsRequest {
  method: "projects.list";
  userId: string;
}

export interface ListAliasesWithStatsRequest {
  method: "projects.listAliasesWithStats";
  userId: string;
  from?: string;
  to?: string;
}

export interface ListUnassignedRefsRequest {
  method: "projects.listUnassignedRefs";
  userId: string;
  from?: string;
  to?: string;
}

export interface ListProjectTagsRequest {
  method: "projects.listTags";
  userId: string;
}

export interface GetProjectByNameRequest {
  method: "projects.getByName";
  userId: string;
  name: string;
}

export interface GetProjectByIdRequest {
  method: "projects.getById";
  userId: string;
  projectId: string;
}

export interface SessionRecordExistsRequest {
  method: "projects.sessionRecordExists";
  userId: string;
  source: string;
  projectRef: string;
}

export interface GetAliasOwnerRequest {
  method: "projects.getAliasOwner";
  userId: string;
  source: string;
  projectRef: string;
}

export interface AliasAttachedToProjectRequest {
  method: "projects.aliasAttachedToProject";
  userId: string;
  projectId: string;
  source: string;
  projectRef: string;
}

export interface ProjectTagExistsRequest {
  method: "projects.tagExists";
  userId: string;
  projectId: string;
  tag: string;
}

export interface GetProjectAliasStatsRequest {
  method: "projects.getAliasStats";
  projectId: string;
}

export interface GetProjectTagListRequest {
  method: "projects.getTagList";
  userId: string;
  projectId: string;
}

export interface GetProjectTimelineRequest {
  method: "projects.getTimeline";
  userId: string;
  from: string;
  to: string;
}

export interface GetProjectByNameExcludingRequest {
  method: "projects.getByNameExcluding";
  userId: string;
  name: string;
  excludeId: string;
}

export interface ProjectExistsForUserRequest {
  method: "projects.existsForUser";
  userId: string;
  projectId: string;
}

export type ProjectsRpcRequest =
  | ListProjectsRequest
  | ListAliasesWithStatsRequest
  | ListUnassignedRefsRequest
  | ListProjectTagsRequest
  | GetProjectByNameRequest
  | GetProjectByIdRequest
  | SessionRecordExistsRequest
  | GetAliasOwnerRequest
  | AliasAttachedToProjectRequest
  | ProjectTagExistsRequest
  | GetProjectAliasStatsRequest
  | GetProjectTagListRequest
  | GetProjectTimelineRequest
  | GetProjectByNameExcludingRequest
  | ProjectExistsForUserRequest;

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleListProjects(
  req: ListProjectsRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userId) {
    return Response.json({ error: "userId is required" }, { status: 400 });
  }

  const results = await db
    .prepare(
      `SELECT id, name, created_at FROM projects WHERE user_id = ? ORDER BY created_at DESC`
    )
    .bind(req.userId)
    .all<ProjectRow>();

  return Response.json({ data: results.results });
}

async function handleListAliasesWithStats(
  req: ListAliasesWithStatsRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userId) {
    return Response.json({ error: "userId is required" }, { status: 400 });
  }

  let sql: string;
  let params: string[];

  if (req.from && req.to) {
    // With date range filter
    sql = `
      SELECT
        sr.source,
        sr.project_ref,
        pa.project_id,
        COUNT(*) AS session_count,
        MAX(sr.started_at) AS last_active,
        COALESCE(SUM(sr.duration_seconds), 0) AS total_duration_seconds
      FROM session_records sr
      LEFT JOIN project_aliases pa
        ON pa.user_id = sr.user_id
        AND pa.source = sr.source
        AND pa.project_ref = sr.project_ref
      WHERE sr.user_id = ?
        AND sr.started_at >= ?
        AND sr.started_at < ?
        AND sr.project_ref IS NOT NULL
        AND sr.project_ref != ''
      GROUP BY sr.source, sr.project_ref
      ORDER BY session_count DESC
    `;
    params = [req.userId, req.from, req.to];
  } else {
    // All-time
    sql = `
      SELECT
        sr.source,
        sr.project_ref,
        pa.project_id,
        COUNT(*) AS session_count,
        MAX(sr.started_at) AS last_active,
        COALESCE(SUM(sr.duration_seconds), 0) AS total_duration_seconds
      FROM session_records sr
      LEFT JOIN project_aliases pa
        ON pa.user_id = sr.user_id
        AND pa.source = sr.source
        AND pa.project_ref = sr.project_ref
      WHERE sr.user_id = ?
        AND sr.project_ref IS NOT NULL
        AND sr.project_ref != ''
      GROUP BY sr.source, sr.project_ref
      ORDER BY session_count DESC
    `;
    params = [req.userId];
  }

  const stmt = db.prepare(sql);
  const results = await stmt.bind(...params).all<AliasStatsRow>();

  return Response.json({ data: results.results });
}

async function handleListUnassignedRefs(
  req: ListUnassignedRefsRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userId) {
    return Response.json({ error: "userId is required" }, { status: 400 });
  }

  let sql: string;
  let params: string[];

  if (req.from && req.to) {
    sql = `
      SELECT
        sr.source,
        sr.project_ref,
        COUNT(*) AS session_count,
        MAX(sr.started_at) AS last_active,
        COALESCE(SUM(sr.duration_seconds), 0) AS total_duration_seconds
      FROM session_records sr
      WHERE sr.user_id = ?
        AND sr.project_ref IS NOT NULL
        AND sr.project_ref != ''
        AND sr.started_at >= ?
        AND sr.started_at < ?
        AND NOT EXISTS (
          SELECT 1 FROM project_aliases pa
          WHERE pa.user_id = sr.user_id
            AND pa.source = sr.source
            AND pa.project_ref = sr.project_ref
        )
      GROUP BY sr.source, sr.project_ref
      ORDER BY session_count DESC
    `;
    params = [req.userId, req.from, req.to];
  } else {
    sql = `
      SELECT
        sr.source,
        sr.project_ref,
        COUNT(*) AS session_count,
        MAX(sr.started_at) AS last_active,
        COALESCE(SUM(sr.duration_seconds), 0) AS total_duration_seconds
      FROM session_records sr
      WHERE sr.user_id = ?
        AND sr.project_ref IS NOT NULL
        AND sr.project_ref != ''
        AND NOT EXISTS (
          SELECT 1 FROM project_aliases pa
          WHERE pa.user_id = sr.user_id
            AND pa.source = sr.source
            AND pa.project_ref = sr.project_ref
        )
      GROUP BY sr.source, sr.project_ref
      ORDER BY session_count DESC
    `;
    params = [req.userId];
  }

  const stmt = db.prepare(sql);
  const results = await stmt.bind(...params).all<UnassignedRow>();

  return Response.json({ data: results.results });
}

async function handleListProjectTags(
  req: ListProjectTagsRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userId) {
    return Response.json({ error: "userId is required" }, { status: 400 });
  }

  const results = await db
    .prepare(`SELECT project_id, tag FROM project_tags WHERE user_id = ?`)
    .bind(req.userId)
    .all<TagRow>();

  return Response.json({ data: results.results });
}

async function handleGetProjectByName(
  req: GetProjectByNameRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userId || !req.name) {
    return Response.json(
      { error: "userId and name are required" },
      { status: 400 }
    );
  }

  const result = await db
    .prepare(`SELECT id FROM projects WHERE user_id = ? AND name = ?`)
    .bind(req.userId, req.name)
    .first<{ id: string }>();

  return Response.json({ data: result });
}

async function handleGetProjectById(
  req: GetProjectByIdRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userId || !req.projectId) {
    return Response.json(
      { error: "userId and projectId are required" },
      { status: 400 }
    );
  }

  const result = await db
    .prepare(
      `SELECT id, name, created_at FROM projects WHERE id = ? AND user_id = ?`
    )
    .bind(req.projectId, req.userId)
    .first<ProjectRow>();

  return Response.json({ data: result });
}

async function handleSessionRecordExists(
  req: SessionRecordExistsRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userId || !req.source || !req.projectRef) {
    return Response.json(
      { error: "userId, source, and projectRef are required" },
      { status: 400 }
    );
  }

  const result = await db
    .prepare(
      `SELECT 1 FROM session_records
       WHERE user_id = ? AND source = ? AND project_ref = ?
       LIMIT 1`
    )
    .bind(req.userId, req.source, req.projectRef)
    .first<{ "1": number }>();

  return Response.json({ data: { exists: result !== null } });
}

async function handleGetAliasOwner(
  req: GetAliasOwnerRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userId || !req.source || !req.projectRef) {
    return Response.json(
      { error: "userId, source, and projectRef are required" },
      { status: 400 }
    );
  }

  const result = await db
    .prepare(
      `SELECT project_id FROM project_aliases
       WHERE user_id = ? AND source = ? AND project_ref = ?`
    )
    .bind(req.userId, req.source, req.projectRef)
    .first<{ project_id: string }>();

  return Response.json({ data: result });
}

async function handleAliasAttachedToProject(
  req: AliasAttachedToProjectRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userId || !req.projectId || !req.source || !req.projectRef) {
    return Response.json(
      { error: "userId, projectId, source, and projectRef are required" },
      { status: 400 }
    );
  }

  const result = await db
    .prepare(
      `SELECT project_id FROM project_aliases
       WHERE user_id = ? AND project_id = ? AND source = ? AND project_ref = ?`
    )
    .bind(req.userId, req.projectId, req.source, req.projectRef)
    .first<{ project_id: string }>();

  return Response.json({ data: { attached: result !== null } });
}

async function handleProjectTagExists(
  req: ProjectTagExistsRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userId || !req.projectId || !req.tag) {
    return Response.json(
      { error: "userId, projectId, and tag are required" },
      { status: 400 }
    );
  }

  const result = await db
    .prepare(
      `SELECT tag FROM project_tags
       WHERE user_id = ? AND project_id = ? AND tag = ?`
    )
    .bind(req.userId, req.projectId, req.tag)
    .first<{ tag: string }>();

  return Response.json({ data: { exists: result !== null } });
}

async function handleGetProjectAliasStats(
  req: GetProjectAliasStatsRequest,
  db: D1Database
): Promise<Response> {
  if (!req.projectId) {
    return Response.json({ error: "projectId is required" }, { status: 400 });
  }

  const results = await db
    .prepare(
      `
      SELECT
        pa.source,
        pa.project_ref,
        pa.project_id,
        COUNT(sr.id) AS session_count,
        MAX(sr.started_at) AS last_active,
        COALESCE(SUM(sr.duration_seconds), 0) AS total_duration_seconds
      FROM project_aliases pa
      LEFT JOIN session_records sr
        ON sr.user_id = pa.user_id
        AND sr.source = pa.source
        AND sr.project_ref = pa.project_ref
      WHERE pa.project_id = ?
      GROUP BY pa.source, pa.project_ref
      ORDER BY session_count DESC
    `
    )
    .bind(req.projectId)
    .all<AliasStatsRow>();

  return Response.json({ data: results.results });
}

async function handleGetProjectTagList(
  req: GetProjectTagListRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userId || !req.projectId) {
    return Response.json(
      { error: "userId and projectId are required" },
      { status: 400 }
    );
  }

  const results = await db
    .prepare(
      `SELECT tag FROM project_tags
       WHERE user_id = ? AND project_id = ?
       ORDER BY tag ASC`
    )
    .bind(req.userId, req.projectId)
    .all<{ tag: string }>();

  return Response.json({ data: results.results.map((r) => r.tag) });
}

async function handleGetProjectTimeline(
  req: GetProjectTimelineRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userId || !req.from || !req.to) {
    return Response.json(
      { error: "userId, from, and to are required" },
      { status: 400 }
    );
  }

  const results = await db
    .prepare(
      `
      SELECT
        pa.project_id,
        DATE(sr.started_at) AS day,
        COUNT(*) AS session_count
      FROM session_records sr
      JOIN project_aliases pa
        ON pa.user_id = sr.user_id
        AND pa.source = sr.source
        AND pa.project_ref = sr.project_ref
      WHERE sr.user_id = ?
        AND sr.started_at >= ?
        AND sr.started_at < ?
        AND sr.project_ref IS NOT NULL
        AND sr.project_ref != ''
      GROUP BY pa.project_id, DATE(sr.started_at)
      ORDER BY day ASC
    `
    )
    .bind(req.userId, req.from, req.to)
    .all<TimelineRow>();

  return Response.json({ data: results.results });
}

async function handleGetProjectByNameExcluding(
  req: GetProjectByNameExcludingRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userId || !req.name || !req.excludeId) {
    return Response.json(
      { error: "userId, name, and excludeId are required" },
      { status: 400 }
    );
  }

  const result = await db
    .prepare(
      `SELECT id FROM projects WHERE user_id = ? AND name = ? AND id != ?`
    )
    .bind(req.userId, req.name, req.excludeId)
    .first<{ id: string }>();

  return Response.json({ data: result });
}

async function handleProjectExistsForUser(
  req: ProjectExistsForUserRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userId || !req.projectId) {
    return Response.json(
      { error: "userId and projectId are required" },
      { status: 400 }
    );
  }

  const result = await db
    .prepare(`SELECT id FROM projects WHERE id = ? AND user_id = ?`)
    .bind(req.projectId, req.userId)
    .first<{ id: string }>();

  return Response.json({ data: { exists: result !== null } });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handleProjectsRpc(
  request: ProjectsRpcRequest,
  db: D1Database
): Promise<Response> {
  switch (request.method) {
    case "projects.list":
      return handleListProjects(request, db);
    case "projects.listAliasesWithStats":
      return handleListAliasesWithStats(request, db);
    case "projects.listUnassignedRefs":
      return handleListUnassignedRefs(request, db);
    case "projects.listTags":
      return handleListProjectTags(request, db);
    case "projects.getByName":
      return handleGetProjectByName(request, db);
    case "projects.getById":
      return handleGetProjectById(request, db);
    case "projects.sessionRecordExists":
      return handleSessionRecordExists(request, db);
    case "projects.getAliasOwner":
      return handleGetAliasOwner(request, db);
    case "projects.aliasAttachedToProject":
      return handleAliasAttachedToProject(request, db);
    case "projects.tagExists":
      return handleProjectTagExists(request, db);
    case "projects.getAliasStats":
      return handleGetProjectAliasStats(request, db);
    case "projects.getTagList":
      return handleGetProjectTagList(request, db);
    case "projects.getTimeline":
      return handleGetProjectTimeline(request, db);
    case "projects.getByNameExcluding":
      return handleGetProjectByNameExcluding(request, db);
    case "projects.existsForUser":
      return handleProjectExistsForUser(request, db);
    default:
      return Response.json(
        { error: `Unknown projects method: ${(request as { method: string }).method}` },
        { status: 400 }
      );
  }
}
