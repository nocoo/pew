/**
 * GET /api/projects — list all projects + unassigned refs for the authenticated user.
 * POST /api/projects — create a new project with optional initial aliases.
 */

import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth-helpers";
import { getDbRead, getDbWrite } from "@/lib/db";
import type { ProjectAliasStatsRow } from "@/lib/rpc-types";

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
  "pmstudio",
  "vscode-copilot",
]);

const MAX_NAME_LENGTH = 100;
const MAX_ALIASES = 50;

/** Names reserved for internal UI/API use (case-insensitive comparison). */
const RESERVED_NAMES = new Set(["unassigned"]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
    // Query 1: Project metadata (always returns all projects)
    const projectRows = await dbRead.listProjects(userId);

    // Query 2: Aliases with per-alias session stats (via RPC)
    const aliasRows = await dbRead.listAliasesWithStats(
      userId,
      from ?? undefined,
      to ?? undefined,
    );

    // Query 3: Unassigned refs (via RPC)
    const unassignedRows = await dbRead.listUnassignedRefs(
      userId,
      from ?? undefined,
      to ?? undefined,
    );

    // Query 4: Tags
    const tagRows = await dbRead.listProjectTags(userId);

    // Assemble: group tags by project_id
    const tagsByProject = new Map<string, string[]>();
    for (const row of tagRows) {
      const arr = tagsByProject.get(row.project_id);
      if (arr) {
        arr.push(row.tag);
      } else {
        tagsByProject.set(row.project_id, [row.tag]);
      }
    }

    // Assemble: group aliases by project_id
    const aliasesByProject = new Map<string, ProjectAliasStatsRow[]>();
    for (const row of aliasRows) {
      if (!row.project_id) continue;
      const arr = aliasesByProject.get(row.project_id);
      if (arr) {
        arr.push(row);
      } else {
        aliasesByProject.set(row.project_id, [row]);
      }
    }

    const projects = projectRows.map((p) => {
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
        totalDuration += a.total_duration_seconds;
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
      unassigned: unassignedRows.map((r) => ({
        source: r.source,
        project_ref: r.project_ref,
        session_count: r.session_count,
        last_active: r.last_active,
        total_messages: r.total_messages,
        total_duration: r.total_duration_seconds,
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
    if (body.aliases.length > MAX_ALIASES) {
      return NextResponse.json(
        { error: `Maximum ${MAX_ALIASES} aliases allowed` },
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
          { error: "Invalid source parameter" },
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
      { error: "This name is reserved and cannot be used" },
      { status: 400 },
    );
  }

  // -------------------------------------------------------------------------
  // Phase 1: Validate ALL inputs before any writes
  // -------------------------------------------------------------------------

  try {
    // Check name uniqueness
    const existing = await dbRead.getProjectByName(userId, trimmedName);
    if (existing) {
      return NextResponse.json(
        { error: "A project with this name already exists" },
        { status: 409 },
      );
    }

    // Validate aliases reference real session data
    const invalidAliases: AliasInput[] = [];
    for (const alias of deduped) {
      const exists = await dbRead.sessionRecordExists(
        userId,
        alias.source,
        alias.project_ref,
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
      const taken = await dbRead.getAliasOwner(
        userId,
        alias.source,
        alias.project_ref,
      );
      if (taken) {
        return NextResponse.json(
          {
            error: "Alias is already assigned to another project",
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

    // Query real session stats for the newly-assigned aliases via RPC
    let sessionCount = 0;
    let lastActive: string | null = null;
    let totalMessages = 0;
    let totalDuration = 0;
    const modelSet = new Set<string>();
    if (deduped.length > 0) {
      const statsRows = await dbRead.getProjectAliasStats(projectId);
      for (const row of statsRows) {
        sessionCount += row.session_count;
        totalMessages += row.total_messages;
        totalDuration += row.total_duration_seconds;
        if (row.models) {
          for (const m of row.models.split(",")) {
            if (m) modelSet.add(m);
          }
        }
        if (row.last_active && (!lastActive || row.last_active > lastActive)) {
          lastActive = row.last_active;
        }
      }
    }

    // Read back server-generated created_at instead of fabricating one
    const created = await dbRead.getProjectById(userId, projectId);
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
