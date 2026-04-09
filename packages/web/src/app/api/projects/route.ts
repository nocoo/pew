/**
 * GET /api/projects — list all projects + unassigned refs for the authenticated user.
 * POST /api/projects — create a new project with optional initial aliases.
 */

import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth-helpers";
import { getDbRead, getDbWrite } from "@/lib/db";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_SOURCES = new Set([
  "claude-code",
  "codex",
  "copilot-cli",
  "gemini-cli",
  "hermes",
  "kosmos",
  "opencode",
  "openclaw",
  "pi",
  "vscode-copilot",
]);

const MAX_NAME_LENGTH = 100;

/** Names reserved for internal UI/API use (case-insensitive comparison). */
const RESERVED_NAMES = new Set(["unassigned"]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProjectRow {
  id: string;
  name: string;
  created_at: string;
}

interface TagRow {
  project_id: string;
  tag: string;
}

interface AliasStatsRow {
  project_id: string;
  source: string;
  project_ref: string;
  session_count: number;
  last_active: string | null;
  total_messages: number;
  total_duration: number;
  models: string | null;
  absolute_last_active: string | null;
}

interface UnassignedRow {
  source: string;
  project_ref: string;
  session_count: number;
  last_active: string | null;
  total_messages: number;
  total_duration: number;
  models: string | null;
}

interface AliasInput {
  source: string;
  project_ref: string;
}

// ---------------------------------------------------------------------------
// GET — list projects + unassigned refs
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const authResult = await resolveUser(request);
  if (!authResult) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = authResult.userId;
  const dbRead = await getDbRead();

  // Parse optional date range — `from` alone is valid (defaults `to` to tomorrow)
  const url = new URL(request.url);
  const from = url.searchParams.get("from"); // inclusive, YYYY-MM-DD
  const toParam = url.searchParams.get("to"); // exclusive, YYYY-MM-DD
  const hasDateRange = from !== null;
  // Default `to` to tomorrow (UTC) when absent — matches /api/usage pattern
  const to = hasDateRange
    ? (toParam ?? new Date(Date.now() + 86_400_000).toISOString().slice(0, 10))
    : null;

  try {
    // Query 1: Project metadata (unchanged — always returns all projects)
    const projectsResult = await dbRead.query<ProjectRow>(
      `SELECT id, name, created_at
       FROM projects
       WHERE user_id = ?
       ORDER BY created_at DESC`,
      [userId],
    );

    // Query 2: Aliases with per-alias session stats
    // When from/to provided: two LEFT JOINs — sr (period-scoped), sr_all (all-time)
    // When absent: single LEFT JOIN (sr), no sr_all needed
    let aliasesResult;
    if (hasDateRange) {
      aliasesResult = await dbRead.query<AliasStatsRow>(
        `SELECT
           pa.project_id,
           pa.source,
           pa.project_ref,
           COUNT(sr.id) AS session_count,
           MAX(sr.last_message_at) AS last_active,
           COALESCE(SUM(sr.total_messages), 0) AS total_messages,
           COALESCE(SUM(sr.duration_seconds), 0) AS total_duration,
           GROUP_CONCAT(DISTINCT sr.model) AS models,
           (SELECT MAX(sr2.last_message_at)
            FROM session_records sr2
            WHERE sr2.user_id = pa.user_id
              AND sr2.source = pa.source
              AND sr2.project_ref = pa.project_ref
           ) AS absolute_last_active
         FROM project_aliases pa
         LEFT JOIN session_records sr
           ON sr.user_id = pa.user_id
           AND sr.source = pa.source
           AND sr.project_ref = pa.project_ref
           AND sr.started_at >= ?
           AND sr.started_at < ?
         WHERE pa.user_id = ?
         GROUP BY pa.project_id, pa.source, pa.project_ref`,
        [from, to, userId],
      );
    } else {
      aliasesResult = await dbRead.query<AliasStatsRow>(
        `SELECT
           pa.project_id,
           pa.source,
           pa.project_ref,
           COUNT(sr.id) AS session_count,
           MAX(sr.last_message_at) AS last_active,
           COALESCE(SUM(sr.total_messages), 0) AS total_messages,
           COALESCE(SUM(sr.duration_seconds), 0) AS total_duration,
           GROUP_CONCAT(DISTINCT sr.model) AS models,
           MAX(sr.last_message_at) AS absolute_last_active
         FROM project_aliases pa
         LEFT JOIN session_records sr
           ON sr.user_id = pa.user_id
           AND sr.source = pa.source
           AND sr.project_ref = pa.project_ref
         WHERE pa.user_id = ?
         GROUP BY pa.project_id, pa.source, pa.project_ref`,
        [userId],
      );
    }

    // Query 3: Unassigned refs (date conditions in WHERE — no LEFT JOIN to protect)
    let unassignedResult;
    if (hasDateRange) {
      unassignedResult = await dbRead.query<UnassignedRow>(
        `SELECT
           sr.source,
           sr.project_ref,
           COUNT(*) AS session_count,
           MAX(sr.last_message_at) AS last_active,
           COALESCE(SUM(sr.total_messages), 0) AS total_messages,
           COALESCE(SUM(sr.duration_seconds), 0) AS total_duration,
           GROUP_CONCAT(DISTINCT sr.model) AS models
         FROM session_records sr
         WHERE sr.user_id = ?
           AND sr.project_ref IS NOT NULL
           AND sr.started_at >= ?
           AND sr.started_at < ?
           AND NOT EXISTS (
             SELECT 1 FROM project_aliases pa
             WHERE pa.user_id = sr.user_id
               AND pa.source = sr.source
               AND pa.project_ref = sr.project_ref
           )
         GROUP BY sr.source, sr.project_ref
         ORDER BY last_active DESC`,
        [userId, from, to],
      );
    } else {
      unassignedResult = await dbRead.query<UnassignedRow>(
        `SELECT
           sr.source,
           sr.project_ref,
           COUNT(*) AS session_count,
           MAX(sr.last_message_at) AS last_active,
           COALESCE(SUM(sr.total_messages), 0) AS total_messages,
           COALESCE(SUM(sr.duration_seconds), 0) AS total_duration,
           GROUP_CONCAT(DISTINCT sr.model) AS models
         FROM session_records sr
         WHERE sr.user_id = ?
           AND sr.project_ref IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM project_aliases pa
             WHERE pa.user_id = sr.user_id
               AND pa.source = sr.source
               AND pa.project_ref = sr.project_ref
           )
         GROUP BY sr.source, sr.project_ref
         ORDER BY last_active DESC`,
        [userId],
      );
    }

    // Assemble: group tags by project_id
    const tagsByProject = new Map<string, string[]>();
    const tagsResult = await dbRead.query<TagRow>(
      `SELECT project_id, tag
       FROM project_tags
       WHERE user_id = ?
       ORDER BY tag`,
      [userId],
    );
    for (const row of tagsResult.results) {
      const arr = tagsByProject.get(row.project_id);
      if (arr) {
        arr.push(row.tag);
      } else {
        tagsByProject.set(row.project_id, [row.tag]);
      }
    }

    // Assemble: group aliases by project_id
    const aliasesByProject = new Map<string, AliasStatsRow[]>();
    for (const row of aliasesResult.results) {
      const arr = aliasesByProject.get(row.project_id);
      if (arr) {
        arr.push(row);
      } else {
        aliasesByProject.set(row.project_id, [row]);
      }
    }

    const projects = projectsResult.results.map((p) => {
      const aliases = aliasesByProject.get(p.id) ?? [];
      let sessionCount = 0;
      let lastActive: string | null = null;
      let absoluteLastActive: string | null = null;
      let totalMessages = 0;
      let totalDuration = 0;
      const modelSet = new Set<string>();
      for (const a of aliases) {
        sessionCount += a.session_count;
        totalMessages += a.total_messages;
        totalDuration += a.total_duration;
        if (a.models) {
          for (const m of a.models.split(",")) {
            if (m) modelSet.add(m);
          }
        }
        if (a.last_active && (!lastActive || a.last_active > lastActive)) {
          lastActive = a.last_active;
        }
        if (
          a.absolute_last_active &&
          (!absoluteLastActive ||
            a.absolute_last_active > absoluteLastActive)
        ) {
          absoluteLastActive = a.absolute_last_active;
        }
      }
      return {
        id: p.id,
        name: p.name,
        aliases: aliases.map((a) => ({
          source: a.source,
          project_ref: a.project_ref,
          session_count: a.session_count,
        })),
        tags: tagsByProject.get(p.id) ?? [],
        session_count: sessionCount,
        last_active: lastActive,
        absolute_last_active: absoluteLastActive,
        total_messages: totalMessages,
        total_duration: totalDuration,
        models: [...modelSet],
        created_at: p.created_at,
      };
    });

    return NextResponse.json({
      projects,
      unassigned: unassignedResult.results.map((r) => ({
        source: r.source,
        project_ref: r.project_ref,
        session_count: r.session_count,
        last_active: r.last_active,
        total_messages: r.total_messages,
        total_duration: r.total_duration,
        models: r.models ? r.models.split(",").filter(Boolean) : [],
      })),
    });
  } catch (err) {
    console.error("Failed to query projects:", err);
    return NextResponse.json(
      { error: "Failed to query projects" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// POST — create a new project
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  const authResult = await resolveUser(request);
  if (!authResult) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = authResult.userId;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Validate name
  const name = body.name;
  if (typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json(
      { error: "name is required and must be a non-empty string" },
      { status: 400 },
    );
  }
  if (name.length > MAX_NAME_LENGTH) {
    return NextResponse.json(
      { error: `name must be at most ${MAX_NAME_LENGTH} characters` },
      { status: 400 },
    );
  }

  // Validate aliases (optional)
  const aliases: AliasInput[] = [];
  if (body.aliases !== undefined) {
    if (!Array.isArray(body.aliases)) {
      return NextResponse.json(
        { error: "aliases must be an array" },
        { status: 400 },
      );
    }
    for (const alias of body.aliases) {
      if (
        typeof alias !== "object" ||
        alias === null ||
        typeof alias.source !== "string" ||
        typeof alias.project_ref !== "string"
      ) {
        return NextResponse.json(
          { error: "Each alias must have source and project_ref strings" },
          { status: 400 },
        );
      }
      if (!VALID_SOURCES.has(alias.source)) {
        return NextResponse.json(
          { error: `Invalid source: "${alias.source}"` },
          { status: 400 },
        );
      }
      aliases.push({ source: alias.source, project_ref: alias.project_ref });
    }
  }

  // Deduplicate aliases by (source, project_ref) key
  const seen = new Set<string>();
  const deduped: AliasInput[] = [];
  for (const alias of aliases) {
    const key = `${alias.source}:${alias.project_ref}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(alias);
    }
  }

  const dbRead = await getDbRead();
  const dbWrite = await getDbWrite();
  const trimmedName = name.trim();

  // Check reserved names
  if (RESERVED_NAMES.has(trimmedName.toLowerCase())) {
    return NextResponse.json(
      { error: `"${trimmedName}" is a reserved name and cannot be used` },
      { status: 400 },
    );
  }

  // -------------------------------------------------------------------------
  // Phase 1: Validate ALL inputs before any writes
  // -------------------------------------------------------------------------

  try {
    // Check name uniqueness
    const existing = await dbRead.firstOrNull<{ id: string }>(
      "SELECT id FROM projects WHERE user_id = ? AND name = ?",
      [userId, trimmedName],
    );
    if (existing) {
      return NextResponse.json(
        { error: "A project with this name already exists" },
        { status: 409 },
      );
    }

    // Validate aliases reference real session data
    const invalidAliases: AliasInput[] = [];
    for (const alias of deduped) {
      const exists = await dbRead.firstOrNull<{ "1": number }>(
        `SELECT 1 FROM session_records
         WHERE user_id = ? AND source = ? AND project_ref = ?
         LIMIT 1`,
        [userId, alias.source, alias.project_ref],
      );
      if (!exists) {
        invalidAliases.push(alias);
      }
    }
    if (invalidAliases.length > 0) {
      return NextResponse.json(
        {
          error: "Some aliases do not match any session data",
          invalid_aliases: invalidAliases,
        },
        { status: 400 },
      );
    }

    // Check aliases aren't already assigned to another project
    for (const alias of deduped) {
      const taken = await dbRead.firstOrNull<{ project_id: string }>(
        `SELECT project_id FROM project_aliases
         WHERE user_id = ? AND source = ? AND project_ref = ?`,
        [userId, alias.source, alias.project_ref],
      );
      if (taken) {
        return NextResponse.json(
          {
            error: `Alias (${alias.source}, ${alias.project_ref}) is already assigned to another project`,
          },
          { status: 409 },
        );
      }
    }

    // -----------------------------------------------------------------------
    // Phase 2: All validation passed — execute writes with rollback on failure
    // -----------------------------------------------------------------------

    const projectId = crypto.randomUUID();
    await dbWrite.execute(
      `INSERT INTO projects (id, user_id, name, created_at, updated_at)
       VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
      [projectId, userId, trimmedName],
    );

    try {
      for (const alias of deduped) {
        await dbWrite.execute(
          `INSERT INTO project_aliases (user_id, project_id, source, project_ref, created_at)
           VALUES (?, ?, ?, ?, datetime('now'))`,
          [userId, projectId, alias.source, alias.project_ref],
        );
      }
    } catch (aliasErr) {
      // Rollback: remove the project and any aliases that were inserted
      try {
        await dbWrite.execute(
          "DELETE FROM project_aliases WHERE project_id = ?",
          [projectId],
        );
        await dbWrite.execute("DELETE FROM projects WHERE id = ?", [projectId]);
      } catch (rollbackErr) {
        console.error("Rollback failed:", rollbackErr);
      }
      throw aliasErr;
    }

    // Query real session stats for the newly-assigned aliases
    let sessionCount = 0;
    let lastActive: string | null = null;
    let totalMessages = 0;
    let totalDuration = 0;
    const modelSet = new Set<string>();
    if (deduped.length > 0) {
      const statsResult = await dbRead.query<{
        session_count: number;
        last_active: string | null;
        total_messages: number;
        total_duration: number;
        models: string | null;
      }>(
        `SELECT
           COUNT(sr.id) AS session_count,
           MAX(sr.last_message_at) AS last_active,
           COALESCE(SUM(sr.total_messages), 0) AS total_messages,
           COALESCE(SUM(sr.duration_seconds), 0) AS total_duration,
           GROUP_CONCAT(DISTINCT sr.model) AS models
         FROM project_aliases pa
         LEFT JOIN session_records sr
           ON sr.user_id = pa.user_id
           AND sr.source = pa.source
           AND sr.project_ref = pa.project_ref
         WHERE pa.project_id = ?`,
        [projectId],
      );
      const firstRow = statsResult.results[0];
      if (firstRow) {
        sessionCount = firstRow.session_count;
        lastActive = firstRow.last_active;
        totalMessages = firstRow.total_messages;
        totalDuration = firstRow.total_duration;
        if (firstRow.models) {
          for (const m of firstRow.models.split(",")) {
            if (m) modelSet.add(m);
          }
        }
      }
    }

    // Read back server-generated created_at instead of fabricating one
    const created = await dbRead.firstOrNull<{ created_at: string }>(
      "SELECT created_at FROM projects WHERE id = ?",
      [projectId],
    );
    if (!created) {
      return NextResponse.json(
        { error: "Project not found after creation" },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        id: projectId,
        name: trimmedName,
        aliases: deduped.map((a) => ({
          source: a.source,
          project_ref: a.project_ref,
          session_count: 0, // newly created — no period stats yet
        })),
        tags: [],
        session_count: sessionCount,
        last_active: lastActive,
        absolute_last_active: lastActive, // POST is always all-time
        total_messages: totalMessages,
        total_duration: totalDuration,
        models: [...modelSet],
        created_at: created.created_at,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("Failed to create project:", err);
    return NextResponse.json(
      { error: "Failed to create project" },
      { status: 500 },
    );
  }
}
