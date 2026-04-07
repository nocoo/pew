# 34 — Showcase System

> ProductHunt-style project showcase: users submit GitHub projects, others can upvote.

## Overview

Showcase is a community feature where pew users can submit their GitHub projects for others to discover and upvote. Think of it as a mini ProductHunt integrated into pew's leaderboard ecosystem.

### User Stories

1. **Submitter**: As a pew user, I want to showcase my GitHub project so others can discover it
2. **Viewer**: As anyone (logged in or not), I want to browse showcased projects publicly
3. **Voter**: As a logged-in user, I want to upvote showcases I like
4. **Manager**: As a submitter, I want to manage my showcases (toggle visibility, delete)

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
  upvote_count    INTEGER NOT NULL DEFAULT 0,               -- denormalized, updated atomically
  refreshed_at    TEXT NOT NULL DEFAULT (datetime('now')),  -- last GitHub metadata sync
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(repo_key)                                          -- one submission per repo (normalized)
);

CREATE INDEX IF NOT EXISTS idx_showcases_user ON showcases(user_id);
CREATE INDEX IF NOT EXISTS idx_showcases_public_sort ON showcases(is_public, created_at DESC);

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
- **`upvote_count`** updated atomically with upvote insert/delete (same SQL statement batch)
- **`og_image_url`** constructed from repo_key, with fallback placeholder
- **`refreshed_at`** tracks last GitHub metadata sync

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
- `upvote_count` changes frequently via user actions
- Cursor-based pagination with mutable sort keys (upvote_count) would require complex tuple cursors (`{upvote_count, created_at, id}`) and still exhibit instability during concurrent upvotes
- Offset/limit is simpler to implement and debug
- Trade-off: deep pagination may show duplicates/gaps if data changes mid-browse — acceptable for v1 given small dataset

Future: If showcase count grows significantly, revisit with:
- Keyset pagination on stable sort (created_at DESC, id DESC)
- Or accept upvote_count instability as "live leaderboard" behavior

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
    upvote_count: number;
    is_public: boolean;         // included for mine=1; always true for public list
    created_at: string;
    user: {
      id: string;
      name: string | null;
      nickname: string | null;
      image: string | null;
      slug: string | null;
    };
    has_upvoted: boolean | null;  // null if not logged in
  }>;
  total: number;                  // total count for pagination UI
  limit: number;
  offset: number;
}
```

**Behavior:**
- Without `mine`: returns `is_public=1` showcases only, `is_public` always `true` in response
- With `mine=1`: returns all showcases owned by current user (requires auth), includes actual `is_public` value
- `has_upvoted` is `null` for unauthenticated requests
- Sorted by `created_at DESC, id DESC` (stable sort)

**Sorting rationale:**
- v1 uses `created_at DESC` (newest first) as primary sort, not `upvote_count`
- This avoids pagination instability from concurrent upvotes
- "Most upvoted" can be a future sort option with explicit instability trade-off

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
PATCH  /api/showcases/[id]       — update showcase (owner only)
DELETE /api/showcases/[id]       — delete showcase (owner only)
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

**Note:** `title` and `description` are NOT directly editable. Use the refresh endpoint to re-fetch from GitHub.

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
  refreshed_at: string;
}
```

**Behavior:**
- Re-fetches metadata from GitHub API
- Updates `title`, `description`, `og_image_url`, `refreshed_at`
- If repo was renamed/transferred, updates `repo_key` and `github_url`
- If repo no longer exists (404), returns error but does NOT delete showcase

**Response codes:**
- `200` — Refreshed successfully
- `401` — Not authenticated
- `403` — Not owner
- `404` — Showcase not found (or hidden and not owner)
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
  upvote_count: number;   // updated count (from showcase_upvotes, not denormalized)
}
```

#### Atomic Update Strategy

To maintain consistency between `showcase_upvotes` and `showcases.upvote_count`, use a single batch write:

```typescript
// Toggle ON (add upvote)
await dbWrite.batch([
  {
    sql: `INSERT INTO showcase_upvotes (showcase_id, user_id) VALUES (?, ?)`,
    params: [showcaseId, userId],
  },
  {
    sql: `UPDATE showcases SET upvote_count = upvote_count + 1, updated_at = datetime('now') WHERE id = ?`,
    params: [showcaseId],
  },
]);

// Toggle OFF (remove upvote)
await dbWrite.batch([
  {
    sql: `DELETE FROM showcase_upvotes WHERE showcase_id = ? AND user_id = ?`,
    params: [showcaseId, userId],
  },
  {
    sql: `UPDATE showcases SET upvote_count = upvote_count - 1, updated_at = datetime('now') WHERE id = ?`,
    params: [showcaseId],
  },
]);
```

#### Upvote Count Consistency

**D1 batch is NOT transactional.** On partial failure, `upvote_count` may drift from actual `COUNT(*)` of `showcase_upvotes`.

**Mitigation strategy:**

1. **Read-time truth**: When returning `upvote_count` in API responses, read from `showcase_upvotes` aggregate:
   ```sql
   SELECT s.*, COUNT(u.id) as actual_upvote_count
   FROM showcases s
   LEFT JOIN showcase_upvotes u ON u.showcase_id = s.id
   WHERE s.id = ?
   GROUP BY s.id
   ```

2. **Denormalized field for sorting only**: `showcases.upvote_count` is used for index-based sorting but NOT trusted for display.

3. **Periodic reconciliation**: Admin endpoint or cron job to fix drift:
   ```sql
   UPDATE showcases SET upvote_count = (
     SELECT COUNT(*) FROM showcase_upvotes WHERE showcase_id = showcases.id
   )
   ```

4. **Optimistic UI**: Frontend shows optimistic count; on error rollback, re-fetch true count.

This approach ensures **display accuracy** while accepting **sort-order may lag by 1** in rare partial-failure scenarios.

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

## Component Hierarchy

```
packages/web/src/
├── app/
│   ├── (dashboard)/
│   │   └── settings/
│   │       └── showcases/
│   │           └── page.tsx           # Settings → Showcases management
│   ├── leaderboard/
│   │   └── showcases/
│   │       └── page.tsx               # Leaderboard → Showcases tab
│   └── api/
│       └── showcases/
│           ├── route.ts               # GET list, POST create
│           ├── preview/
│           │   └── route.ts           # POST preview
│           └── [id]/
│               ├── route.ts           # GET, PATCH, DELETE
│               ├── refresh/
│               │   └── route.ts       # POST refresh from GitHub
│               └── upvote/
│                   └── route.ts       # POST toggle
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

### Phase 1: Database & Core API

1. **Migration** — `scripts/migrations/016-showcases.sql`
2. **Lib: GitHub helpers** — `lib/github.ts` (URL normalization, metadata fetch)
3. **API: Preview** — `api/showcases/preview/route.ts`
4. **API: List & Create** — `api/showcases/route.ts`
5. **API: Single CRUD** — `api/showcases/[id]/route.ts`
6. **API: Refresh** — `api/showcases/[id]/refresh/route.ts`
7. **API: Upvote** — `api/showcases/[id]/upvote/route.ts`

### Phase 2: Frontend

8. **LeaderboardNav update** — add Showcases tab
9. **Showcase components** — card, image, upvote button
10. **Leaderboard showcases page** — `/leaderboard/showcases`
11. **Settings showcases page** — `/settings/showcases`
12. **Form modal** — add/edit with preview and refresh

## Atomic Commits

```
feat(db): add showcases and upvotes tables (016-showcases.sql)
feat(lib): add GitHub URL normalization and metadata fetch helpers
feat(api): implement showcase preview endpoint
feat(api): implement showcases list and create endpoints
feat(api): implement showcase single CRUD operations
feat(api): implement showcase refresh from GitHub
feat(api): implement showcase upvote toggle
feat(web): add Showcases tab to LeaderboardNav
feat(web): add showcase card and image components
feat(web): add leaderboard showcases page
feat(web): add settings showcases management page
feat(web): add showcase form modal with preview
docs: update README index with 34-showcase-system
```

## Testing Strategy

### L1 — Unit Tests

- `normalizeGitHubUrl()` — valid/invalid URLs, case normalization
- `parseGitHubError()` — error type mapping
- Upvote state derivation

### L2 — Integration Tests (API E2E)

**Auth & Access:**
- Guest can GET `/api/showcases` (list public)
- Guest cannot POST `/api/showcases` (401)
- Guest cannot POST upvote (401)
- Guest gets 404 for hidden showcase
- Owner can GET own hidden showcase
- Non-owner gets 404 for others' hidden showcase

**CRUD:**
- Create with valid URL → 201 + metadata populated
- Create with invalid URL format → 400
- Create with non-existent repo → 404
- Create duplicate repo_key → 409
- Update tagline → 200
- Update title directly (should fail or be ignored)
- Delete own → 200
- Delete others' → 403

**Refresh:**
- Owner refresh → 200 + updated metadata
- Non-owner refresh → 403
- Refresh deleted repo → 410
- Refresh with rate limit → 422

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

## Security Considerations

1. **Public browse, auth for actions** — consistent with leaderboard
2. **Ownership enforcement** — PATCH/DELETE/refresh check `user_id`
3. **Hidden showcase isolation** — non-owner/admin returns 404, not 403
4. **URL validation** — strict regex prevents injection
5. **Tagline sanitization** — escape HTML on display
6. **No GitHub token** — public API only, accept rate limits

## Decisions

1. **Title/description from GitHub with refresh** — Source of truth is GitHub. Owner can manually trigger refresh when they update their repo.

2. **Tagline field** — Allows personal recommendation without duplicating GitHub metadata. Max 280 chars (tweet-length).

3. **repo_key for dedup** — Lowercase `owner/repo` ensures same repo can't be submitted twice regardless of URL casing.

4. **No featured/pinned in v1** — Keep it simple. Can add `featured_at` column later.

5. **Plain img, not next/image** — Avoids remote domain whitelist complexity. Fallback handles failures gracefully.

6. **Offset/limit pagination** — Simple and correct for small dataset. Cursor pagination deferred until scale requires it.

7. **Sort by created_at, not upvote_count** — Stable pagination. "Most upvoted" sort can be added later with explicit instability trade-off.

8. **Read-time upvote count** — Display shows COUNT(*) from upvotes table; denormalized field for sort index only.

---

**Status:** design-complete
**Author:** Claude
**Date:** 2026-04-07
