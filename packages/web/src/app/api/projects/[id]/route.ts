/**
 * PATCH /api/projects/:id — update project name and/or modify aliases.
 * DELETE /api/projects/:id — delete a project and all its aliases.
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
  "pmstudio",
  "vscode-copilot",
]);

const MAX_NAME_LENGTH = 100;
const MAX_ALIASES = 50;
const MAX_TAGS = 50;

/** Tag format: lowercase alphanumeric + hyphens, 1-30 chars. */
const TAG_REGEX = /^[a-z0-9-]{1,30}$/;

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
  total_messages: number;
  total_duration: number;
  models: string | null;
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

  const dbRead = await getDbRead();
  const dbWrite = await getDbWrite();

  // Verify project exists and belongs to user
  const project = await dbRead.getProjectById(userId, projectId);
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

    const existing = await dbRead.getProjectByNameExcluding(
      userId,
      trimmedName,
      projectId,
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
    if (valid.length > MAX_ALIASES) {
      return NextResponse.json(
        { error: `Maximum ${MAX_ALIASES} aliases allowed per request` },
        { status: 400 },
      );
    }

    // Deduplicate by (source, project_ref) key
    const seen = new Set<string>();
    const deduped: AliasInput[] = [];
    for (const alias of valid) {
      const key = `${alias.source}:${alias.project_ref}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(alias);
      }
    }

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

    const trulyNewAliases: AliasInput[] = [];
    for (const alias of deduped) {
      const taken = await dbRead.getAliasOwner(
        userId,
        alias.source,
        alias.project_ref,
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
    if (valid.length > MAX_ALIASES) {
      return NextResponse.json(
        { error: `Maximum ${MAX_ALIASES} aliases allowed per request` },
        { status: 400 },
      );
    }

    // Verify each alias is actually attached to this project
    const notFound: AliasInput[] = [];
    for (const alias of valid) {
      const attached = await dbRead.aliasAttachedToProject(
        userId,
        projectId,
        alias.source,
        alias.project_ref,
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

  // Validate add_tags
  let addTags: string[] = [];
  if ("add_tags" in body) {
    if (!Array.isArray(body.add_tags)) {
      return NextResponse.json(
        { error: "add_tags must be an array" },
        { status: 400 },
      );
    }
    if (body.add_tags.length > MAX_TAGS) {
      return NextResponse.json(
        { error: `Maximum ${MAX_TAGS} tags allowed per request` },
        { status: 400 },
      );
    }
    for (const tag of body.add_tags) {
      if (typeof tag !== "string") {
        return NextResponse.json(
          { error: "Each tag must be a string" },
          { status: 400 },
        );
      }
      const normalized = tag.toLowerCase();
      if (!TAG_REGEX.test(normalized)) {
        return NextResponse.json(
          {
            error: `Invalid tag "${tag}": must be 1-30 chars, lowercase alphanumeric + hyphens`,
          },
          { status: 400 },
        );
      }
    }
    addTags = [...new Set(body.add_tags.map((t: string) => t.toLowerCase()))];
  }

  // Validate remove_tags
  let removeTags: string[] = [];
  if ("remove_tags" in body) {
    if (!Array.isArray(body.remove_tags)) {
      return NextResponse.json(
        { error: "remove_tags must be an array" },
        { status: 400 },
      );
    }
    if (body.remove_tags.length > MAX_TAGS) {
      return NextResponse.json(
        { error: `Maximum ${MAX_TAGS} tags allowed per request` },
        { status: 400 },
      );
    }
    for (const tag of body.remove_tags) {
      if (typeof tag !== "string") {
        return NextResponse.json(
          { error: "Each tag must be a string" },
          { status: 400 },
        );
      }
    }
    removeTags = [...new Set(body.remove_tags.map((t: string) => t.toLowerCase()))];
  }

  // -----------------------------------------------------------------------
  // Phase 2: All validation passed — execute writes with rollback on failure
  // -----------------------------------------------------------------------

  const originalName = project.name;
  let nameWritten = false;
  const aliasesAdded: AliasInput[] = [];
  const aliasesRemoved: AliasInput[] = [];
  const tagsAdded: string[] = [];
  const tagsRemoved: string[] = [];

  try {
    if (trimmedName !== undefined) {
      await dbWrite.execute(
        "UPDATE projects SET name = ?, updated_at = datetime('now') WHERE id = ?",
        [trimmedName, projectId],
      );
      nameWritten = true;
    }

    for (const alias of addAliases) {
      await dbWrite.execute(
        `INSERT INTO project_aliases (user_id, project_id, source, project_ref, created_at)
         VALUES (?, ?, ?, ?, datetime('now'))`,
        [userId, projectId, alias.source, alias.project_ref],
      );
      aliasesAdded.push(alias);
    }

    for (const alias of removeAliases) {
      await dbWrite.execute(
        `DELETE FROM project_aliases
         WHERE user_id = ? AND project_id = ? AND source = ? AND project_ref = ?`,
        [userId, projectId, alias.source, alias.project_ref],
      );
      aliasesRemoved.push(alias);
    }

    // Tag mutations — only track tags that actually changed so rollback
    // doesn't corrupt pre-existing state (e.g. deleting an already-present
    // tag or inserting a tag that never existed).
    for (const tag of addTags) {
      const existing = await dbRead.projectTagExists(userId, projectId, tag);
      if (!existing) {
        await dbWrite.execute(
          `INSERT INTO project_tags (user_id, project_id, tag, created_at)
           VALUES (?, ?, ?, datetime('now'))`,
          [userId, projectId, tag],
        );
        tagsAdded.push(tag);
      }
    }
    for (const tag of removeTags) {
      const existing = await dbRead.projectTagExists(userId, projectId, tag);
      if (existing) {
        await dbWrite.execute(
          `DELETE FROM project_tags
           WHERE user_id = ? AND project_id = ? AND tag = ?`,
          [userId, projectId, tag],
        );
        tagsRemoved.push(tag);
      }
    }

    if (trimmedName !== undefined || addAliases.length > 0 || removeAliases.length > 0 || addTags.length > 0 || removeTags.length > 0) {
      await dbWrite.execute(
        "UPDATE projects SET updated_at = datetime('now') WHERE id = ?",
        [projectId],
      );
    }

    // Return updated project
    const updated = await dbRead.getProjectById(userId, projectId);
    if (!updated) {
      return NextResponse.json(
        { error: "Project not found after update" },
        { status: 404 },
      );
    }

    const aliasRows = await dbRead.query<AliasStatsRow>(
      `SELECT
         pa.source,
         pa.project_ref,
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
       WHERE pa.project_id = ?
       GROUP BY pa.source, pa.project_ref`,
      [projectId],
    );

    let sessionCount = 0;
    let lastActive: string | null = null;
    let totalMessages = 0;
    let totalDuration = 0;
    const modelSet = new Set<string>();
    for (const a of aliasRows.results) {
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
    }

    // Fetch current tags
    const tags = await dbRead.getProjectTagList(userId, projectId);

    return NextResponse.json({
      id: updated.id,
      name: updated.name,
      aliases: aliasRows.results.map((a) => ({
        source: a.source,
        project_ref: a.project_ref,
        session_count: a.session_count,
      })),
      tags,
      session_count: sessionCount,
      last_active: lastActive,
      absolute_last_active: lastActive, // PATCH is always all-time, so identical
      total_messages: totalMessages,
      total_duration: totalDuration,
      models: [...modelSet],
      created_at: updated.created_at,
    });
  } catch (err) {
    // Best-effort rollback: undo any writes that succeeded before the failure
    try {
      if (nameWritten) {
        await dbWrite.execute(
          "UPDATE projects SET name = ? WHERE id = ?",
          [originalName, projectId],
        );
      }
      for (const alias of aliasesAdded) {
        await dbWrite.execute(
          `DELETE FROM project_aliases
           WHERE user_id = ? AND project_id = ? AND source = ? AND project_ref = ?`,
          [userId, projectId, alias.source, alias.project_ref],
        );
      }
      for (const alias of aliasesRemoved) {
        await dbWrite.execute(
          `INSERT OR IGNORE INTO project_aliases (user_id, project_id, source, project_ref, created_at)
           VALUES (?, ?, ?, ?, datetime('now'))`,
          [userId, projectId, alias.source, alias.project_ref],
        );
      }
      // Undo tag mutations
      for (const tag of tagsAdded) {
        await dbWrite.execute(
          `DELETE FROM project_tags
           WHERE user_id = ? AND project_id = ? AND tag = ?`,
          [userId, projectId, tag],
        );
      }
      for (const tag of tagsRemoved) {
        await dbWrite.execute(
          `INSERT OR IGNORE INTO project_tags (user_id, project_id, tag, created_at)
           VALUES (?, ?, ?, datetime('now'))`,
          [userId, projectId, tag],
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

  const dbRead = await getDbRead();
  const dbWrite = await getDbWrite();

  // Verify project exists and belongs to user
  const exists = await dbRead.projectExistsForUser(userId, projectId);
  if (!exists) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  try {
    // D1/SQLite may not enforce ON DELETE CASCADE via REST API, so delete explicitly
    await dbWrite.execute(
      "DELETE FROM project_tags WHERE project_id = ?",
      [projectId],
    );
    await dbWrite.execute(
      "DELETE FROM project_aliases WHERE project_id = ?",
      [projectId],
    );
    await dbWrite.execute("DELETE FROM projects WHERE id = ?", [projectId]);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Failed to delete project:", err);
    return NextResponse.json(
      { error: "Failed to delete project" },
      { status: 500 },
    );
  }
}
