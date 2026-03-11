/**
 * GET /api/projects — list all projects + unassigned refs for the authenticated user.
 * POST /api/projects — create a new project with optional initial aliases.
 */

import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth-helpers";
import { getD1Client } from "@/lib/d1";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_SOURCES = new Set([
  "claude-code",
  "codex",
  "gemini-cli",
  "opencode",
  "openclaw",
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

interface AliasStatsRow {
  project_id: string;
  source: string;
  project_ref: string;
  session_count: number;
  last_active: string | null;
}

interface UnassignedRow {
  source: string;
  project_ref: string;
  session_count: number;
  last_active: string | null;
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
  const client = getD1Client();

  try {
    // Query 1: Project metadata
    const projectsResult = await client.query<ProjectRow>(
      `SELECT id, name, created_at
       FROM projects
       WHERE user_id = ?
       ORDER BY created_at DESC`,
      [userId],
    );

    // Query 2: Aliases with per-alias session stats
    const aliasesResult = await client.query<AliasStatsRow>(
      `SELECT
         pa.project_id,
         pa.source,
         pa.project_ref,
         COUNT(sr.id) AS session_count,
         MAX(sr.last_message_at) AS last_active
       FROM project_aliases pa
       LEFT JOIN session_records sr
         ON sr.user_id = pa.user_id
         AND sr.source = pa.source
         AND sr.project_ref = pa.project_ref
       WHERE pa.user_id = ?
       GROUP BY pa.project_id, pa.source, pa.project_ref`,
      [userId],
    );

    // Query 3: Unassigned refs
    const unassignedResult = await client.query<UnassignedRow>(
      `SELECT
         sr.source,
         sr.project_ref,
         COUNT(*) AS session_count,
         MAX(sr.last_message_at) AS last_active
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
      for (const a of aliases) {
        sessionCount += a.session_count;
        if (a.last_active && (!lastActive || a.last_active > lastActive)) {
          lastActive = a.last_active;
        }
      }
      return {
        id: p.id,
        name: p.name,
        aliases: aliases.map((a) => ({
          source: a.source,
          project_ref: a.project_ref,
        })),
        session_count: sessionCount,
        last_active: lastActive,
        created_at: p.created_at,
      };
    });

    return NextResponse.json({
      projects,
      unassigned: unassignedResult.results,
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

  const client = getD1Client();
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
    const existing = await client.firstOrNull<{ id: string }>(
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
      const exists = await client.firstOrNull<{ "1": number }>(
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
      const taken = await client.firstOrNull<{ project_id: string }>(
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
    await client.execute(
      `INSERT INTO projects (id, user_id, name, created_at, updated_at)
       VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
      [projectId, userId, trimmedName],
    );

    try {
      for (const alias of deduped) {
        await client.execute(
          `INSERT INTO project_aliases (user_id, project_id, source, project_ref, created_at)
           VALUES (?, ?, ?, ?, datetime('now'))`,
          [userId, projectId, alias.source, alias.project_ref],
        );
      }
    } catch (aliasErr) {
      // Rollback: remove the project and any aliases that were inserted
      try {
        await client.execute(
          "DELETE FROM project_aliases WHERE project_id = ?",
          [projectId],
        );
        await client.execute("DELETE FROM projects WHERE id = ?", [projectId]);
      } catch (rollbackErr) {
        console.error("Rollback failed:", rollbackErr);
      }
      throw aliasErr;
    }

    // Query real session stats for the newly-assigned aliases
    let sessionCount = 0;
    let lastActive: string | null = null;
    if (deduped.length > 0) {
      const statsResult = await client.query<{
        session_count: number;
        last_active: string | null;
      }>(
        `SELECT
           COUNT(sr.id) AS session_count,
           MAX(sr.last_message_at) AS last_active
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
      }
    }

    // Read back server-generated created_at instead of fabricating one
    const created = await client.firstOrNull<{ created_at: string }>(
      "SELECT created_at FROM projects WHERE id = ?",
      [projectId],
    );

    return NextResponse.json(
      {
        id: projectId,
        name: trimmedName,
        aliases: deduped.map((a) => ({
          source: a.source,
          project_ref: a.project_ref,
        })),
        session_count: sessionCount,
        last_active: lastActive,
        created_at: created!.created_at,
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
