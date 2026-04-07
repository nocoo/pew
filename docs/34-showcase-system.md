# 34 — Showcase System

> ProductHunt-style project showcase: users submit GitHub projects, others can upvote.

## Overview

Showcase is a community feature where pew users can submit their GitHub projects for others to discover and upvote. Think of it as a mini ProductHunt integrated into pew's leaderboard ecosystem.

### User Stories

1. **Submitter**: As a pew user, I want to showcase my GitHub project so others can discover it
2. **Viewer**: As anyone (logged in or not), I want to browse showcased projects publicly
3. **Voter**: As a logged-in user, I want to upvote showcases I like
4. **Manager**: As a submitter, I want to manage my showcases (toggle visibility, delete)
5. **Admin**: As an admin, I want to moderate all showcases (view hidden, edit, delete)

### Access Model

Consistent with existing leaderboard:

| Action | Auth Required |
|--------|---------------|
| Browse showcases | No (public) |
| View single showcase | No (public, if `is_public=1`) |
| Submit showcase | Yes |
| Upvote/un-upvote | Yes |
| Edit own showcase | Yes (owner only) |
| Delete own showcase | Yes (owner only) |
| View hidden showcase | Yes (owner/admin only) |
| Refresh from GitHub | Yes (owner only) |
| **Admin: list all showcases** | Yes (admin only) |
| **Admin: edit any showcase** | Yes (admin only) |
| **Admin: delete any showcase** | Yes (admin only) |

## Database Schema

### New Tables

```sql
-- scripts/migrations/016-showcases.sql

-- ============================================================
-- Showcases (user-submitted GitHub projects)
-- ============================================================

CREATE TABLE IF NOT EXISTS showcases (
  id              TEXT PRIMARY KEY,                         -- nanoid
  user_id         TEXT NOT NULL REFERENCES users(id),       -- submitter
  repo_key        TEXT NOT NULL,                            -- normalized: "owner/repo" lowercase
  github_url      TEXT NOT NULL,                            -- display URL (original casing)
  title           TEXT NOT NULL,                            -- fetched from GitHub
  description     TEXT,                                     -- fetched from GitHub
  tagline         TEXT,                                     -- user-provided recommendation (editable)
  og_image_url    TEXT,                                     -- GitHub OG image URL
  is_public       INTEGER NOT NULL DEFAULT 1,               -- 1=visible, 0=hidden
  refreshed_at    TEXT NOT NULL DEFAULT (datetime('now')),  -- last GitHub metadata sync
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(repo_key)                                          -- one submission per repo (normalized)
);

CREATE INDEX IF NOT EXISTS idx_showcases_user ON showcases(user_id);
CREATE INDEX IF NOT EXISTS idx_showcases_public_sort ON showcases(is_public, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_showcases_created ON showcases(created_at DESC);

-- ============================================================
-- Showcase Upvotes (one per user per showcase)
-- ============================================================

CREATE TABLE IF NOT EXISTS showcase_upvotes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  showcase_id  TEXT NOT NULL REFERENCES showcases(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(showcase_id, user_id)                              -- one upvote per user
);

CREATE INDEX IF NOT EXISTS idx_showcase_upvotes_showcase ON showcase_upvotes(showcase_id);
CREATE INDEX IF NOT EXISTS idx_showcase_upvotes_user ON showcase_upvotes(user_id);
```

### Schema Notes

- **`repo_key`** (not `github_url`) has UNIQUE constraint — normalized `owner/repo` lowercase
- **`title` / `description`** fetched from GitHub, can be refreshed via owner action
- **`tagline`** is user-editable recommendation text (optional, max 280 chars)
- **`og_image_url`** constructed from repo_key, with fallback placeholder
- **`refreshed_at`** tracks last GitHub metadata sync
- **No `upvote_count` column** — v1 computes count via JOIN at read time (simpler, always accurate)

### URL Normalization

```typescript
// Input: any valid GitHub repo URL
// Output: { repoKey: "owner/repo", displayUrl: "https://github.com/owner/repo" }

function normalizeGitHubUrl(url: string): { repoKey: string; displayUrl: string } | null {
  const match = url.match(/^https?:\/\/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)\/?$/);
  if (!match) return null;
  const [, owner, repo] = match;
  const repoKey = `${owner}/${repo}`.toLowerCase();
  const displayUrl = `https://github.com/${owner}/${repo}`;
  return { repoKey, displayUrl };
}
```

## API Routes

### `/api/showcases` — List & Create

```
GET  /api/showcases              — list public showcases (no auth required)
POST /api/showcases              — submit new showcase (auth required)
```

#### GET Query Parameters

| Param | Type | Description |
|-------|------|-------------|
| `mine` | `"1"` | If set, return current user's showcases (auth required) |
| `limit` | number | Max results (default 20, max 100) |
| `offset` | number | Skip first N results (default 0) |

#### Pagination Strategy: Offset/Limit

**v1 uses simple offset/limit pagination** instead of cursor-based pagination.

Rationale:
- Showcase list is expected to be small in v1 (<1000 items)
- Offset/limit is simpler to implement and debug
- Trade-off: deep pagination may show duplicates/gaps if data changes mid-browse — acceptable for v1 given small dataset

Future: If showcase count grows significantly, revisit with keyset pagination on stable sort (created_at DESC, id DESC).

#### GET Response

```typescript
interface ShowcaseListResponse {
  showcases: Array<{
    id: string;
    repo_key: string;
    github_url: string;
    title: string;
    description: string | null;
    tagline: string | null;
    og_image_url: string | null;
    upvote_count: number;           // computed via COUNT(*)
    is_public: boolean;             // included for mine=1 and admin; always true for public list
    created_at: string;
    user: {
      id: string;
      name: string | null;
      nickname: string | null;
      image: string | null;
      slug: string | null;
    };
    has_upvoted: boolean | null;    // null if not logged in
  }>;
  total: number;                    // total count for pagination UI
  limit: number;
  offset: number;
}
```

**Behavior:**
- Without `mine`: returns `is_public=1` showcases only, `is_public` always `true` in response
- With `mine=1`: returns all showcases owned by current user (requires auth), includes actual `is_public` value
- `has_upvoted` is `null` for unauthenticated requests
- Sorted by `created_at DESC, id DESC` (stable sort)

#### Upvote Count Query

Since there's no denormalized `upvote_count` column, compute it via JOIN.

**Authenticated user** — include `has_upvoted` via subquery:

```sql
SELECT
  s.*,
  (SELECT COUNT(*) FROM showcase_upvotes WHERE showcase_id = s.id) as upvote_count,
  EXISTS(SELECT 1 FROM showcase_upvotes WHERE showcase_id = s.id AND user_id = ?) as has_upvoted
FROM showcases s
WHERE s.is_public = 1
ORDER BY s.created_at DESC, s.id DESC
LIMIT ? OFFSET ?
```

**Unauthenticated** — separate query without `has_upvoted` (return `null` in response):

```sql
SELECT
  s.*,
  (SELECT COUNT(*) FROM showcase_upvotes WHERE showcase_id = s.id) as upvote_count
FROM showcases s
WHERE s.is_public = 1
ORDER BY s.created_at DESC, s.id DESC
LIMIT ? OFFSET ?
```

Implementation note: Use two separate SQL strings based on auth state. Do NOT pass `null` as user_id parameter — SQLite's `user_id = NULL` always evaluates to `NULL` (not `FALSE`), which would break the query logic.

#### POST Request

```typescript
interface CreateShowcaseRequest {
  github_url: string;   // must be https://github.com/{owner}/{repo} format
  tagline?: string;     // optional recommendation (max 280 chars)
}
```

**Response codes:**
- `201` — Created successfully
- `400` — Invalid URL format
- `401` — Not authenticated
- `404` — Repository not found on GitHub (doesn't exist or private)
- `409` — Repository already showcased (by anyone)
- `422` — GitHub API error (rate limit, timeout, etc.)

### `/api/showcases/preview` — Preview Before Submit

```
POST /api/showcases/preview      — fetch GitHub metadata for preview (auth required)
```

#### Request

```typescript
interface PreviewRequest {
  github_url: string;
}
```

#### Response

```typescript
interface PreviewResponse {
  repo_key: string;
  github_url: string;        // normalized display URL
  title: string;
  description: string | null;
  og_image_url: string;
  already_exists: boolean;   // true if repo_key already in showcases
}
```

**Response codes:**
- `200` — Preview fetched successfully
- `400` — Invalid URL format
- `401` — Not authenticated
- `404` — Repository not found on GitHub
- `422` — GitHub API error

### `/api/showcases/[id]` — Read, Update, Delete

```
GET    /api/showcases/[id]       — get single showcase
PATCH  /api/showcases/[id]       — update showcase (owner or admin)
DELETE /api/showcases/[id]       — delete showcase (owner or admin)
```

#### GET Access Control

- `is_public=1`: Anyone can view
- `is_public=0`: Only owner or admin can view; others get `404`

#### PATCH Request

```typescript
interface UpdateShowcaseRequest {
  tagline?: string | null;   // user recommendation (null to clear)
  is_public?: boolean;       // visibility toggle
}
```

**Access:**
- Owner can edit own showcase
- Admin can edit any showcase (for moderation — e.g., hide inappropriate content)

**Note:** `title` and `description` are NOT directly editable. Use the refresh endpoint to re-fetch from GitHub.

#### DELETE Access

- Owner can delete own showcase
- Admin can delete any showcase

### `/api/showcases/[id]/refresh` — Refresh from GitHub

```
POST /api/showcases/[id]/refresh  — re-fetch metadata from GitHub (owner only)
```

This endpoint allows showcase owners to update title, description, and OG image when they've changed their GitHub repository.

#### Response

```typescript
interface RefreshResponse {
  title: string;
  description: string | null;
  og_image_url: string;
  repo_key: string;          // may change if renamed
  github_url: string;        // may change if renamed
  refreshed_at: string;
}
```

**Behavior:**
- Re-fetches metadata from GitHub API
- Updates `title`, `description`, `og_image_url`, `refreshed_at`
- If repo was renamed/transferred:
  - Compute new `repo_key` from GitHub response
  - **Check if new `repo_key` already exists** in another showcase
  - If conflict: return `409` with message "Repository was renamed to {new_key} but that repo is already showcased"
  - If no conflict: update `repo_key` and `github_url`
- If repo no longer exists (404), returns `410` but does NOT delete showcase

**Response codes:**
- `200` — Refreshed successfully
- `401` — Not authenticated
- `403` — Not owner
- `404` — Showcase not found (or hidden and not owner)
- `409` — Repo was renamed but new repo_key conflicts with existing showcase
- `410` — GitHub repo no longer exists ("Repository was deleted or made private")
- `422` — GitHub API error

### `/api/showcases/[id]/upvote` — Toggle Upvote

```
POST /api/showcases/[id]/upvote  — toggle upvote (auth required)
```

#### Response

```typescript
interface UpvoteResponse {
  upvoted: boolean;       // new state after toggle
  upvote_count: number;   // fresh COUNT(*) from showcase_upvotes
}
```

#### Implementation

Simple insert/delete — no denormalized count to maintain:

```typescript
// Check current state
const existing = await dbRead.firstOrNull(
  `SELECT id FROM showcase_upvotes WHERE showcase_id = ? AND user_id = ?`,
  [showcaseId, userId]
);

if (existing) {
  // Remove upvote
  await dbWrite.execute(
    `DELETE FROM showcase_upvotes WHERE showcase_id = ? AND user_id = ?`,
    [showcaseId, userId]
  );
} else {
  // Add upvote
  await dbWrite.execute(
    `INSERT INTO showcase_upvotes (showcase_id, user_id) VALUES (?, ?)`,
    [showcaseId, userId]
  );
}

// Get fresh count
const { count } = await dbRead.first(
  `SELECT COUNT(*) as count FROM showcase_upvotes WHERE showcase_id = ?`,
  [showcaseId]
);

return { upvoted: !existing, upvote_count: count };
```

### `/api/admin/showcases` — Admin List All

```
GET /api/admin/showcases         — list all showcases (admin only)
```

#### GET Query Parameters

| Param | Type | Description |
|-------|------|-------------|
| `is_public` | `"0"` or `"1"` | Filter by visibility (omit for all) |
| `user_id` | string | Filter by submitter |
| `limit` | number | Max results (default 50, max 200) |
| `offset` | number | Skip first N results (default 0) |

#### GET Response

Admin response uses a **dedicated type** with additional fields for moderation:

```typescript
interface AdminShowcaseListResponse {
  showcases: Array<{
    id: string;
    repo_key: string;
    github_url: string;
    title: string;
    description: string | null;
    tagline: string | null;
    og_image_url: string | null;
    upvote_count: number;
    is_public: boolean;
    created_at: string;
    refreshed_at: string;
    // Admin-only: full user info for moderation
    user: {
      id: string;
      email: string;            // admin-only field
      name: string | null;
      nickname: string | null;
      image: string | null;
      slug: string | null;
    };
  }>;
  total: number;
  limit: number;
  offset: number;
}
```

Note: This is NOT the same type as public `ShowcaseListResponse`. Do not reuse — admin response includes `user.email` and omits `has_upvoted` (not relevant for moderation).

**Response codes:**
- `200` — Success
- `401` — Not authenticated
- `403` — Not admin

## GitHub Integration

### URL Validation

Valid formats:
- `https://github.com/owner/repo`
- `https://github.com/owner/repo/`
- `http://github.com/owner/repo` (normalized to https)

Invalid formats (rejected with 400):
- `https://github.com/owner` (user/org page)
- `https://github.com/owner/repo/blob/main/file.ts` (file path)
- `https://github.com/owner/repo/tree/main` (branch/path)
- `https://github.com/owner/repo/issues/123` (issue page)
- `https://gitlab.com/...` (wrong host)

Regex:
```typescript
const GITHUB_REPO_PATTERN = /^https?:\/\/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)\/?$/;
```

### Metadata Fetching

```typescript
async function fetchGitHubMetadata(owner: string, repo: string): Promise<GitHubMetadata> {
  const url = `https://api.github.com/repos/${owner}/${repo}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "pew-showcase/1.0" },
    signal: AbortSignal.timeout(5000),  // 5s timeout
  });

  if (res.status === 404) {
    throw new GitHubError("NOT_FOUND", "Repository not found or is private");
  }
  if (res.status === 403) {
    const remaining = res.headers.get("X-RateLimit-Remaining");
    if (remaining === "0") {
      throw new GitHubError("RATE_LIMITED", "GitHub API rate limit exceeded");
    }
    throw new GitHubError("FORBIDDEN", "Access denied");
  }
  if (!res.ok) {
    throw new GitHubError("UPSTREAM_ERROR", `GitHub API error: ${res.status}`);
  }

  const data = await res.json();
  return {
    // Handle repo rename/transfer: use current owner/name from API response
    owner: data.owner?.login || owner,
    name: data.name || repo,
    title: data.name || `${owner}/${repo}`,
    description: data.description || null,
    fullName: data.full_name,  // "current_owner/current_name" for rename detection
  };
}
```

### Error Mapping

| GitHub Status | API Response | Message |
|---------------|--------------|---------|
| 404 | 404 | "Repository not found or is private" |
| 403 (rate limit) | 422 | "GitHub API rate limit exceeded. Try again later." |
| 403 (other) | 422 | "Cannot access repository" |
| 5xx / timeout | 422 | "GitHub is temporarily unavailable. Try again later." |
| Network error | 422 | "Failed to connect to GitHub" |

### OG Image Strategy

GitHub OG images are served from `opengraph.githubassets.com`. Strategy:

1. **Construction**: `https://opengraph.githubassets.com/1/${owner}/${repo}`
2. **Storage**: Store URL in `og_image_url` column
3. **Rendering**: Use plain `<img>` tag (not `next/image`) with `onError` fallback
4. **Fallback**: On error, show gradient placeholder with repo name

```tsx
function ShowcaseImage({ url, repoKey }: { url: string | null; repoKey: string }) {
  const [error, setError] = useState(false);

  if (!url || error) {
    return (
      <div className="bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
        <span className="text-muted-foreground text-sm">{repoKey}</span>
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={repoKey}
      className="object-cover"
      onError={() => setError(true)}
    />
  );
}
```

## Frontend Pages

### Leaderboard → Showcases (`/leaderboard/showcases`)

New tab in LeaderboardNav alongside Individual, Seasons, Achievements.

**Layout:**
- "Add Showcase" button (top right, shown only if logged in)
- ProductHunt-style card list
- Each card shows:
  - OG image (left, 16:9 aspect, 200px width)
  - Title + tagline (center, tagline in muted color)
  - GitHub description (truncated, small text)
  - Submitter avatar + name (bottom)
  - Upvote button + count (right side)

**Sorting:** `created_at DESC, id DESC` (newest first, stable)

**Upvote interaction:**
- Not logged in: clicking upvote shows "Login to upvote" tooltip or redirects
- Logged in: optimistic toggle with rollback on error

**Add Showcase (from leaderboard):**
- Click "Add Showcase" → opens modal
- Same modal as settings page

### Settings → Showcases (`/settings/showcases`)

Dashboard page for managing user's showcases.

**Layout:**
- Header: "My Showcases" with "Add Showcase" button
- List of user's showcases (cards):
  - OG image thumbnail (80px)
  - Title, tagline (truncated)
  - Upvote count
  - Public/Hidden badge
  - Actions: Edit (tagline + visibility), Refresh, Delete

**Add Showcase Modal:**
1. Input: GitHub URL
2. Click "Preview" or auto-fetch on blur
3. Show preview: image, title, description (read-only)
4. Input: Tagline (optional, "Why do you recommend this?")
5. Submit button

**Edit Showcase Modal:**
- Tagline input (editable)
- Public/Hidden toggle
- "Refresh from GitHub" button (updates title/description)
- Note: "Title and description are synced from GitHub"
- Save/Cancel buttons

### Admin → Showcases (`/admin/showcases`)

Admin page for moderating all showcases.

**Layout:**
- Header: "Showcase Moderation"
- Filters: visibility (all/public/hidden), search by user
- Table view with columns:
  - Thumbnail
  - Title / repo_key
  - Submitter (name + email)
  - Upvote count
  - Status (Public/Hidden badge)
  - Created at
  - Actions: View, Edit, Hide/Unhide, Delete

**Actions:**
- **View**: Opens showcase in new tab
- **Edit**: Opens modal to edit tagline and visibility
- **Hide/Unhide**: Quick toggle for `is_public`
- **Delete**: Confirmation dialog, then hard delete

## Component Hierarchy

```
packages/web/src/
├── app/
│   ├── (dashboard)/
│   │   ├── settings/
│   │   │   └── showcases/
│   │   │       └── page.tsx           # Settings → Showcases management
│   │   └── admin/
│   │       └── showcases/
│   │           └── page.tsx           # Admin → Showcase moderation
│   ├── leaderboard/
│   │   └── showcases/
│   │       └── page.tsx               # Leaderboard → Showcases tab
│   └── api/
│       ├── showcases/
│       │   ├── route.ts               # GET list, POST create
│       │   ├── preview/
│       │   │   └── route.ts           # POST preview
│       │   └── [id]/
│       │       ├── route.ts           # GET, PATCH, DELETE
│       │       ├── refresh/
│       │       │   └── route.ts       # POST refresh from GitHub
│       │       └── upvote/
│       │           └── route.ts       # POST toggle
│       └── admin/
│           └── showcases/
│               └── route.ts           # GET all (admin)
├── components/
│   └── showcase/
│       ├── showcase-card.tsx          # Card for list display
│       ├── showcase-image.tsx         # Image with fallback
│       ├── showcase-form-modal.tsx    # Add/Edit modal
│       └── upvote-button.tsx          # Upvote button with count
└── hooks/
    └── use-showcases.ts               # SWR hook for showcase list
```

## Implementation Plan

### Phase 1: Database & Core API ✅

1. ✅ **Migration** — `scripts/migrations/016-showcases.sql`
2. ✅ **Lib: GitHub helpers** — `lib/github.ts` (URL normalization, metadata fetch)
3. ✅ **API: Preview** — `api/showcases/preview/route.ts`
4. ✅ **API: List & Create** — `api/showcases/route.ts`
5. ✅ **API: Single CRUD** — `api/showcases/[id]/route.ts`
6. ✅ **API: Refresh** — `api/showcases/[id]/refresh/route.ts`
7. ✅ **API: Upvote** — `api/showcases/[id]/upvote/route.ts`
8. ✅ **API: Admin list** — `api/admin/showcases/route.ts`

### Phase 2: Frontend ✅

9. ✅ **LeaderboardNav update** — add Showcases tab
10. ✅ **Showcase components** — card, image, upvote button
11. ✅ **Leaderboard showcases page** — `/leaderboard/showcases`
12. ✅ **Settings showcases page** — `/settings/showcases`
13. ✅ **Form modal** — add/edit with preview and refresh
14. ✅ **Admin showcases page** — `/admin/showcases`

## Atomic Commits

```
feat(db): add showcases and upvotes tables (016-showcases.sql)
feat(lib): add GitHub URL normalization and metadata fetch helpers
feat(api): implement showcase preview endpoint
feat(api): implement showcases list and create endpoints
feat(api): implement showcase single CRUD operations
feat(api): implement showcase refresh from GitHub
feat(api): implement showcase upvote toggle
feat(api): implement admin showcases list endpoint
feat(web): add Showcases tab to LeaderboardNav
feat(web): add showcase card and image components
feat(web): add leaderboard showcases page
feat(web): add settings showcases management page
feat(web): add showcase form modal with preview
feat(web): add admin showcases moderation page
docs: update README index with 34-showcase-system
```

## Testing Strategy

### L1 — Unit Tests

- `normalizeGitHubUrl()` — valid/invalid URLs, case normalization
- `parseGitHubError()` — error type mapping

### L2 — Integration Tests (API E2E)

**Auth & Access:**
- Guest can GET `/api/showcases` (list public)
- Guest cannot POST `/api/showcases` (401)
- Guest cannot POST upvote (401)
- Guest gets 404 for hidden showcase
- Owner can GET own hidden showcase
- Non-owner gets 404 for others' hidden showcase
- Admin can GET any hidden showcase
- Admin can GET `/api/admin/showcases`
- Non-admin gets 403 on `/api/admin/showcases`

**CRUD:**
- Create with valid URL → 201 + metadata populated
- Create with invalid URL format → 400
- Create with non-existent repo → 404
- Create duplicate repo_key → 409
- Update tagline → 200
- Update title directly (should fail or be ignored)
- Delete own → 200
- Delete others' → 403
- Admin delete any → 200
- Admin hide any → 200

**Refresh:**
- Owner refresh → 200 + updated metadata
- Non-owner refresh → 403
- Refresh deleted repo → 410
- Refresh with rate limit → 422
- Refresh renamed repo (no conflict) → 200 + updated repo_key
- Refresh renamed repo (conflict exists) → 409

**Upvote:**
- Toggle on → upvoted=true, count+1
- Toggle off → upvoted=false, count-1
- Idempotent: double toggle = original state
- Verify returned count matches actual COUNT(*)

**Pagination:**
- offset=0, limit=10 returns first 10
- offset=10, limit=10 returns next 10
- offset beyond total returns empty array
- total count is accurate

**Edge cases:**
- GitHub API rate limit simulation → 422
- GitHub timeout → 422
- Empty description from GitHub → null stored
- URL case variations normalize to same repo_key

### L3 — E2E (Playwright)

- Guest browses showcases, sees upvote buttons but cannot click
- Login → upvote → count updates
- Add showcase from leaderboard page
- Add showcase from settings page
- Edit tagline, toggle visibility
- Refresh from GitHub updates title/description
- Delete showcase with confirmation
- Pagination: load more works correctly
- Admin: view all showcases including hidden
- Admin: hide/unhide showcase
- Admin: delete showcase

## Security Considerations

1. **Public browse, auth for actions** — consistent with leaderboard
2. **Ownership enforcement** — PATCH/DELETE/refresh check `user_id` (or admin)
3. **Admin bypass** — Admin can view/edit/delete any showcase for moderation
4. **Hidden showcase isolation** — non-owner/non-admin returns 404, not 403
5. **URL validation** — strict regex prevents injection
6. **Tagline sanitization** — escape HTML on display
7. **No GitHub token** — public API only, accept rate limits

## Decisions

1. **Title/description from GitHub with refresh** — Source of truth is GitHub. Owner can manually trigger refresh when they update their repo.

2. **Tagline field** — Allows personal recommendation without duplicating GitHub metadata. Max 280 chars (tweet-length).

3. **repo_key for dedup** — Lowercase `owner/repo` ensures same repo can't be submitted twice regardless of URL casing.

4. **No featured/pinned in v1** — Keep it simple. Can add `featured_at` column later.

5. **Plain img, not next/image** — Avoids remote domain whitelist complexity. Fallback handles failures gracefully.

6. **Offset/limit pagination** — Simple and correct for small dataset. Cursor pagination deferred until scale requires it.

7. **Sort by created_at, not upvote_count** — Stable pagination. "Most upvoted" sort can be added later with explicit instability trade-off.

8. **No denormalized upvote_count** — v1 computes count via JOIN. Simpler, always accurate, no drift. If performance becomes an issue at scale, add denormalized column then.

9. **Refresh conflict handling** — If repo renamed to an already-showcased repo, return 409 with explanation. User must manually resolve (e.g., delete one showcase).

10. **Admin moderation** — Admins can view all, edit any, delete any. Primary use case: hiding inappropriate content or spam.

---

**Status:** implementation-complete
**Author:** Claude
**Date:** 2026-04-07
