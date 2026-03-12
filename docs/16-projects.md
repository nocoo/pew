# Projects — Two-Layer Project Management

> Dashboard feature for grouping anonymized `project_ref` values from multiple
> AI tools into user-defined **projects** with human-readable names.

## Overview

### Problem

Each AI tool generates `project_ref` differently:

| Tool | Raw Source | Hashed by | `project_ref` Format |
|------|-----------|-----------|---------------------|
| Claude Code | Path-encoded dir name in `~/.claude/projects/` | **pew** — `SHA-256(dirName)[0:12]` | `a1b2c3d4e5f6` |
| Codex | `session_meta.payload.cwd` (absolute path) | **pew** — `SHA-256(cwd)[0:12]` | `a1b2c3d4e5f6` |
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
> original `-`, `.`, and `/`), so pew hashes the directory name itself rather
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

### Scope & Phased Delivery

The two-layer model is correct but the full feature is not small. We split
delivery into two phases to keep each one shippable and testable:

**Phase 1 — Schema + Projects Page + Sessions Propagation**:

- Database schema (projects + aliases)
- API endpoints for CRUD
- Dashboard page to manage projects and assign aliases
- Label propagation in Sessions page (show project name instead of raw ref)

**Phase 2 — Session-Based Project Stats on Sessions Page**:

- Project breakdown chart on Sessions page (horizontal bar chart showing
  session counts per project, with hours and messages in tooltip)
- Project filter dropdown on Sessions page (filter all charts by project)
- Helper function `toProjectBreakdown()` to aggregate session data by project
- `?project=` query parameter on `/api/sessions` for server-side filtering

> **Why session-based?** `usage_records` has no `project_ref` column — its key
> is `(user_id, source, model, hour_start)`. Token data is pre-aggregated by
> time/source/model with no project dimension. Per-project token breakdowns
> would require a schema migration to add `project_ref` to `usage_records`.
> Session-based stats (session counts, durations, message counts) are available
> directly from `session_records` which already has `project_ref`.

**Out of scope (future work)**: Color coding, CSV export with project names,
auto-suggest grouping.

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
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, name)
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
- `projects.name` must be non-empty, max 100 chars (validated at API layer)
- **Project names are unique per user** (`UNIQUE(user_id, name)`). This
  prevents confusion in the "Assign to existing project" dropdown and keeps
  the mental model clean. Rename to resolve conflicts.
- **Aliases must reference real data**: When adding an alias, the API must
  verify that `(user_id, source, project_ref)` exists in `session_records`.
  This prevents orphan aliases that would pollute stats and the unassigned list.
- `source` must match a known AI tool source value
- Deleting a project cascades to delete its aliases
- **Empty projects are allowed**: A project with zero aliases is valid (e.g.,
  user creates a project first, assigns aliases later). However, if the last
  alias is removed, the project persists — users must explicitly delete it.
  The UI should show "(no aliases)" with a visual hint to assign refs.

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

**Implementation strategy**: The response shape requires aliases as a nested
array per project, which can't be produced by a single SQL GROUP BY. Use three
queries, assembled in application code:

**Query 1 — Project metadata**:

```sql
SELECT id, name, created_at
FROM projects
WHERE user_id = ?
ORDER BY created_at DESC
```

**Query 2 — All aliases with per-alias session stats**:

```sql
SELECT
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
GROUP BY pa.project_id, pa.source, pa.project_ref
```

**Assembly in app code**: Group Query 2 rows by `project_id`, merge into
Query 1 results. For each project, `session_count` = sum of alias counts,
`last_active` = max of alias last_active, `aliases` = array of
`{ source, project_ref }`.

**Query 3 — Unassigned refs**:

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

- `name`: required, non-empty, max 100 chars, must be unique for this user
- `aliases`: optional array. Each entry must have `source` and `project_ref`.

**Alias validation**: Each alias in the request must exist in the user's
`session_records`. The API verifies this before inserting:

```sql
SELECT 1 FROM session_records
WHERE user_id = ? AND source = ? AND project_ref = ?
LIMIT 1
```

If any alias fails validation, return `400` with the invalid entries listed.
This prevents orphan aliases that would corrupt stats.

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

- `name`: if provided, must be non-empty, max 100 chars, unique for this user
- `add_aliases`: same validation as POST — each must exist in `session_records`
- `remove_aliases`: silently ignored if the alias doesn't exist on this project

**Response**: The updated project.

### `DELETE /api/projects/:id`

Delete a project and all its aliases (CASCADE).

**Response**: `{ "success": true }`

---

## Label Propagation

### Phase 1: Sessions Page

This is a core part of the design, not a future consideration. Once a
`project_ref` is aliased to a project, the project name should appear in the
Sessions page:

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

### Phase 2: Session-Based Project Stats

Since `usage_records` has no `project_ref` column (its key is
`(user_id, source, model, hour_start)`), per-project token breakdowns are not
possible with the current schema. Instead, Phase 2 uses **session-based stats**
from `session_records`, which already carries `project_name` via the LEFT JOIN
added in Phase 1.

#### Project Breakdown Chart

A horizontal bar chart (`ProjectBreakdownChart` component) showing session
activity per project:

- **Primary metric**: Session count (bar length)
- **Tooltip**: Sessions, hours, and messages for each project
- Top 10 projects by session count
- Sessions with no project mapping are grouped as "Unassigned"

Uses `toProjectBreakdown()` helper in `session-helpers.ts` which aggregates
`SessionRow[]` by `project_name` into `ProjectBreakdownItem[]`:

```typescript
type ProjectBreakdownItem = {
  projectName: string;   // project name or "Unassigned"
  sessions: number;
  totalHours: number;
  totalMessages: number;
};
```

Sorted by session count descending, then total hours descending.

#### Project Filter

A `<select>` dropdown on the Sessions page that filters all charts by project:

- "All Projects" (default) — shows all sessions
- Named projects — filters to sessions matching that project
- "Unassigned" — filters to sessions with no project mapping

The filter works via the `?project=` query parameter on `/api/sessions`:
- `?project=my-project` — filters by project name
- `?project=_unassigned` — filters to sessions with `project_name IS NULL`

When a project filter is active, the breakdown chart is hidden (redundant).

#### `useSessionData` Hook Changes

The hook accepts an optional `project` option and returns `projectBreakdown`:

```typescript
interface UseSessionDataOptions {
  from?: string;
  to?: string;
  source?: string;
  project?: string;  // NEW — project name or "_unassigned"
}

interface UseSessionDataResult {
  records: SessionRow[];
  overview: SessionOverview;
  hoursGrid: WorkingHoursDay[];
  dailyMessages: MessageDailyStat[];
  projectBreakdown: ProjectBreakdownItem[];  // NEW
  loading: boolean;
  error: string | null;
  refetch: () => void;
}
```

The Sessions page uses two hook instances: one unfiltered (for the breakdown
chart and dropdown options) and one filtered (for the stat cards and charts
when a project is selected).

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

| File | Action | Phase | Description |
|------|--------|-------|-------------|
| `scripts/migrations/005-projects.sql` | Create | 1 | D1 migration (projects + project_aliases) |
| `packages/web/src/lib/navigation.ts` | Edit | 1 | Add Projects nav item |
| `packages/web/src/components/layout/sidebar.tsx` | Edit | 1 | Add FolderKanban icon |
| `packages/web/src/app/api/projects/route.ts` | Create | 1 | GET + POST (collection) |
| `packages/web/src/app/api/projects/[id]/route.ts` | Create | 1 | PATCH + DELETE (single project) |
| `packages/web/src/app/(dashboard)/projects/page.tsx` | Create | 1 | Projects management page |
| `packages/web/src/hooks/use-projects.ts` | Create | 1 | Hook for project data with CRUD mutations |
| `packages/web/src/app/api/sessions/route.ts` | Edit | 1 | JOIN project_aliases for project_name + `?project=` filter |
| `packages/web/src/lib/session-helpers.ts` | Edit | 2 | Add `toProjectBreakdown()` + `ProjectBreakdownItem` type |
| `packages/web/src/hooks/use-session-data.ts` | Edit | 2 | Add `project` option + `projectBreakdown` return value |
| `packages/web/src/components/dashboard/project-breakdown-chart.tsx` | Create | 2 | Horizontal bar chart for project session stats |
| `packages/web/src/app/(dashboard)/sessions/page.tsx` | Edit | 2 | Add project filter dropdown + ProjectBreakdownChart |

---

## Implementation Order

### Phase 1

1. **Migration** — Create and apply `005-projects.sql`
2. **API (collection)** — `GET /api/projects` + `POST /api/projects`
3. **API (single)** — `PATCH /api/projects/:id` + `DELETE /api/projects/:id`
4. **Navigation** — Add sidebar entry
5. **Page** — Build projects page with two sections
6. **Assign flow** — Dropdown to assign unassigned refs to projects
7. **Sessions propagation** — Update Sessions page to show project names
8. **Polish** — Empty states, loading states, error handling

### Phase 2

9. **Session helpers** — Add `toProjectBreakdown()` aggregation function + tests
10. **Sessions API** — Add `?project=` filter support + tests
11. **Hook** — Add `project` option + `projectBreakdown` to `useSessionData`
12. **Chart** — Create `ProjectBreakdownChart` component
13. **Sessions page** — Add project filter dropdown + breakdown chart
14. **Spec** — Update this document for Phase 2

---

## Future Considerations

- **Color coding**: Assign colors to projects for visual distinction
- **Auto-suggest grouping**: If two refs from different sources have similar
  session patterns (same time ranges, overlapping models), suggest grouping
- **Export**: Include project names in CSV exports
