/**
 * PATCH /api/projects/:id — update project name and/or modify aliases.
 * DELETE /api/projects/:id — delete a project and all its aliases.
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

interface AliasInput {
  source: string;
  project_ref: string;
}

interface AliasStatsRow {
  source: string;
  project_ref: string;
  session_count: number;
  last_active: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateAliases(
  aliases: unknown,
  fieldName: string,
): { valid: AliasInput[]; error?: string } {
  if (!Array.isArray(aliases)) {
    return { valid: [], error: `${fieldName} must be an array` };
  }
  const result: AliasInput[] = [];
  for (const alias of aliases) {
    if (
      typeof alias !== "object" ||
      alias === null ||
      typeof alias.source !== "string" ||
      typeof alias.project_ref !== "string"
    ) {
      return {
        valid: [],
        error: `Each entry in ${fieldName} must have source and project_ref strings`,
      };
    }
    if (!VALID_SOURCES.has(alias.source)) {
      return { valid: [], error: `Invalid source: "${alias.source}"` };
    }
    result.push({ source: alias.source, project_ref: alias.project_ref });
  }
  return { valid: result };
}

// ---------------------------------------------------------------------------
// PATCH — update project
// ---------------------------------------------------------------------------

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await resolveUser(request);
  if (!authResult) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = authResult.userId;
  const { id: projectId } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const client = getD1Client();

  // Verify project exists and belongs to user
  const project = await client.firstOrNull<{ id: string; name: string }>(
    "SELECT id, name FROM projects WHERE id = ? AND user_id = ?",
    [projectId, userId],
  );
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // -----------------------------------------------------------------------
  // Phase 1: Validate ALL inputs before any writes
  // -----------------------------------------------------------------------

  let trimmedName: string | undefined;
  let addAliases: AliasInput[] = [];
  let removeAliases: AliasInput[] = [];

  // Validate name
  if ("name" in body) {
    const name = body.name;
    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json(
        { error: "name must be a non-empty string" },
        { status: 400 },
      );
    }
    if (name.length > MAX_NAME_LENGTH) {
      return NextResponse.json(
        { error: `name must be at most ${MAX_NAME_LENGTH} characters` },
        { status: 400 },
      );
    }
    trimmedName = name.trim();

    // Check reserved names
    if (RESERVED_NAMES.has(trimmedName.toLowerCase())) {
      return NextResponse.json(
        { error: `"${trimmedName}" is a reserved name and cannot be used` },
        { status: 400 },
      );
    }

    const existing = await client.firstOrNull<{ id: string }>(
      "SELECT id FROM projects WHERE user_id = ? AND name = ? AND id != ?",
      [userId, trimmedName, projectId],
    );
    if (existing) {
      return NextResponse.json(
        { error: "A project with this name already exists" },
        { status: 409 },
      );
    }
  }

  // Validate add_aliases
  if ("add_aliases" in body) {
    const { valid, error } = validateAliases(body.add_aliases, "add_aliases");
    if (error) {
      return NextResponse.json({ error }, { status: 400 });
    }

    const invalidAliases: AliasInput[] = [];
    for (const alias of valid) {
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

    const trulyNewAliases: AliasInput[] = [];
    for (const alias of valid) {
      const taken = await client.firstOrNull<{ project_id: string }>(
        `SELECT project_id FROM project_aliases
         WHERE user_id = ? AND source = ? AND project_ref = ?`,
        [userId, alias.source, alias.project_ref],
      );
      if (taken && taken.project_id !== projectId) {
        return NextResponse.json(
          {
            error: `Alias (${alias.source}, ${alias.project_ref}) is already assigned to another project`,
          },
          { status: 409 },
        );
      }
      // Only mark as "new" if not already attached to this project.
      // Pre-existing aliases are silently accepted but excluded from
      // the write set and rollback tracking to avoid data loss.
      if (!taken) {
        trulyNewAliases.push(alias);
      }
    }
    addAliases = trulyNewAliases;
  }

  // Validate remove_aliases
  if ("remove_aliases" in body) {
    const { valid, error } = validateAliases(
      body.remove_aliases,
      "remove_aliases",
    );
    if (error) {
      return NextResponse.json({ error }, { status: 400 });
    }

    // Verify each alias is actually attached to this project
    const notFound: AliasInput[] = [];
    for (const alias of valid) {
      const attached = await client.firstOrNull<{ project_id: string }>(
        `SELECT project_id FROM project_aliases
         WHERE user_id = ? AND project_id = ? AND source = ? AND project_ref = ?`,
        [userId, projectId, alias.source, alias.project_ref],
      );
      if (!attached) {
        notFound.push(alias);
      }
    }
    if (notFound.length > 0) {
      return NextResponse.json(
        {
          error: "Some aliases are not attached to this project",
          not_found_aliases: notFound,
        },
        { status: 400 },
      );
    }

    removeAliases = valid;
  }

  // -----------------------------------------------------------------------
  // Phase 2: All validation passed — execute writes with rollback on failure
  // -----------------------------------------------------------------------

  const originalName = project.name;
  let nameWritten = false;
  const aliasesAdded: AliasInput[] = [];
  const aliasesRemoved: AliasInput[] = [];

  try {
    if (trimmedName !== undefined) {
      await client.execute(
        "UPDATE projects SET name = ?, updated_at = datetime('now') WHERE id = ?",
        [trimmedName, projectId],
      );
      nameWritten = true;
    }

    for (const alias of addAliases) {
      await client.execute(
        `INSERT INTO project_aliases (user_id, project_id, source, project_ref, created_at)
         VALUES (?, ?, ?, ?, datetime('now'))`,
        [userId, projectId, alias.source, alias.project_ref],
      );
      aliasesAdded.push(alias);
    }

    for (const alias of removeAliases) {
      await client.execute(
        `DELETE FROM project_aliases
         WHERE user_id = ? AND project_id = ? AND source = ? AND project_ref = ?`,
        [userId, projectId, alias.source, alias.project_ref],
      );
      aliasesRemoved.push(alias);
    }

    if (trimmedName !== undefined || addAliases.length > 0 || removeAliases.length > 0) {
      await client.execute(
        "UPDATE projects SET updated_at = datetime('now') WHERE id = ?",
        [projectId],
      );
    }

    // Return updated project
    const updated = await client.firstOrNull<{
      id: string;
      name: string;
      created_at: string;
    }>(
      "SELECT id, name, created_at FROM projects WHERE id = ?",
      [projectId],
    );

    const aliasRows = await client.query<AliasStatsRow>(
      `SELECT
         pa.source,
         pa.project_ref,
         COUNT(sr.id) AS session_count,
         MAX(sr.last_message_at) AS last_active
       FROM project_aliases pa
       LEFT JOIN session_records sr
         ON sr.user_id = pa.user_id
         AND sr.source = pa.source
         AND sr.project_ref = pa.project_ref
       WHERE pa.project_id = ?
       GROUP BY pa.source, pa.project_ref`,
      [projectId],
    );

    let sessionCount = 0;
    let lastActive: string | null = null;
    for (const a of aliasRows.results) {
      sessionCount += a.session_count;
      if (a.last_active && (!lastActive || a.last_active > lastActive)) {
        lastActive = a.last_active;
      }
    }

    return NextResponse.json({
      id: updated!.id,
      name: updated!.name,
      aliases: aliasRows.results.map((a) => ({
        source: a.source,
        project_ref: a.project_ref,
      })),
      session_count: sessionCount,
      last_active: lastActive,
      created_at: updated!.created_at,
    });
  } catch (err) {
    // Best-effort rollback: undo any writes that succeeded before the failure
    try {
      if (nameWritten) {
        await client.execute(
          "UPDATE projects SET name = ? WHERE id = ?",
          [originalName, projectId],
        );
      }
      for (const alias of aliasesAdded) {
        await client.execute(
          `DELETE FROM project_aliases
           WHERE user_id = ? AND project_id = ? AND source = ? AND project_ref = ?`,
          [userId, projectId, alias.source, alias.project_ref],
        );
      }
      for (const alias of aliasesRemoved) {
        await client.execute(
          `INSERT OR IGNORE INTO project_aliases (user_id, project_id, source, project_ref, created_at)
           VALUES (?, ?, ?, ?, datetime('now'))`,
          [userId, projectId, alias.source, alias.project_ref],
        );
      }
    } catch (rollbackErr) {
      console.error("Rollback failed:", rollbackErr);
    }
    console.error("Failed to update project:", err);
    return NextResponse.json(
      { error: "Failed to update project" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE — delete project (cascades to aliases)
// ---------------------------------------------------------------------------

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await resolveUser(request);
  if (!authResult) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = authResult.userId;
  const { id: projectId } = await params;

  const client = getD1Client();

  // Verify project exists and belongs to user
  const project = await client.firstOrNull<{ id: string }>(
    "SELECT id FROM projects WHERE id = ? AND user_id = ?",
    [projectId, userId],
  );
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  try {
    // D1/SQLite may not enforce ON DELETE CASCADE via REST API, so delete explicitly
    await client.execute(
      "DELETE FROM project_aliases WHERE project_id = ?",
      [projectId],
    );
    await client.execute("DELETE FROM projects WHERE id = ?", [projectId]);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Failed to delete project:", err);
    return NextResponse.json(
      { error: "Failed to delete project" },
      { status: 500 },
    );
  }
}
