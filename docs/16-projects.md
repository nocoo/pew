# Projects — Two-Layer Project Management

> Dashboard feature for grouping anonymized `project_ref` values from multiple
> AI tools into user-defined **projects** with human-readable names.

## Overview

### Problem

Each AI tool generates `project_ref` differently:

| Tool | Raw Source | Hashed by | `project_ref` Format |
|------|-----------|-----------|---------------------|
| Claude Code | Path-encoded dir name in `~/.claude/projects/` | **Pew** — `SHA-256(dirName)[0:12]` | `a1b2c3d4e5f6` |
| Codex | `session_meta.payload.cwd` (absolute path) | **Pew** — `SHA-256(cwd)[0:12]` | `a1b2c3d4e5f6` |
| Gemini CLI | `projectHash` field in session JSON | **Gemini CLI** (pre-hashed) | opaque string |
| OpenCode (SQLite) | `session.project_id` column (SHA-1) | **OpenCode** (pre-hashed) | 40-char hex |
| OpenCode (JSON) | None — legacy data before 2026-02-15 | N/A | `null` |
| OpenClaw | Agent name from `~/.openclaw/agents/{name}/` | None — stored as-is | `my-agent` |

These raw values are meaningless to users. Worse, a user working on the same
directory across Claude Code and Codex will see **different** `project_ref`
values because the hashing inputs differ (encoded dir name vs. absolute path).

> **Note on Claude Code encoding**: Claude stores projects under directory
> names like `-Users-nocoo-workspace-personal-pew` (path with `/` and `.`
> replaced by `-`). This encoding is **not reversible** (cannot distinguish
> original `-`, `.`, and `/`), so Pew hashes the directory name itself rather
> than attempting to reconstruct the absolute path. This means Claude Code and
> Codex working on the same directory will produce **different** `project_ref`
> values — users can group them into a single project via the alias system.

### Solution: Two-Layer Model

Instead of a flat label-per-ref approach, we introduce two entities:

1. **Projects** (`projects` table) — User-defined logical groupings with a
   human-readable name. A project is a first-class entity.
2. **Project Aliases** (`project_aliases` table) — Mappings from
   `(user_id, source, project_ref)` to a `project_id`. This is how individual
   refs from different tools get grouped under one project.

This design enables:

- **Cross-tool grouping**: Claude `a1b2c3d4e5f6` + Codex `f6e5d4c3b2a1` → both
  map to the "pew" project.
- **Safe uniqueness**: The alias key is `(user_id, source, project_ref)`, not
  just `(user_id, project_ref)`, because different sources can theoretically
  produce the same hash with different meanings.
- **Label propagation**: Once a ref is aliased to a project, the project name
  appears everywhere — Sessions page, usage breakdowns, etc.

### Scope

- **In scope**:
  - Database schema (projects + aliases)
  - API endpoints for CRUD
  - Dashboard page to manage projects and assign aliases
  - **Label propagation**: Show project names in Sessions page, usage breakdown,
    and anywhere `project_ref` currently appears
- **Out of scope**: Color coding, CSV export with project names (future work)

---

## Database Schema

### Migration: `005-projects.sql`

```sql
-- User-defined logical projects
CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,  -- nanoid or CUID
  user_id    TEXT NOT NULL REFERENCES users(id),
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_user
  ON projects(user_id);

-- Map (user_id, source, project_ref) → project
CREATE TABLE IF NOT EXISTS project_aliases (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id),
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source      TEXT NOT NULL,
  project_ref TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, source, project_ref)
);

CREATE INDEX IF NOT EXISTS idx_project_aliases_project
  ON project_aliases(project_id);

CREATE INDEX IF NOT EXISTS idx_project_aliases_lookup
  ON project_aliases(user_id, source, project_ref);
```

### Constraints

- Each `(user_id, source, project_ref)` can belong to at most one project
- `projects.name` must be non-empty (validated at API layer)
- `source` must match a known AI tool source value
- Deleting a project cascades to delete its aliases

---

## API Design

### `GET /api/projects`

Returns all projects for the authenticated user, with aggregated stats from
their aliased sessions.

**Response**:

```json
{
  "projects": [
    {
      "id": "proj_abc123",
      "name": "pew",
      "aliases": [
        { "source": "claude-code", "project_ref": "a1b2c3d4e5f6" },
        { "source": "codex", "project_ref": "f6e5d4c3b2a1" }
      ],
      "session_count": 47,
      "last_active": "2026-03-10T08:00:00Z",
      "created_at": "2026-03-01T12:00:00Z"
    }
  ],
  "unassigned": [
    {
      "source": "gemini-cli",
      "project_ref": "xyz789opaque",
      "session_count": 5,
      "last_active": "2026-03-09T12:00:00Z"
    }
  ]
}
```

The response has two sections:

- `projects`: All user-defined projects with their aliases and aggregated stats
- `unassigned`: All `(source, project_ref)` pairs that haven't been assigned to
  any project yet — these are the refs the user needs to organize

**SQL for projects**:

```sql
SELECT
  p.id,
  p.name,
  p.created_at,
  pa.source,
  pa.project_ref,
  COUNT(sr.id) AS session_count,
  MAX(sr.last_message_at) AS last_active
FROM projects p
LEFT JOIN project_aliases pa ON pa.project_id = p.id
LEFT JOIN session_records sr
  ON sr.user_id = p.user_id
  AND sr.source = pa.source
  AND sr.project_ref = pa.project_ref
WHERE p.user_id = ?
GROUP BY p.id, pa.source, pa.project_ref
ORDER BY last_active DESC
```

**SQL for unassigned**:

```sql
SELECT
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
ORDER BY last_active DESC
```

### `POST /api/projects`

Create a new project, optionally with initial aliases.

**Request Body**:

```json
{
  "name": "pew",
  "aliases": [
    { "source": "claude-code", "project_ref": "a1b2c3d4e5f6" },
    { "source": "codex", "project_ref": "f6e5d4c3b2a1" }
  ]
}
```

- `name`: required, non-empty, max 100 chars
- `aliases`: optional array. Each entry must have `source` and `project_ref`.

**Response**: The created project (same shape as items in GET response).

### `PATCH /api/projects/:id`

Update a project's name or modify its aliases.

**Request Body**:

```json
{
  "name": "pew-monorepo",
  "add_aliases": [
    { "source": "gemini-cli", "project_ref": "xyz789opaque" }
  ],
  "remove_aliases": [
    { "source": "codex", "project_ref": "f6e5d4c3b2a1" }
  ]
}
```

All fields are optional. Only provided fields are updated.

**Response**: The updated project.

### `DELETE /api/projects/:id`

Delete a project and all its aliases (CASCADE).

**Response**: `{ "success": true }`

---

## Label Propagation

This is a core part of the design, not a future consideration. Once a
`project_ref` is aliased to a project, the project name should appear:

### Sessions Page

The Sessions table already shows `project_ref`. With projects:

- If the session's `(source, project_ref)` maps to a project → show **project name**
- If unmapped → show raw `project_ref` (truncated, monospace)
- If `project_ref` is null → show "—"

**SQL join for sessions with project names**:

```sql
SELECT
  sr.*,
  p.name AS project_name
FROM session_records sr
LEFT JOIN project_aliases pa
  ON pa.user_id = sr.user_id
  AND pa.source = sr.source
  AND pa.project_ref = sr.project_ref
LEFT JOIN projects p ON p.id = pa.project_id
WHERE sr.user_id = ?
ORDER BY sr.last_message_at DESC
```

### Usage Breakdown

When showing usage stats grouped by project:

- Sessions with aliased refs → grouped under their project name
- Sessions with unaliased refs → grouped under truncated `project_ref`
- Sessions with null refs → grouped under "Unknown Project"

---

## Frontend Design

### Navigation

Add "Projects" to the Settings group in sidebar.

**File**: `packages/web/src/lib/navigation.ts`

```typescript
// In BASE_NAV_GROUPS, Settings group
{ href: "/projects", label: "Projects", icon: "FolderKanban" },
```

**File**: `packages/web/src/components/layout/sidebar.tsx`

Add `FolderKanban` to `ICON_MAP`.

### Page: `(dashboard)/projects/page.tsx`

**Layout**: Match existing settings page pattern

- `"use client"` directive
- `<div className="max-w-3xl space-y-8">` wrapper
- Header with `<h1>` + `<p>` subtitle

**Two sections**:

#### 1. Your Projects

A list/card view of user-defined projects:

| Element | Content |
|---------|---------|
| Project Name | Editable inline |
| Aliases | Chips showing `source: project_ref` (truncated) |
| Sessions | Aggregated count across all aliases |
| Last Active | Most recent session across all aliases |
| Actions | Add alias, remove alias, delete project |

#### 2. Unassigned References

A table of `(source, project_ref)` pairs not yet assigned to any project:

| Column | Content | Interaction |
|--------|---------|-------------|
| Source | Tool name (e.g., "claude-code") | Read-only |
| Project Ref | Raw value (truncated, monospace) | Read-only |
| Sessions | Count | Read-only |
| Last Active | Relative time | Read-only |
| Action | "Assign" button | Opens modal/dropdown to pick or create project |

**Assign Flow**:

1. User clicks "Assign" on an unassigned ref
2. Dropdown shows existing projects + "Create new project" option
3. Selecting an existing project → PATCH to add alias
4. "Create new project" → inline input for name, then POST

**Empty State**:

- If no unassigned refs and no projects: "No projects found. Sync your AI
  tools to see project data."
- If no projects but unassigned refs exist: "You have {n} unassigned project
  references. Create a project to organize them."

---

## File Changes Checklist

| File | Action | Description |
|------|--------|-------------|
| `scripts/migrations/005-projects.sql` | Create | D1 migration (projects + project_aliases) |
| `packages/web/src/lib/navigation.ts` | Edit | Add Projects nav item |
| `packages/web/src/components/layout/sidebar.tsx` | Edit | Add FolderKanban icon |
| `packages/web/src/app/api/projects/route.ts` | Create | GET + POST (collection) |
| `packages/web/src/app/api/projects/[id]/route.ts` | Create | PATCH + DELETE (single project) |
| `packages/web/src/app/(dashboard)/projects/page.tsx` | Create | Projects management page |
| `packages/web/src/hooks/use-projects.ts` | Create | SWR hook for project data |
| Sessions page + usage breakdown | Edit | Join with project_aliases for label propagation |

---

## Implementation Order

1. **Migration** — Create and apply `005-projects.sql`
2. **API (collection)** — `GET /api/projects` + `POST /api/projects`
3. **API (single)** — `PATCH /api/projects/:id` + `DELETE /api/projects/:id`
4. **Navigation** — Add sidebar entry
5. **Page** — Build projects page with two sections
6. **Assign flow** — Dropdown to assign unassigned refs to projects
7. **Label propagation** — Update Sessions page + usage breakdown to show project names
8. **Polish** — Empty states, loading states, error handling

---

## Future Considerations

- **Color coding**: Assign colors to projects for visual distinction
- **Auto-suggest grouping**: If two refs from different sources have similar
  session patterns (same time ranges, overlapping models), suggest grouping
- **Export**: Include project names in CSV exports
