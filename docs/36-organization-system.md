# Organization System

> Organizations are interest-based groups that users can freely join and leave.
> Unlike Teams (small competition units), Orgs are open communities for leaderboard filtering.
> Leaderboard scope dropdown upgraded to a single mutually-exclusive selector: Global / Org / Team.

## Status

| # | Commit | Description | Status |
|---|--------|-------------|--------|
| 1 | `docs: add organization system plan` | This document | done |
| 2 | `feat: add organizations migration` | `019-organizations.sql` | done |
| 3 | `feat: add organization types to @pew/core` | Org-related type definitions | done |
| 4 | `feat: add admin organizations CRUD API` | `GET/POST/PATCH/DELETE /api/admin/organizations` | done |
| 5 | `test: add L1 tests for admin organizations API` | Admin orgs CRUD unit tests | done |
| 6 | `feat: add organization logo upload` | `POST /api/admin/organizations/[orgId]/logo` | done |
| 7 | `feat: add admin organization members API` | `POST/DELETE /api/admin/organizations/[orgId]/members` | done |
| 8 | `feat: add admin organization management page` | `/admin/organizations` CRUD UI | done |
| 9 | `feat: add user organization APIs` | List all orgs, list my orgs, view members, join, leave | done |
| 10 | `test: add L1 tests for user org APIs` | Join/leave/list unit tests | done |
| 11 | `feat: add organizations settings page` | `/settings/organizations` with join/leave UI | done |
| 12 | `feat: add organization leaderboard API` | `GET /api/leaderboard?org=xxx` with EXISTS filter | done |
| 13 | `test: add L1 tests for organization leaderboard` | Org-scoped aggregation tests | done |
| 14 | `feat: upgrade leaderboard scope dropdown` | Org + Team selector; auth-gated; localStorage persistence | done |
| 15 | `test: add L2 E2E tests for organization flow` | End-to-end organization scenarios | |

---

## Problem

Current pew has a "Team" concept for small internal groups (max 5 members by default),
but lacks a larger-scale grouping mechanism for interest communities.

**Pain points:**

1. Users with shared interests want to see a community-wide leaderboard, but Teams are
   too small and invite-only for this purpose.
2. No way to filter leaderboard by interest group or community.
3. Leaderboard scope dropdown only supports Team filter; no broader community dimension.
4. Users cannot self-manage group memberships beyond their own Teams.

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Naming | Organization (Org) | Distinguishes from Team; familiar term for group membership |
| Nature | Interest-based community | Open groups, no identity verification, self-service join/leave |
| Creation rights | System admin only (`is_admin`) | Prevents namespace pollution; admin curates available orgs |
| Member management | System admin only | Admins can add/remove members; no org-level admin role |
| Joining | User self-service (join via settings) | Users browse public org list and join freely |
| Leaving | User self-service | Users can leave any org they belong to |
| Multi-org | Yes (many-to-many) | Users may join multiple interest communities |
| Member visibility | Logged-in users only | Any authenticated user can view any org's member list |
| Org vs Team | Independent | Orgs are open communities; Teams are invite-only competition units |
| Logo storage | Cloudflare R2 | Consistent with existing team logo storage pattern |
| Leaderboard scope | Org + Team combined dropdown | Single selector with grouped options; localStorage persistence |

---

## Database Schema

### Migration: `019-organizations.sql`

```sql
-- ============================================================
-- Organizations
-- ============================================================

CREATE TABLE IF NOT EXISTS organizations (
  id          TEXT PRIMARY KEY,           -- UUID
  name        TEXT NOT NULL,              -- Display name, e.g. "Anthropic"
  slug        TEXT NOT NULL UNIQUE,       -- URL-safe, e.g. "anthropic"
  logo_url    TEXT,                       -- Stable R2 public URL (not presigned)
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_org_slug ON organizations(slug);

-- ============================================================
-- Organization memberships (many-to-many)
-- ============================================================

CREATE TABLE IF NOT EXISTS organization_members (
  id        TEXT PRIMARY KEY,             -- UUID
  org_id    TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_org ON organization_members(org_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id);
```

**Design notes:**

- No `invite_code` field — users join by selecting from a public list.
- No `role` field — all member management is done by system admins (`is_admin`).
- `logo_url` stores stable public URL (like team logos), not presigned upload URLs.
- `ON DELETE CASCADE` ensures cleanup when org or user is deleted.

---

## API Design

### Admin APIs (requires `is_admin`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/organizations` | List all organizations with member counts |
| POST | `/api/admin/organizations` | Create new organization (name, slug) |
| PATCH | `/api/admin/organizations/[orgId]` | Update org details (name, slug) |
| DELETE | `/api/admin/organizations/[orgId]` | Delete organization and all memberships |
| POST | `/api/admin/organizations/[orgId]/logo` | Upload org logo (multipart form) |
| POST | `/api/admin/organizations/[orgId]/members` | Add user to org (body: `{ userId }`) |
| DELETE | `/api/admin/organizations/[orgId]/members/[userId]` | Remove user from org |

### User APIs (authenticated)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/organizations` | List all organizations with member counts |
| GET | `/api/organizations/mine` | List orgs the current user belongs to |
| GET | `/api/organizations/[orgId]/members` | List members of an organization |
| POST | `/api/organizations/[orgId]/join` | Join an organization |
| DELETE | `/api/organizations/[orgId]/leave` | Leave an organization |

All user APIs require authentication. Anonymous users cannot access org data.

### Leaderboard API (public with scope restrictions)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/leaderboard` | Global leaderboard (default) |
| GET | `/api/leaderboard?org=xxx` | Leaderboard filtered by organization |
| GET | `/api/leaderboard?team=xxx` | Leaderboard filtered by team |

**Scope parameter contract (mutually exclusive):**

- `?org=<org_id>` — filter to users in this organization
- `?team=<team_id>` — filter to users in this team (existing behavior)
- No parameter — global leaderboard

Only one of `org` or `team` may be provided. If both are passed, return 400 error.
Parameter name follows existing convention (`team`, not `teamId`).

**Anonymous access policy:**

The leaderboard API itself remains public (no auth required), but:
- Anonymous requests with `org` or `team` params are **ignored** — treated as global
- This matches the UI behavior where anonymous users cannot see the scope dropdown
- No 401/403 errors; just silently fall back to global for simpler client handling

**Response shape (updated):**

```typescript
interface LeaderboardResponse {
  period: string;
  scope: 'global' | 'org' | 'team';  // NEW: actual applied scope
  scopeId?: string;                   // NEW: org_id or team_id when scoped
  entries: LeaderboardEntry[];
}
```

The `scope` and `scopeId` fields let clients verify which scope was actually applied
(important for anonymous fallback and debugging).

**Cache-Control policy:**

| Condition | Cache-Control |
|-----------|---------------|
| No scope params (global) | `public, s-maxage=60, stale-while-revalidate=120` |
| Any `org` or `team` param present | `private, no-store` |

Scoped requests use `private, no-store` regardless of auth status because:
1. Anonymous users get silently downgraded to global (different content than logged-in)
2. Different logged-in users may have different membership visibility in future
3. Follows existing team-scoped leaderboard behavior

**Implementation notes:**

- Update `LeaderboardData` type in `use-leaderboard.ts` to include `scope` and `scopeId`
- Update `UseLeaderboardOptions` to accept `orgId?: string | null` alongside `teamId`
- Add L1 tests asserting response shape includes scope fields

---

## UI Changes

### 1. Admin Dashboard: `/admin/organizations`

New admin page for organization management:

- **List view**: Table of orgs with columns: Name, Slug, Logo, Members, Created At
- **Create button**: Opens modal for name/slug input
- **Row actions**: Edit (name, slug, logo), View members, Delete
- **Member modal**: Lists members with remove button; search to add new members

**Logo upload flow (same as team logos):**
1. Admin selects image file in edit modal
2. Frontend sends file to `POST /api/admin/organizations/[orgId]/logo`
3. Backend resizes/compresses, uploads to R2, gets stable CDN URL
4. Backend persists URL to `organizations.logo_url`
5. Response returns new `logoUrl` for UI update

### 2. User Settings: `/settings/organizations`

New dedicated page for organization management:

```
┌─────────────────────────────────────────────────────────────┐
│ Organizations                                               │
│ Join or leave organizations to filter your leaderboard.    │
├─────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ [Logo] Anthropic              12 members   [✓ Joined]   │ │
│ │ [Logo] AI Community           45 members   [✓ Joined]   │ │
│ │ [Logo] OpenAI                 28 members   [  Join  ]   │ │
│ │ [Logo] Vercel                  8 members   [  Join  ]   │ │
│ │ [Logo] Railway                15 members   [  Join  ]   │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

- Lists all organizations with member counts
- Toggle button: "Joined" (green, click to leave) / "Join" (outline, click to join)
- Clicking on an org row opens a modal showing member list

### 3. Leaderboard: Scope Dropdown Upgrade

Current dropdown only shows Teams. New design:

```
┌─────────────────────────────────────┐
│ [Globe] Global                    ▼ │
└─────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────┐
│ ○ [Globe] Global                    │
├─────────────────────────────────────┤
│ Organizations                       │
│   ○ [Logo] Anthropic                │
│   ○ [Logo] AI Community             │
├─────────────────────────────────────┤
│ Teams                               │
│   ○ [Logo] Team Alpha               │
│   ○ [Logo] Team Beta                │
└─────────────────────────────────────┘
```

**Visibility rules:**

- **Logged-out users**: Scope dropdown is **hidden**; always show Global leaderboard.
  Do not fetch `/api/organizations` or `/api/teams` for anonymous visitors.
- **Logged-in users**: Show scope dropdown with user's orgs and teams.

**Behavior (logged-in only):**

- Single-select: Global, one Org, or one Team (mutually exclusive)
- Group headers ("Organizations", "Teams") are non-selectable
- Orgs come before Teams in the list
- **localStorage persistence**: `pew:leaderboard:scope` stores `{ type: 'global' | 'org' | 'team', id?: string }`
- On mount (logged-in only):
  1. Read from localStorage
  2. If type is `org`, verify org exists in user's org list
  3. If type is `team`, verify team exists in user's team list
  4. If verification fails or localStorage empty, default to `'global'`
- **Logged-out**: Skip localStorage read/write entirely; fixed to Global

**Why remove "by Team" toggle?**

Current design has a separate toggle for Team view. This is being replaced by the
unified dropdown because:
1. Single control point is more intuitive than toggle + dropdown combo
2. Org and Team scopes are mutually exclusive, better represented as a single selector
3. localStorage persistence applies uniformly to the single scope state

---

## Type Definitions

Add to `packages/core/src/types.ts`:

```typescript
// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

/** Organization entity */
export interface Organization {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Organization with member count (for admin list) */
export interface OrganizationWithCount extends Organization {
  memberCount: number;
}

/** Organization membership */
export interface OrganizationMember {
  id: string;
  orgId: string;
  userId: string;
  joinedAt: string;
}

/** Organization member with user details (for member list) */
export interface OrganizationMemberWithUser extends OrganizationMember {
  user: {
    id: string;
    name: string | null;
    image: string | null;
    slug: string | null;
  };
}

/** Lightweight org info for dropdown */
export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
}
```

---

## Leaderboard Query Changes

The existing leaderboard API aggregates `usage_records` by user. The current team
filter uses a JOIN which can cause fan-out if users have multiple memberships.

**Correct approach: filter user set first, then aggregate.**

```sql
-- Organization filter (org and team are mutually exclusive)
-- Step 1: Get user IDs in the target org/team
-- Step 2: Aggregate usage only for those users

-- Option A: EXISTS subquery (no fan-out risk)
SELECT u.id, SUM(ur.total_tokens) as total_tokens, ...
FROM usage_records ur
JOIN users u ON ur.user_id = u.id
WHERE u.is_public = 1
  AND ur.hour_start >= :startTime
  AND EXISTS (
    SELECT 1 FROM organization_members om
    WHERE om.user_id = u.id AND om.org_id = :orgId
  )
GROUP BY u.id
ORDER BY total_tokens DESC
LIMIT :limit

-- Option B: CTE to pre-filter users (cleaner for complex queries)
WITH target_users AS (
  SELECT user_id FROM organization_members WHERE org_id = :orgId
)
SELECT u.id, SUM(ur.total_tokens) as total_tokens, ...
FROM usage_records ur
JOIN users u ON ur.user_id = u.id
WHERE u.is_public = 1
  AND ur.hour_start >= :startTime
  AND u.id IN (SELECT user_id FROM target_users)
GROUP BY u.id
ORDER BY total_tokens DESC
LIMIT :limit
```

**Note:** The existing team filter should also be refactored to use EXISTS/CTE
pattern to prevent aggregation fan-out when users belong to multiple teams.

---

## localStorage Schema

Key: `pew:leaderboard:scope`

```typescript
interface LeaderboardScopePreference {
  type: 'global' | 'org' | 'team';
  id?: string;  // org_id or team_id when type is not 'global'
}
```

**Restore logic (logged-in users only):**

1. Check authentication state first
2. If not logged in: skip localStorage entirely, use `'global'`
3. If logged in:
   - Read from localStorage
   - If type is `org`, verify org exists in user's org list (from `/api/organizations/mine`)
   - If type is `team`, verify team exists in user's team list (from `/api/teams`)
   - If verification fails, fall back to `'global'`
   - If localStorage is empty, default to `'global'`

**Important:** Anonymous users never read/write scope preferences. The dropdown
is hidden and no org/team API calls are made.

---

## Migration Path

1. **No breaking changes**: Existing Team functionality remains unchanged.
2. **Opt-in adoption**: Users join Orgs via Settings page; no forced migration.
3. **Leaderboard backward compatible**: `?team=xxx` continues to work;
   `?org=xxx` is a new additive parameter (mutually exclusive with `team`).

---

## Security Considerations

| Concern | Mitigation |
|---------|------------|
| Spam joining | Rate limit `/api/organizations/[orgId]/join` (10 req/min per user) |
| Unauthorized org creation | Admin-only API, `is_admin` check |
| Unauthorized member removal | Admin-only API for forced removal; users can only self-leave |
| Logo upload | Server-side processing; validate Content-Type, resize/compress before R2 storage |
| Member list access | Requires authentication; anonymous users cannot enumerate members |
| Scoped leaderboard abuse | Anonymous requests with scope params silently degrade to global |

---

## Future Considerations

1. **Organization public profile page (e.g., `/org/anthropic`)**
   - Not in v1; orgs are primarily for leaderboard filtering
   - Could add org profile with aggregated stats, member showcase

2. **Organization-level analytics**
   - Aggregate token usage across all org members
   - Compare org performance over time
