# 39 — Badge System

> Admin-assigned badges that shine on the leaderboard — a 7-day spotlight for exceptional contributors.

## Overview

Badges are admin-created awards assigned to users. Unlike achievements (computed from data) or tier badges (computed from tokens), these are **manual, ephemeral rewards** that celebrate specific contributions or behaviors.

### Key Characteristics

| Aspect | Design |
|--------|--------|
| Creation | Admin-only, via `/admin/badges` |
| Assignment | Admin assigns badge to user, effective within cache TTL (~60s) |
| Duration | 7 days from assignment, auto-expires |
| Visibility | Leaderboard rank column, profile avatar area (respects user `is_public`) |
| Stacking | User can have multiple active badges (one per badge definition) |
| Re-assignment | Admin can re-assign same badge after current assignment expires or is revoked |
| History | All assignments preserved with full snapshot for audit |

### User Stories

1. **Admin creates badge**: "I want to create a badge with 1-3 characters that represents a specific honor"
2. **Admin assigns badge**: "I want to award this badge to a user for their contribution"
3. **User sees badge**: "I see my badge on the leaderboard instead of my rank number"
4. **Viewer sees badge**: "I see other users' badges in their profile popup (if user is public)"
5. **Auto-expiry**: "Badge disappears after 7 days without manual intervention"
6. **Admin re-assigns**: "I want to give the same badge again after it expired or was revoked"
7. **Admin revokes badge**: "I want to immediately remove a badge with audit trail"

## Database Schema

### New Tables

```sql
-- scripts/migrations/0XX-badges.sql

-- ============================================================
-- Badge Definitions (admin-created templates, immutable once used)
-- ============================================================

CREATE TABLE IF NOT EXISTS badges (
  id              TEXT PRIMARY KEY,                         -- nanoid
  text            TEXT NOT NULL,                            -- 1-3 characters (e.g., "MVP", "神", "S1")
  shape           TEXT NOT NULL,                            -- shape key: "shield", "star", "hexagon", "circle", "diamond"
  color_bg        TEXT NOT NULL,                            -- background hex: "#3B82F6"
  color_text      TEXT NOT NULL,                            -- text hex: "#FFFFFF"
  description     TEXT,                                     -- admin notes (not shown to users)
  is_archived     INTEGER NOT NULL DEFAULT 0,               -- 1=archived (hidden from assignment UI, still renderable)
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_badges_created ON badges(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_badges_active ON badges(is_archived, created_at DESC);

-- ============================================================
-- Badge Assignments (user-badge links with snapshot + audit)
-- ============================================================

CREATE TABLE IF NOT EXISTS badge_assignments (
  id              TEXT PRIMARY KEY,                         -- nanoid
  badge_id        TEXT NOT NULL REFERENCES badges(id),
  user_id         TEXT NOT NULL REFERENCES users(id),
  
  -- Snapshot of badge appearance at assignment time (immutable audit trail)
  snapshot_text   TEXT NOT NULL,                            -- badge text at assignment
  snapshot_shape  TEXT NOT NULL,                            -- badge shape at assignment
  snapshot_bg     TEXT NOT NULL,                            -- background color at assignment
  snapshot_fg     TEXT NOT NULL,                            -- text color at assignment
  
  assigned_at     TEXT NOT NULL DEFAULT (datetime('now')),  -- assignment timestamp
  expires_at      TEXT NOT NULL,                            -- assigned_at + 7 days
  assigned_by     TEXT NOT NULL REFERENCES users(id),       -- admin who assigned
  note            TEXT,                                     -- admin note for this assignment
  
  -- Revocation tracking (null = not revoked)
  revoked_at      TEXT,                                     -- when revoked (null if active or naturally expired)
  revoked_by      TEXT REFERENCES users(id),                -- admin who revoked (null if not revoked)
  revoke_reason   TEXT,                                     -- reason for revocation
  
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_badge_assignments_user ON badge_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_badge_assignments_badge ON badge_assignments(badge_id);
CREATE INDEX IF NOT EXISTS idx_badge_assignments_expires ON badge_assignments(expires_at);
-- Active = not revoked AND not expired
CREATE INDEX IF NOT EXISTS idx_badge_assignments_active ON badge_assignments(user_id, revoked_at, expires_at);
```

### Schema Notes

- **Badge definitions are immutable once assigned** — no PATCH endpoint; admin can only archive unused badges
- **`is_archived`** hides badge from assignment UI but preserves renderability for historical assignments
- **Snapshot fields** (`snapshot_*`) capture badge appearance at assignment time for audit fidelity
- **`revoked_at/by/reason`** distinguish manual revocation from natural expiry
- **Duplicate prevention** enforced at API layer (check for active assignment before INSERT), not via partial index (SQLite partial indexes with `datetime('now')` don't work as expected)
- **`expires_at`** computed at assignment time: `datetime(assigned_at, '+7 days')`
- **Active badge** = `revoked_at IS NULL AND expires_at > datetime('now')`

### Active Badge Query

```sql
-- Get user's active badges (for leaderboard/profile)
-- Uses snapshot fields for rendering (audit-safe)
SELECT 
  ba.id,
  ba.snapshot_text AS text,
  ba.snapshot_shape AS shape,
  ba.snapshot_bg AS color_bg,
  ba.snapshot_fg AS color_text,
  ba.assigned_at,
  ba.expires_at
FROM badge_assignments ba
WHERE ba.user_id = ?
  AND ba.revoked_at IS NULL
  AND ba.expires_at > datetime('now')
ORDER BY ba.assigned_at DESC;
```

### Assignment Status Derivation

```typescript
type AssignmentStatus = 'active' | 'expired' | 'revoked';

function deriveStatus(assignment: BadgeAssignment): AssignmentStatus {
  if (assignment.revoked_at) return 'revoked';
  if (new Date(assignment.expires_at) <= new Date()) return 'expired';
  return 'active';
}
```

## Badge Visual Design

### Shapes (5 presets)

```
Shield        Star          Hexagon       Circle        Diamond
  ___        *   *           ____           ___          /\
 /   \        \ /           /    \         /   \        /  \
|     |    *--   --*       /      \       |     |      <    >
|     |        |          |        |       \   /        \  /
 \___/        / \          \      /         ---          \/
              *             \____/
```

SVG components with consistent viewBox, badge text centered.

### Color Palettes (6 presets, randomly selected)

| Name | Background | Text | Use Case |
|------|------------|------|----------|
| Ocean | `#3B82F6` (blue-500) | `#FFFFFF` | General |
| Forest | `#22C55E` (green-500) | `#FFFFFF` | Growth |
| Sunset | `#F97316` (orange-500) | `#FFFFFF` | Energy |
| Royal | `#8B5CF6` (violet-500) | `#FFFFFF` | Premium |
| Crimson | `#EF4444` (red-500) | `#FFFFFF` | Urgent |
| Gold | `#EAB308` (yellow-500) | `#1F2937` | Champion |

All colors meet WCAG AA contrast requirements.

### Text Rules

- **Length**: 1-3 characters only (enforced in API + UI)
- **Font**: System UI bold, centered in shape
- **Size**: Responsive based on character count (1 char = larger, 3 chars = smaller)

### Badge Component

```tsx
// packages/web/src/components/badges/badge-icon.tsx

type BadgeShape = 'shield' | 'star' | 'hexagon' | 'circle' | 'diamond';

interface BadgeIconProps {
  text: string;           // 1-3 chars
  shape: BadgeShape;
  colorBg: string;        // hex
  colorText: string;      // hex
  size?: 'sm' | 'md' | 'lg';
}
```

## UI Integration

### 1. Leaderboard Row (Rank Position)

**Current**: `rank-badge.tsx` shows Trophy/Medal/Award icons for top 3, numbers for 4+.

**With badges**: If user has active badge(s), show **first badge** instead of rank indicator.

```
Before:                          After (with badge):
┌────┬────────┬──────────┐      ┌────┬────────┬──────────┐
│ 🏆 │ Alice  │ 1.2M     │      │ 🛡️ │ Alice  │ 1.2M     │
│ 🥈 │ Bob    │ 900K     │  →   │MVP │ Bob    │ 900K     │
│ 🥉 │ Carol  │ 800K     │      │ 🥉 │ Carol  │ 800K     │
│ 4  │ Dave   │ 700K     │      │ ⭐ │ Dave   │ 700K     │
└────┴────────┴──────────┘      │ S1│        │          │
                                └────┴────────┴──────────┘
```

**Logic priority**:
1. If user has active badge → show badge icon
2. Else if rank 1-3 → show trophy/medal/award icon
3. Else → show rank number

### 2. Profile Popup (Avatar Area)

**Location**: `profile-content.tsx`, next to avatar/name header.

**Display**: All active badges shown horizontally, size `sm`.

```
┌─────────────────────────────────┐
│  ┌────┐                         │
│  │    │  Bob Chen    MVP  ⭐     │
│  │ 🧑 │  @bobchen    ───  ──    │
│  └────┘              (badges)   │
│                                 │
│  Stats / Charts / etc.          │
└─────────────────────────────────┘
```

### 3. User Profile Page

If dedicated profile pages exist (e.g., `/u/[slug]`), badges appear in same avatar-adjacent position.

## Admin Interface

### Badge Management Page (`/admin/badges`)

Two tabs:

#### Tab 1: Badge Definitions

| Preview | Text | Shape | Colors | Status | Actions |
|---------|------|-------|--------|--------|---------|
| 🛡️MVP | MVP | Shield | Ocean | Active | [Archive] |
| ⭐神 | 神 | Star | Gold | Active | [Archive] |
| ⬡S1 | S1 | Hexagon | Royal | Archived | [Unarchive] |

**Note**: Badges are immutable once created — no edit/delete. Use Archive to hide from assignment UI (historical assignments remain visible).

#### Tab 2: Assignments

| Badge | User | Status | Assigned | Expires/Ended | By | Actions |
|-------|------|--------|----------|---------------|-----|---------|
| 🛡️MVP | Bob Chen | Active | 2026-04-10 | 2026-04-17 | admin | [Revoke] |
| ⭐神 | Alice Wong | Revoked | 2026-04-08 | 2026-04-09 | admin | — |
| ⬡S1 | Carol Lee | Expired | 2026-04-01 | 2026-04-08 | admin | — |

Filter options: All / Active only / Revoked / Expired

### Create Badge Dialog

Fields:
- **Text** (1-3 chars, required)
- **Shape** (radio: Shield / Star / Hexagon / Circle / Diamond) + [Randomize]
- **Color** (radio: Ocean / Forest / Sunset / Royal / Crimson / Gold) + [Randomize]
- **Description** (optional admin notes)
- **Preview** (live render of badge)

### Assign Badge Dialog

Fields:
- **Badge** (dropdown of active badges only)
- **User** (search with autocomplete)
- **Note** (optional reason for assignment)
- **Duration**: 7 days (fixed, shown as info)
- **Expires**: computed date shown

**Validation**: API rejects if user already has an active assignment of this badge.

### Revoke Badge Dialog

Fields:
- **Reason** (required text explaining revocation)
- **Confirmation** checkbox

Records `revoked_at`, `revoked_by`, `revoke_reason` for audit.

## API Routes

### Badge Definition

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/badges` | List all badge definitions (include archived) |
| POST | `/api/admin/badges` | Create badge definition |
| POST | `/api/admin/badges/[id]/archive` | Archive badge (hide from assignment UI) |
| POST | `/api/admin/badges/[id]/unarchive` | Unarchive badge |

**No PATCH/DELETE** — badges are immutable once created to preserve assignment history integrity.

### Badge Assignment

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/badges/assignments` | List all assignments (filterable: active/revoked/expired/all) |
| POST | `/api/admin/badges/assignments` | Assign badge to user (rejects if active assignment exists) |
| POST | `/api/admin/badges/assignments/[id]/revoke` | Revoke assignment (sets revoked_at/by/reason) |

### Public Badge Query

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/users/[slug]/badges` | Get user's active badges (respects `is_public`) |

**Privacy**: Returns 404 if user has `is_public=0`, consistent with existing `/api/users/[slug]` and `/api/users/[slug]/achievements` behavior.

### Leaderboard Integration

The existing leaderboard API (`/api/leaderboard`) will be extended to include active badges in the response:

```typescript
interface LeaderboardEntry {
  // ... existing fields
  badges?: Array<{
    id: string;
    text: string;
    shape: BadgeShape;
    colorBg: string;
    colorText: string;
  }>;
}
```

**Cache behavior**: Leaderboard uses `s-maxage=60, stale-while-revalidate=120`. Badge changes (assign/revoke/expire) will be visible within ~60s on the main leaderboard. This is acceptable — badges are not time-critical like real-time notifications. The admin UI and profile popup (no cache) show immediate state.

## Worker-Read RPC

Add new RPC handlers in `packages/worker-read`:

```typescript
// badges.get — get active badges for user(s)
// badges.list — admin: list all definitions
// badges.assignments — admin: list assignments with filters
```

## Implementation Phases

### Phase 1: Core Infrastructure

1. Database migration (`0XX-badges.sql`)
2. Worker-read RPC handlers
3. Badge icon component (`badge-icon.tsx`)
4. Type definitions in `@pew/core`

### Phase 2: Admin Interface

1. `/admin/badges` page with tabs (Definitions / Assignments)
2. Create badge dialog (no edit — badges are immutable)
3. Assign badge dialog with user search + duplicate check
4. Assignment list with revoke action + status filters

### Phase 3: Public Display

1. Leaderboard integration (replace rank with badge)
2. Profile popup badge display
3. Profile page badge display (if applicable)

### Phase 4: Polish

1. Badge assignment notifications (optional)
2. Badge history view for users (optional)
3. Expired badge indicators (optional)

## Security Considerations

- All badge management routes require admin auth
- Badge text sanitized (1-3 chars, alphanumeric + limited unicode)
- No HTML/script injection in badge text or description
- Rate limiting on assignment API to prevent spam
- Public badge query respects user `is_public` flag (404 for private users)

## Future Considerations

- **Custom duration**: Let admin specify expiry (1-30 days)
- **Badge categories**: Group badges by purpose (season awards, achievements, special events)
- **User-visible history**: "Past badges" section in profile
- **Notifications**: Email/in-app when badge assigned
- **Badge reactions**: Users can react to others' badges

---

## Decision Log

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | 7-day fixed expiry | Simple UX, creates urgency, encourages re-engagement |
| 2 | Replace rank (not overlay) | Clean visual, rank can be inferred from position |
| 3 | First badge wins on leaderboard | Avoid visual clutter, most recent assignment shown |
| 4 | All badges shown in profile | Profile has more space, users want to show off |
| 5 | Snapshot badge appearance in assignment | Audit fidelity — historical assignments show exact appearance at assignment time |
| 6 | Badges immutable once created | Prevents "rewriting history"; use archive to hide from UI |
| 7 | Explicit revoke tracking (revoked_at/by/reason) | Distinguish manual revocation from natural expiry for audit |
| 8 | Unique active assignment per (badge, user) | Prevent duplicate stacking; re-assign only after revoke/expire |
| 9 | Respect user is_public for badge API | Consistent with existing profile privacy model |
| 10 | Accept ~60s cache delay on leaderboard | Badges aren't time-critical; admin UI shows immediate state |

---

## Test Matrix

### Privacy Tests

| Scenario | Expected |
|----------|----------|
| GET `/api/users/[slug]/badges` for public user | 200 + badge array |
| GET `/api/users/[slug]/badges` for private user | 404 |
| Leaderboard includes badges for public users only | badges array present for public, empty/missing for private |

### Assignment Uniqueness Tests

| Scenario | Expected |
|----------|----------|
| Assign badge A to user X (no existing) | 200, assignment created |
| Assign badge A to user X (active exists) | 409 Conflict |
| Assign badge A to user X (previous revoked) | 200, new assignment created |
| Assign badge A to user X (previous expired) | 200, new assignment created |

### Revocation vs Expiry Tests

| Scenario | Status | revoked_at | revoked_by |
|----------|--------|------------|------------|
| Active, not expired | active | NULL | NULL |
| Past expires_at, not revoked | expired | NULL | NULL |
| Admin clicked revoke | revoked | timestamp | admin_id |
| Query history for user | All three states distinguishable | | |

### Badge Immutability Tests

| Scenario | Expected |
|----------|----------|
| POST `/api/admin/badges` | 201, badge created |
| PATCH `/api/admin/badges/[id]` | 404 or 405 (no such route) |
| DELETE `/api/admin/badges/[id]` | 404 or 405 (no such route) |
| POST `/api/admin/badges/[id]/archive` | 200, is_archived=1 |
| Archived badge still renders in historical assignments | snapshot_* fields used, renders correctly |

### Leaderboard Cache Tests

| Scenario | Expected |
|----------|----------|
| Assign badge, check admin UI | Immediate visibility |
| Assign badge, check leaderboard | Visible within 60-180s (cache TTL + stale) |
| Revoke badge, check admin UI | Immediate removal |
| Badge expires naturally, leaderboard refresh | Removed within cache TTL |
