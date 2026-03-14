# By Project — Analytics Page

> A dedicated analytics page for project-focused session metrics, with
> tagging support and removal of the project filter from the Sessions page.

## Overview

### Problem

Project data currently lives in two disconnected places:

1. **Sessions page** — A project filter dropdown + `ProjectBreakdownChart`
   embedded among session-centric charts. The breakdown is secondary and easy
   to miss. Users who want to compare projects must toggle the filter, losing
   the overall view.
2. **Projects management page** (`/projects`, Settings) — CRUD for creating
   projects and assigning aliases. No analytics, no trends, no comparisons.

There is no page where a user can see **all projects at a glance** with their
session counts, durations, messages, active tools, and relative activity — the
way `/agents`, `/models`, and `/devices` each provide a dedicated breakdown
for their respective dimension.

Additionally, users have no way to **tag or label** projects (e.g., "work",
"personal", "open-source") for quick categorization.

### Solution

1. **New page: `/by-project`** in the Analytics sidebar group — a dedicated
   analytics view modeled after `/devices` (stat grid + charts + summary table).
2. **Tags on projects** — A lightweight labeling system (`project_tags` table)
   that lets users quickly mark projects for filtering.
3. **Remove project filter from Sessions page** — The dropdown and conditional
   `ProjectBreakdownChart` on `/sessions` are replaced by the new page.

### Data Constraints

> **Projects are session-layer only.** `usage_records` has no `project_ref`
> column — its key is `(user_id, device_id, source, model, hour_start)`. Token
> data cannot be broken down by project. Only session-based metrics (session
> count, duration, messages) are available. See doc 16 for rationale.

This means the By Project page works exclusively with `session_records` data
joined through `project_aliases` → `projects`. No token/cost columns.

---

## 1. Database Schema: Project Tags

### Migration: `008-project-tags.sql`

```sql
-- Lightweight labels for projects
CREATE TABLE IF NOT EXISTS project_tags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL REFERENCES users(id),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tag        TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, project_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_project_tags_project
  ON project_tags(project_id);

CREATE INDEX IF NOT EXISTS idx_project_tags_user_tag
  ON project_tags(user_id, tag);
```

**Constraints:**

- `tag`: non-empty, max 30 chars, lowercased at API layer, alphanumeric + hyphens only
- A project can have multiple tags; a tag can span multiple projects
- Deleting a project cascades to its tags
- No separate "tag registry" table — tags are created implicitly on first use
  and disappear when all references are removed

### Consolidated schema addition

Add the `project_tags` table to `scripts/migrations/001-init.sql` after the
`project_aliases` index (line ~200).

---

## 2. API Changes

### 2.1. `GET /api/projects` — Add tags to response

Extend the existing response to include `tags: string[]` on each project.

**Additional query:**

```sql
SELECT project_id, tag
FROM project_tags
WHERE user_id = ?
ORDER BY tag
```

Assembled in app code: group by `project_id`, attach as `tags: string[]` array
to each project in the response.

**Updated Project shape:**

```typescript
interface Project {
  id: string;
  name: string;
  aliases: ProjectAlias[];
  tags: string[];              // NEW
  session_count: number;
  last_active: string | null;           // period-scoped when from/to active
  absolute_last_active: string | null;  // NEW — always all-time, never period-scoped
  total_messages: number;
  total_duration: number;
  models: string[];
  created_at: string;
}
```

> **Why `absolute_last_active`?** The stat grid's "Active (7d)" card must
> compare against wall-clock `now - 7d` regardless of the selected period
> (section 4.4). But `last_active` is period-scoped when `from`/`to` are
> provided (section 5). Returning a separate all-time field avoids a second
> API call. The field is populated from an unconditional `MAX(sr.last_message_at)`
> in Query 2 — a second aggregate without the date filter in the JOIN ON:
>
> ```sql
> MAX(sr.last_message_at) AS last_active,                    -- period-scoped
> MAX(sr_all.last_message_at) AS absolute_last_active        -- all-time
> ```
>
> When no `from`/`to` is provided, both fields are identical.

**Updated ProjectAlias shape:**

```typescript
interface ProjectAlias {
  source: string;
  project_ref: string;
  session_count: number;  // NEW — period-scoped, 0 when no sessions in range
}
```

> **Why per-alias `session_count`?** The summary table's Tools column must
> show only sources active in the selected period (section 4.4). The frontend
> filters aliases by `session_count > 0` for the source chips. Without this
> field, the frontend has no way to distinguish period-active from period-
> inactive aliases. The value comes directly from Query 2 (section 5).

### 2.2. `PATCH /api/projects/:id` — Tag mutations

Extend the existing PATCH body to accept:

```json
{
  "add_tags": ["work", "frontend"],
  "remove_tags": ["prototype"]
}
```

- `add_tags`: each must match `/^[a-z0-9-]{1,30}$/`; silently lowercased
- `remove_tags`: silently ignored if the tag doesn't exist on this project
- Both are optional; only provided fields are processed

> **Note**: No separate `GET /api/projects/tags` endpoint is needed. The
> `allTags` list is derived client-side from the `tags` arrays already present
> in the `useProjects()` response. If a cross-page tags API becomes necessary
> in the future, it can be added then.

---

## 3. Frontend: Hook Changes

### 3.1. `use-projects.ts` — Add tags

Update the `Project` type to include `tags: string[]`.

Add `addTags` and `removeTags` to `updateProject` (already exists, just
extend the body shape).

Derive `allTags: string[]` client-side from the projects array:

```typescript
const allTags = useMemo(() => {
  const set = new Set<string>();
  for (const p of data?.projects ?? []) {
    for (const t of p.tags) set.add(t);
  }
  return Array.from(set).sort();
}, [data]);
```

No separate API endpoint needed — the tags are already embedded in each
project's response.

### 3.2. Sessions page cleanup

Remove from `packages/web/src/app/(dashboard)/sessions/page.tsx`:

- `projectFilter` state (`useState("")`)
- `allData` / `filteredData` dual-fetch pattern (replace with single `useSessionData`)
- `projectNames` memo
- `FilterDropdown` import and usage
- `ProjectBreakdownChart` import and usage
- The `!projectFilter &&` conditional around the chart

The Sessions page becomes simpler: one `useSessionData()` call, no project
filter, no project breakdown chart.

---

## 4. Frontend: By Project Page

### 4.1. Navigation

**File:** `packages/web/src/lib/navigation.ts`

Add to the Analytics group, after "By Device":

```typescript
{ href: "/by-project", label: "By Project", icon: "FolderGit2" },
```

Add to `ROUTE_LABELS`:

```typescript
"by-project": "By Project",
```

**File:** `packages/web/src/components/layout/sidebar.tsx`

Add `FolderGit2` to `ICON_MAP`.

> **Why `FolderGit2`?** `FolderKanban` is already used for the `/projects`
> management page in Settings. Using a different icon avoids confusion between
> the CRUD page and the analytics page.

### 4.2. Page Structure

**File:** `packages/web/src/app/(dashboard)/by-project/page.tsx`

Pattern: matches `/devices` (stat grid + charts + summary table + period selector).

```
+----------------------------------------------------------+
| By Project                    [Tag Filter ▾] [Period ▾]  |
+----------------------------------------------------------+
| Stat Grid (3 cols)                                       |
| [Total Projects] [Most Active] [Active 7d]               |
+----------------------------------------------------------+
| Charts Row (2 cols)                                      |
| [Project Trend Chart]   [Project Share Chart]            |
+----------------------------------------------------------+
| Project Breakdown Chart (full width)                     |
+----------------------------------------------------------+
| Summary Table                                            |
| Project | Tools | Sessions | Messages | Duration | Tags  |
+----------------------------------------------------------+
```

### 4.3. Data Source

The page reuses the existing `useProjects()` hook which returns:

- `projects: Project[]` — with `session_count`, `total_messages`,
  `total_duration`, `models`, `last_active`, and now `tags`
- `unassigned: UnassignedRef[]` — included in charts as "Unassigned" group

For trend/timeline data, we need a new endpoint (see 4.6).

### 4.4. Components

#### Stat Grid

Three cards matching the `/devices` pattern:

| Card | Value | Source |
|------|-------|--------|
| Projects | Count of named projects | `projects.length` |
| Most Active | Name of project with highest session count | Client-side sort by `session_count` desc, take first. **Do not** rely on API order — `GET /api/projects` returns projects ordered by `created_at DESC`, not by activity. |
| Active (7d) | Count of projects with `absolute_last_active` within 7 wall-clock days | Always computed from wall-clock `now - 7d` using `absolute_last_active` (not period-scoped `last_active`). This matches the `/devices` page pattern (`page.tsx:45`). When a period is active, this card still shows real recency — it is intentionally **not** scoped by `from`/`to`. |

#### Project Breakdown Chart

Reuse the existing `ProjectBreakdownChart` component
(`packages/web/src/components/dashboard/project-breakdown-chart.tsx`).

The data comes from `useProjects()` rather than `useSessionData()`:

```typescript
const breakdownData: ProjectBreakdownItem[] = [
  ...projects.map(p => ({
    projectName: p.name,
    sessions: p.session_count,
    totalHours: p.total_duration / 3600,
    totalMessages: p.total_messages,
  })),
  // Aggregate unassigned refs into one row
  {
    projectName: "Unassigned",
    sessions: unassigned.reduce((s, r) => s + r.session_count, 0),
    totalHours: unassigned.reduce((s, r) => s + r.total_duration, 0) / 3600,
    totalMessages: unassigned.reduce((s, r) => s + r.total_messages, 0),
  },
].filter(d => d.sessions > 0)
 .sort((a, b) => b.sessions - a.sessions || b.totalHours - a.totalHours);
```

#### Project Trend Chart (new)

A stacked area chart showing daily session counts per project over time.
Similar to `DeviceTrendChart`.

**Component:** `packages/web/src/components/dashboard/project-trend-chart.tsx`

Data source: new `GET /api/projects/timeline` endpoint (section 4.6).

#### Project Share Chart (new)

A pie/donut chart showing session share per project.
Similar to `DeviceShareChart`.

**Component:** `packages/web/src/components/dashboard/project-share-chart.tsx`

#### Summary Table

Full-width table at the bottom with columns:

| Column | Content | Responsive |
|--------|---------|------------|
| Project | Name + color dot | Always |
| Tools | Source chips — **period-scoped** (see note below) | `hidden lg:table-cell` |
| Sessions | `session_count` | Always |
| Messages | `total_messages` | `hidden sm:table-cell` |
| Duration | `total_duration` formatted | `hidden md:table-cell` |
| Tags | Tag chips with quick-add | Always |
| Last Active | Relative time | `hidden md:table-cell` |

> **Tools column scoping**: When a period is active, the Tools column must show
> only the sources that had sessions in the selected period, not the full
> historical alias list. Each alias in the response now carries `session_count`
> (see updated `ProjectAlias` type in section 2.1) — the frontend filters to
> `alias.session_count > 0` for the chips. When no period is active (all-time),
> all aliased sources are shown. This keeps every column in the table consistent
> with the period scope.

#### Tag Interaction in Summary Table

Each project row shows its tags as small chips. Clicking a tag chip filters the
table to show only projects with that tag (sets the tag filter dropdown).

A small `+` button at the end of the tags column opens an inline input
(autocomplete from existing tags) to add a new tag. Tags can be removed by
clicking the `x` on a chip.

This provides the "quick tagging/marking" capability without leaving the
analytics page.

### 4.5. Tag Filter

A `FilterDropdown` at the top of the page (alongside `PeriodSelector`) that
filters projects by tag. **The filter scopes the entire page** — stat grid,
all charts, and the summary table are all filtered to only include projects
matching the selected tag. This is consistent with how the period selector
works (page-wide scope).

- "All Tags" (default) — shows all projects
- Specific tag — filters to projects with that tag

The filter is **client-side only** since `useProjects()` returns all projects
with their tags. Filtering is applied by the page component before passing data
to child components. The stat grid, breakdown chart, trend chart, share chart,
and summary table all receive the filtered project list.

### 4.6. New API: `GET /api/projects/timeline`

Returns daily session counts per project for charting.

**Query params:** `?from=YYYY-MM-DD&to=YYYY-MM-DD`

**Response:**

```json
{
  "timeline": [
    {
      "date": "2026-03-01",
      "projects": {
        "pew": 5,
        "work-api": 3,
        "Unassigned": 2
      }
    }
  ]
}
```

**SQL:**

```sql
SELECT
  DATE(sr.started_at) AS date,
  COALESCE(p.name, 'Unassigned') AS project_name,
  COUNT(*) AS session_count
FROM session_records sr
LEFT JOIN project_aliases pa
  ON pa.user_id = sr.user_id
  AND pa.source = sr.source
  AND pa.project_ref = sr.project_ref
LEFT JOIN projects p ON p.id = pa.project_id
WHERE sr.user_id = ?
  AND sr.started_at >= ?
  AND sr.started_at < ?
GROUP BY date, project_name
ORDER BY date
```

**File:** `packages/web/src/app/api/projects/timeline/route.ts`

---

## 5. Period Selector Consideration

The existing `useProjects()` hook does **not** accept date range params — it
returns all-time aggregated stats. The Analytics page needs period filtering.

**Approach:** Add `from`/`to` query params to `GET /api/projects`:

```
GET /api/projects?from=2026-03-01&to=2026-03-14
```

When `from`/`to` are provided, the session stats (session_count, last_active,
total_messages, total_duration, models) are scoped to sessions within that
range. The project/alias metadata itself is always returned in full — **zero-
activity projects within the selected period still appear** (with zeroed stats).

### Critical: date conditions go in JOIN ON, not WHERE

The current API uses `LEFT JOIN session_records` to retain aliases/projects
that have no matching sessions (`route.ts:86`). If date conditions are placed
in a `WHERE` clause, the LEFT JOIN degrades to an INNER JOIN, and projects
with zero sessions in the period silently disappear.

**Correct pattern — date filter in the JOIN ON clause:**

```sql
-- Query 2 (aliases with period-scoped stats + absolute last_active)
SELECT
  pa.project_id,
  pa.source,
  pa.project_ref,
  COUNT(sr.id) AS session_count,
  MAX(sr.last_message_at) AS last_active,
  SUM(COALESCE(sr.total_messages, 0)) AS total_messages,
  SUM(COALESCE(sr.duration_seconds, 0)) AS total_duration,
  MAX(sr_all.last_message_at) AS absolute_last_active   -- all-time, not period-scoped
FROM project_aliases pa
LEFT JOIN session_records sr
  ON sr.user_id = pa.user_id
  AND sr.source = pa.source
  AND sr.project_ref = pa.project_ref
  AND sr.started_at >= ?             -- date range in JOIN ON
  AND sr.started_at < ?              -- NOT in WHERE
LEFT JOIN session_records sr_all
  ON sr_all.user_id = pa.user_id
  AND sr_all.source = pa.source
  AND sr_all.project_ref = pa.project_ref
  -- no date filter: gives all-time last_active
WHERE pa.user_id = ?
GROUP BY pa.project_id, pa.source, pa.project_ref
```

> **Two LEFT JOINs on `session_records`**: `sr` is period-scoped (provides
> `session_count`, `last_active`, `total_messages`, `total_duration`).
> `sr_all` is unconditional (provides `absolute_last_active`). When no
> `from`/`to` is provided, the `sr` join has no date conditions and the
> two joins are equivalent — omit `sr_all` entirely in that case to avoid
> the performance cost of a redundant join.

```sql
-- Query 3 (unassigned refs with period-scoped stats)
SELECT
  sr.source,
  sr.project_ref,
  COUNT(*) AS session_count,
  MAX(sr.last_message_at) AS last_active,
  SUM(sr.total_messages) AS total_messages,
  SUM(sr.duration_seconds) AS total_duration
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
ORDER BY last_active DESC
```

> **Note**: Query 3 (unassigned) uses `WHERE` for dates because there is no
> LEFT JOIN to protect — unassigned refs with zero sessions in the period
> simply don't appear, which is correct (they have no project entity to anchor).

When `from`/`to` are absent, the JOIN ON date conditions are omitted entirely
(not "set to min/max dates") — the query falls back to the current all-time
behavior.

Update `useProjects()` hook to accept optional `{ from, to }` options.

---

## 6. File Changes Checklist

| # | File | Action | Description |
|---|------|--------|-------------|
| 1 | `scripts/migrations/001-init.sql` | Edit | Add `project_tags` table |
| 2 | `scripts/migrations/008-project-tags.sql` | Create | Standalone migration for `project_tags` |
| 3 | `packages/web/src/app/api/projects/route.ts` | Edit | Add tags to GET response; add `from`/`to` filtering (JOIN ON, not WHERE) |
| 4 | `packages/web/src/app/api/projects/[id]/route.ts` | Edit | Add `add_tags`/`remove_tags` to PATCH |
| 5 | `packages/web/src/app/api/projects/timeline/route.ts` | Create | `GET` — daily session counts per project |
| 6 | `packages/web/src/hooks/use-projects.ts` | Edit | Add `tags` to types; add `from`/`to` options; derive `allTags` client-side |
| 7 | `packages/web/src/lib/navigation.ts` | Edit | Add "By Project" to Analytics group + `ROUTE_LABELS` |
| 8 | `packages/web/src/components/layout/sidebar.tsx` | Edit | Add `FolderGit2` to `ICON_MAP` |
| 9 | `packages/web/src/app/(dashboard)/by-project/page.tsx` | Create | Main analytics page |
| 10 | `packages/web/src/components/dashboard/project-trend-chart.tsx` | Create | Stacked area chart for daily project sessions |
| 11 | `packages/web/src/components/dashboard/project-share-chart.tsx` | Create | Pie/donut chart for project session share |
| 12 | `packages/web/src/app/(dashboard)/sessions/page.tsx` | Edit | Remove project filter + breakdown chart |
| 13 | `packages/web/src/hooks/use-session-data.ts` | Edit | Remove `project` option (now unused) |
| 14 | `packages/web/src/app/api/sessions/route.ts` | Edit | Remove `?project=` filter support |
| 15 | `packages/worker/src/index.ts` | Edit | Add `project_tags` to Worker migration if applicable |

---

## 7. Implementation Order (Atomic Commits)

### Phase A: Schema + API (backend)

1. ~~**Migration** — Create `008-project-tags.sql` + update `001-init.sql`~~ ✅
2. ~~**Projects API: tags** — Add `tags` to GET response; `add_tags`/`remove_tags` to PATCH~~ ✅
3. ~~**Projects API: date range** — Add `from`/`to` query params to GET (JOIN ON pattern)~~ ✅
4. ~~**Timeline API** — `GET /api/projects/timeline` endpoint~~ ✅

### Phase B: Sessions page cleanup

5. **Sessions page** — Remove project filter dropdown, `ProjectBreakdownChart`,
   dual-fetch pattern, and related imports
6. **Sessions hook** — Remove `project` option from `useSessionData` (verify
   no other consumers use it)
7. **Sessions API** — Remove `?project=` query param support

### Phase C: By Project page (frontend)

8. **Navigation** — Add sidebar entry + route label + icon
9. **Hook update** — Add `tags`, `allTags`, `from`/`to` to `useProjects()`
10. **Page skeleton** — Create `/by-project/page.tsx` with stat grid + existing
    `ProjectBreakdownChart` (data from `useProjects`)
11. **Trend chart** — `ProjectTrendChart` component + wire to timeline API
12. **Share chart** — `ProjectShareChart` component
13. **Summary table** — Full table with tag chips + inline tag editing
14. **Tag filter** — `FilterDropdown` for tag-based filtering (whole-page scope)

### Phase D: Polish

15. **Empty states** — Handle zero projects, loading, errors
16. **Worker migration** — Update Worker if it runs schema migrations

---

## 8. Test Coverage

### Unit Tests

| Test | File | Description |
|------|------|-------------|
| Tag validation | `packages/web/src/__tests__/project-tags.test.ts` | Validates tag format rules (`/^[a-z0-9-]{1,30}$/`) |
| Breakdown from projects | `packages/web/src/__tests__/by-project-helpers.test.ts` | Tests `ProjectBreakdownItem[]` assembly from `useProjects` data |
| Timeline aggregation | `packages/web/src/__tests__/project-timeline.test.ts` | Tests SQL result → timeline response transformation |

### E2E / Integration

| Test | Description |
|------|-------------|
| Projects API tags | POST project → PATCH add_tags → GET verify tags → PATCH remove_tags → GET verify |
| Timeline API | Seed sessions → GET timeline → verify daily counts per project |
| Sessions page regression | Verify project filter is gone; page still renders correctly |
| By Project page | Navigate to `/by-project` → verify stat grid, charts, table render |

---

## 9. Future Considerations

- **Color coding per project** — Assign persistent colors for visual distinction
  in charts (currently uses palette rotation by index)
- **Tag colors** — Let users assign colors to tags
- **Cross-page tag filter** — Global tag filter that persists across pages
- **Per-project token usage** — Requires adding `project_ref` to `usage_records`
  schema (significant migration)
- **Auto-tagging** — Suggest tags based on project aliases, models used, or
  activity patterns
