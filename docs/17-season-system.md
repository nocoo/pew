# 赛季系统 (Season System)

> 管理员创建并管理赛季（如 S1、S2），战队队长报名参赛。
> Leaderboard 新增赛季页面，按战队综合排名展示，可展开查看队员贡献。
> 赛季结束后存储 snapshot，历史赛季成绩永久可查。

## Status

| # | Commit | Description | Status |
|---|--------|-------------|--------|
| 1 | `docs: add season system plan` | This document | done |
| 2 | `feat: add seasons and season_teams migration` | `006-seasons.sql` | done |
| 3 | `feat: add season types to @pew/core` | Season-related type definitions | done |
| 4 | `feat: add admin seasons CRUD API` | `GET/POST/PATCH /api/admin/seasons` | done |
| 5 | `test: add L1 tests for admin seasons API` | Admin seasons CRUD unit tests | done |
| 6 | `feat: add season registration API` | `POST/DELETE /api/seasons/[seasonId]/register` | |
| 7 | `test: add L1 tests for season registration` | Registration + auth unit tests | |
| 8 | `feat: add season leaderboard API` | `GET /api/seasons/[seasonId]/leaderboard` | |
| 9 | `test: add L1 tests for season leaderboard` | Leaderboard aggregation + ranking tests | |
| 10 | `feat: add season snapshot API` | `POST /api/admin/seasons/[seasonId]/snapshot` | |
| 11 | `test: add L1 tests for season snapshot` | Snapshot creation + idempotency tests | |
| 12 | `feat: add season list API` | `GET /api/seasons` | |
| 13 | `test: add L1 tests for season list API` | Public season listing tests | |
| 14 | `feat: add season leaderboard page` | `/leaderboard/seasons` + `/leaderboard/seasons/[seasonId]` | |
| 15 | `feat: add season navigation to leaderboard` | Season tab in leaderboard controls | |
| 16 | `feat: add admin season management page` | `/admin/seasons` CRUD UI | |
| 17 | `feat: add season registration UI for team owners` | Team detail page register button | |

---

## Problem

当前 Leaderboard 按时间段（周/月/全部）展示个人或战队排名，缺少"竞赛"概念。
用户需要一种有明确开始/结束时间的"赛季"机制，让战队之间产生竞争氛围，
赛季结束后保留历史成绩作为永久记录。

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| 参赛单位 | 仅战队 | 赛季强调团队协作；个人排名已有现有 leaderboard |
| 队长 = 报名人 | team_members.role = 'owner' | 不引入新角色，复用现有 owner 机制 |
| 排名指标 | total_tokens | 与现有 leaderboard 一致，简单直观 |
| 时间存储 | UTC，精确到天 | `start_date` / `end_date` 存 `YYYY-MM-DD` 格式 |
| 时间展示 | 管理员界面时区 | 前端根据管理员/用户本地时区转化展示 |
| 中途加入数据 | 从赛季开始日算起 | 公平竞争：所有队伍统一计算赛季日期范围内的 usage |
| Snapshot 粒度 | 队伍总分 + 队员明细 | 赛季结束后可查看每位队员贡献 |
| Snapshot 触发 | 管理员手动触发 | 避免自动化复杂度，admin API 调用即可 |
| 赛季状态机 | upcoming → active → ended | 由 start_date/end_date 与当前日期比较推导，无需手动切换 |
| 赛季命名 | 管理员自定义 (如 S1, S2) | `slug` 字段用于 URL，`name` 用于展示 |

---

## Database Schema

### Migration: `006-seasons.sql`

```sql
-- ============================================================
-- Seasons
-- ============================================================

CREATE TABLE IF NOT EXISTS seasons (
  id          TEXT PRIMARY KEY,           -- UUID
  name        TEXT NOT NULL,              -- Display name, e.g. "Season 1"
  slug        TEXT NOT NULL UNIQUE,       -- URL-safe, e.g. "s1"
  start_date  TEXT NOT NULL,              -- YYYY-MM-DD (UTC)
  end_date    TEXT NOT NULL,              -- YYYY-MM-DD (UTC), inclusive
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- Season team registrations
-- ============================================================

CREATE TABLE IF NOT EXISTS season_teams (
  id            TEXT PRIMARY KEY,         -- UUID
  season_id     TEXT NOT NULL REFERENCES seasons(id),
  team_id       TEXT NOT NULL REFERENCES teams(id),
  registered_by TEXT NOT NULL REFERENCES users(id),  -- must be team owner
  registered_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(season_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_season_teams_season ON season_teams(season_id);
CREATE INDEX IF NOT EXISTS idx_season_teams_team   ON season_teams(team_id);

-- ============================================================
-- Season snapshots (frozen results after season ends)
-- ============================================================

CREATE TABLE IF NOT EXISTS season_snapshots (
  id          TEXT PRIMARY KEY,           -- UUID
  season_id   TEXT NOT NULL REFERENCES seasons(id),
  team_id     TEXT NOT NULL REFERENCES teams(id),
  rank        INTEGER NOT NULL,
  total_tokens      INTEGER NOT NULL DEFAULT 0,
  input_tokens      INTEGER NOT NULL DEFAULT 0,
  output_tokens     INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(season_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_snapshot_season ON season_snapshots(season_id);

-- ============================================================
-- Season member snapshots (per-member contribution detail)
-- ============================================================

CREATE TABLE IF NOT EXISTS season_member_snapshots (
  id            TEXT PRIMARY KEY,         -- UUID
  season_id     TEXT NOT NULL REFERENCES seasons(id),
  team_id       TEXT NOT NULL REFERENCES teams(id),
  user_id       TEXT NOT NULL REFERENCES users(id),
  total_tokens        INTEGER NOT NULL DEFAULT 0,
  input_tokens        INTEGER NOT NULL DEFAULT 0,
  output_tokens       INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(season_id, team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_member_snapshot_season ON season_member_snapshots(season_id);
CREATE INDEX IF NOT EXISTS idx_member_snapshot_team   ON season_member_snapshots(season_id, team_id);
```

### 赛季状态推导 (无需 status 列)

```
today < start_date  → "upcoming"
start_date <= today <= end_date  → "active"
today > end_date  → "ended"
```

所有日期比较基于 UTC 日期（`YYYY-MM-DD`）。前端获取到 `start_date` / `end_date` 后
根据用户本地时区格式化展示。

---

## API Design

### 1. Admin: Season CRUD

#### `GET /api/admin/seasons`

列出所有赛季（管理员专用）。

**Response:**
```json
{
  "seasons": [
    {
      "id": "uuid",
      "name": "Season 1",
      "slug": "s1",
      "start_date": "2026-04-01",
      "end_date": "2026-04-30",
      "status": "active",
      "team_count": 5,
      "created_at": "2026-03-15T00:00:00Z"
    }
  ]
}
```

`status` 由服务端根据当前 UTC 日期推导，不存入数据库。

#### `POST /api/admin/seasons`

创建新赛季。

**Request body:**
```json
{
  "name": "Season 1",
  "slug": "s1",
  "start_date": "2026-04-01",
  "end_date": "2026-04-30"
}
```

**Validation:**
- `name`: 1-64 字符
- `slug`: 1-32 字符，仅 `[a-z0-9-]`，唯一
- `start_date`: `YYYY-MM-DD` 格式
- `end_date`: `YYYY-MM-DD` 格式，必须 >= `start_date`
- 不校验日期是否在未来（允许创建过去的赛季用于回溯测试）

#### `PATCH /api/admin/seasons/[seasonId]`

更新赛季信息。只有 `upcoming` 状态的赛季可修改日期；
`active` / `ended` 赛季只能修改 `name`。

**Request body:** (all optional)
```json
{
  "name": "Season 1 (Updated)",
  "start_date": "2026-04-05",
  "end_date": "2026-05-05"
}
```

### 2. Season Registration

#### `POST /api/seasons/[seasonId]/register`

战队报名参赛。调用者必须是 team owner。

**Request body:**
```json
{
  "team_id": "team-uuid"
}
```

**Validation:**
- 赛季存在且状态为 `upcoming` 或 `active`（已结束不可报名）
- 调用者是该 team 的 owner
- 该 team 未重复报名同一赛季
- team_id 有效

**Response (201):**
```json
{
  "id": "registration-uuid",
  "season_id": "season-uuid",
  "team_id": "team-uuid",
  "registered_at": "2026-03-20T12:00:00Z"
}
```

#### `DELETE /api/seasons/[seasonId]/register`

退出赛季。只有 `upcoming` 状态的赛季可退出；`active` 后不可退出。

**Request body:**
```json
{
  "team_id": "team-uuid"
}
```

### 3. Season Leaderboard

#### `GET /api/seasons/[seasonId]/leaderboard`

赛季排行榜。公开接口，无需登录。

**Query params:**
- `expand=members` — 同时返回每支队伍的队员贡献明细

**逻辑:**
- 如果赛季已结束且存在 snapshot：直接从 `season_snapshots` + `season_member_snapshots` 读取
- 否则（进行中或无 snapshot）：实时聚合 `usage_records`

**实时聚合 SQL:**
```sql
SELECT
  st.team_id,
  t.name AS team_name,
  t.slug AS team_slug,
  SUM(ur.total_tokens) AS total_tokens,
  SUM(ur.input_tokens) AS input_tokens,
  SUM(ur.output_tokens) AS output_tokens,
  SUM(ur.cached_input_tokens) AS cached_input_tokens
FROM season_teams st
JOIN teams t ON t.id = st.team_id
JOIN team_members tm ON tm.team_id = st.team_id
JOIN usage_records ur ON ur.user_id = tm.user_id
WHERE st.season_id = ?
  AND ur.hour_start >= ?          -- season start_date as ISO datetime
  AND ur.hour_start < ?           -- season end_date + 1 day as ISO datetime
GROUP BY st.team_id
ORDER BY total_tokens DESC
```

**注意**: `end_date` 是 inclusive（包含当天），所以 SQL 中用 `< end_date + 1 day`。

**队员明细 SQL** (当 `expand=members`)：
```sql
SELECT
  tm.user_id,
  u.name,
  u.nickname,
  u.image,
  SUM(ur.total_tokens) AS total_tokens,
  SUM(ur.input_tokens) AS input_tokens,
  SUM(ur.output_tokens) AS output_tokens,
  SUM(ur.cached_input_tokens) AS cached_input_tokens
FROM team_members tm
JOIN users u ON u.id = tm.user_id
JOIN usage_records ur ON ur.user_id = tm.user_id
WHERE tm.team_id = ?
  AND ur.hour_start >= ?
  AND ur.hour_start < ?
GROUP BY tm.user_id
ORDER BY total_tokens DESC
```

**Response:**
```json
{
  "season": {
    "id": "uuid",
    "name": "Season 1",
    "slug": "s1",
    "start_date": "2026-04-01",
    "end_date": "2026-04-30",
    "status": "active",
    "is_snapshot": false
  },
  "entries": [
    {
      "rank": 1,
      "team": {
        "id": "team-uuid",
        "name": "Team Alpha",
        "slug": "team-alpha"
      },
      "total_tokens": 15000000,
      "input_tokens": 10000000,
      "output_tokens": 5000000,
      "cached_input_tokens": 3000000,
      "members": [
        {
          "name": "Alice",
          "image": "https://...",
          "total_tokens": 8000000,
          "input_tokens": 5000000,
          "output_tokens": 3000000,
          "cached_input_tokens": 2000000
        },
        {
          "name": "Bob",
          "image": "https://...",
          "total_tokens": 7000000,
          "input_tokens": 4000000,
          "output_tokens": 2000000,
          "cached_input_tokens": 1000000
        }
      ]
    }
  ]
}
```

`members` 数组仅在 `expand=members` 时返回。`is_snapshot` 表示数据来源：
`true` 表示来自冻结的 snapshot 表，`false` 表示实时聚合。

### 4. Season Snapshot

#### `POST /api/admin/seasons/[seasonId]/snapshot`

管理员手动触发 snapshot 生成。只有 `ended` 状态的赛季可创建 snapshot。

**Behavior:**
1. 校验赛季状态为 `ended`
2. 聚合所有参赛战队的 token 数据（同 leaderboard 实时聚合逻辑）
3. 计算排名
4. 写入 `season_snapshots`（队伍级别）和 `season_member_snapshots`（队员级别）
5. 幂等：如果 snapshot 已存在，先删除旧数据再重新生成（支持重跑修正）

**Response (201):**
```json
{
  "season_id": "uuid",
  "team_count": 5,
  "member_count": 23,
  "created_at": "2026-05-01T00:00:00Z"
}
```

### 5. Public Season List

#### `GET /api/seasons`

列出所有赛季（公开接口）。不返回 admin-only 的字段。

**Query params:**
- `status` — 可选过滤: `upcoming`, `active`, `ended`

**Response:**
```json
{
  "seasons": [
    {
      "id": "uuid",
      "name": "Season 1",
      "slug": "s1",
      "start_date": "2026-04-01",
      "end_date": "2026-04-30",
      "status": "ended",
      "team_count": 5,
      "has_snapshot": true
    }
  ]
}
```

---

## Frontend Design

### 页面结构

```
/leaderboard                     <- 现有页面，新增 "Seasons" 入口
/leaderboard/seasons             <- 赛季列表页
/leaderboard/seasons/[slug]      <- 单赛季排行榜（slug 如 "s1"）
/admin/seasons                   <- 管理员赛季管理页
```

### `/leaderboard` 变更

在现有 controls row（Period tabs + Scope dropdown）旁，
新增一个 "Seasons" 链接，导航到 `/leaderboard/seasons`。

```
+-------------------------------------+
| pew Leaderboard        Seasons ->   |
|                                     |
| [This Week] [This Month] [All]      |
| [Global v]                          |
| ...existing leaderboard...          |
+-------------------------------------+
```

### `/leaderboard/seasons` — 赛季列表

```
+-------------------------------------+
| pew Seasons                         |
|                                     |
| * Season 1  Apr 1 - Apr 30, 2026   |
|   5 teams competing · Active        |
|                                     |
| * Season 2  May 1 - May 31, 2026   |
|   3 teams registered · Upcoming     |
|                                     |
| * Preseason  Mar 1 - Mar 31, 2026  |
|   Ended · View results ->          |
+-------------------------------------+
```

状态标记：
- Active — 进行中 (green badge)
- Upcoming — 即将开始 (amber badge)
- Ended — 已结束 (gray badge)

### `/leaderboard/seasons/[slug]` — 赛季排行榜

```
+-------------------------------------+
| <- Back   Season 1                  |
| Apr 1 - Apr 30, 2026 · Active      |
|                                     |
| 1  Team Alpha             15.0M    |
|    +- Alice    8.0M                 |
|    +- Bob      7.0M                 |
|                                     |
| 2  Team Beta              12.3M    |
|    +- Charlie  6.5M                 |
|    +- Dave     5.8M                 |
|                                     |
| 3  Team Gamma              9.1M    |
|    ...                              |
+-------------------------------------+
```

- 默认展开所有队伍的队员明细（赛季排行榜的核心价值）
- 可折叠/展开队员列表
- 赛季结束且有 snapshot 时显示 "Final Results" 标记
- 进行中的赛季显示 "Live" 标记，数据实时聚合

### `/admin/seasons` — 管理页面

- 赛季列表（含状态、队伍数、操作按钮）
- "Create Season" 表单（name, slug, start_date, end_date）
- 编辑赛季（inline or modal）
- "Generate Snapshot" 按钮（仅 ended 赛季可用）
- 查看已注册队伍列表

### Team Detail 页面变更

在 team detail 页面中，为 team owner 展示 "Register for Season" 按钮：

- 列出可报名的赛季（upcoming + active）
- 已报名的赛季显示 "Registered" 标记
- upcoming 赛季显示 "Withdraw" 选项

---

## Commit Details

### Commit 1: `docs: add season system plan`

This document.

**Files changed:**
- `docs/17-season-system.md` (new)

---

### Commit 2: `feat: add seasons and season_teams migration`

Create migration script with all four season-related tables.

**Files changed:**
- `scripts/migrations/006-seasons.sql` (new)

**Tables created:**
- `seasons` — season definitions
- `season_teams` — team registrations per season
- `season_snapshots` — frozen team-level results
- `season_member_snapshots` — frozen member-level contributions

---

### Commit 3: `feat: add season types to @pew/core`

Add Season-related TypeScript types for shared use across packages.

**Files changed:**
- `packages/core/src/types.ts`

**New types:**

```typescript
/** Season status derived from dates, not stored */
export type SeasonStatus = "upcoming" | "active" | "ended";

/** Season definition */
export interface Season {
  id: string;
  name: string;
  slug: string;
  /** YYYY-MM-DD (UTC) */
  startDate: string;
  /** YYYY-MM-DD (UTC), inclusive */
  endDate: string;
  status: SeasonStatus;
  teamCount: number;
  createdAt: string;
}

/** Season team registration */
export interface SeasonTeamRegistration {
  id: string;
  seasonId: string;
  teamId: string;
  registeredBy: string;
  registeredAt: string;
}

/** Season leaderboard entry (team level) */
export interface SeasonLeaderboardEntry {
  rank: number;
  team: {
    id: string;
    name: string;
    slug: string;
  };
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  members?: SeasonMemberContribution[];
}

/** Individual member contribution within a team */
export interface SeasonMemberContribution {
  name: string | null;
  image: string | null;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}
```

---

### Commit 4: `feat: add admin seasons CRUD API`

**Files changed:**
- `packages/web/src/app/api/admin/seasons/route.ts` (new)
- `packages/web/src/app/api/admin/seasons/[seasonId]/route.ts` (new)

**`GET /api/admin/seasons`**
- Requires admin auth (`resolveAdmin`)
- Lists all seasons with computed `status` and `team_count`
- Sorted by `start_date DESC`

**`POST /api/admin/seasons`**
- Requires admin auth
- Validates name, slug, start_date, end_date
- Generates UUID for `id`
- Sets `created_by` to admin user ID

**`PATCH /api/admin/seasons/[seasonId]`**
- Requires admin auth
- Validates season exists
- `upcoming`: can modify name, slug, start_date, end_date
- `active` / `ended`: can only modify name

**`no such table` fallback:** 503 with helpful message.

---

### Commit 5: `test: add L1 tests for admin seasons API`

**Files changed:**
- `packages/web/src/__tests__/admin-seasons.test.ts` (new)

**Test cases:**

```
describe("GET /api/admin/seasons")
  should return all seasons with computed status
  should reject non-admin users
  should handle no-such-table gracefully

describe("POST /api/admin/seasons")
  should create season with valid data
  should reject duplicate slug
  should reject end_date < start_date
  should reject invalid date format
  should reject non-admin users

describe("PATCH /api/admin/seasons/[seasonId]")
  should allow name change on active season
  should allow date change on upcoming season
  should reject date change on active season
  should reject date change on ended season
  should return 404 for non-existent season
```

---

### Commit 6: `feat: add season registration API`

**Files changed:**
- `packages/web/src/app/api/seasons/[seasonId]/register/route.ts` (new)

**`POST /api/seasons/[seasonId]/register`**
- Requires auth (`resolveUser`)
- Validates: season exists, status is upcoming/active, user is team owner, not already registered
- Inserts into `season_teams`

**`DELETE /api/seasons/[seasonId]/register`**
- Requires auth
- Validates: season is upcoming, user is team owner, registration exists
- Deletes from `season_teams`

---

### Commit 7: `test: add L1 tests for season registration`

**Files changed:**
- `packages/web/src/__tests__/season-registration.test.ts` (new)

**Test cases:**

```
describe("POST /api/seasons/[seasonId]/register")
  should register team when user is owner and season is upcoming
  should register team when season is active
  should reject when season is ended
  should reject when user is not team owner
  should reject when team is already registered
  should reject when season does not exist
  should reject unauthenticated requests

describe("DELETE /api/seasons/[seasonId]/register")
  should withdraw team from upcoming season
  should reject withdrawal from active season
  should reject when user is not team owner
  should reject when registration does not exist
```

---

### Commit 8: `feat: add season leaderboard API`

**Files changed:**
- `packages/web/src/app/api/seasons/[seasonId]/leaderboard/route.ts` (new)

**`GET /api/seasons/[seasonId]/leaderboard`**
- Public endpoint (no auth required)
- Query param: `expand=members` for per-member breakdown
- If snapshot exists: read from `season_snapshots` + `season_member_snapshots`
- Otherwise: real-time aggregation from `usage_records`
- Date range: `start_date 00:00:00Z` to `end_date+1 00:00:00Z` (end_date inclusive)
- Response includes `is_snapshot` boolean

**Key implementation detail:**
Snapshot detection: `SELECT COUNT(*) FROM season_snapshots WHERE season_id = ?`
If count > 0, use snapshot tables; otherwise, aggregate live.

---

### Commit 9: `test: add L1 tests for season leaderboard`

**Files changed:**
- `packages/web/src/__tests__/season-leaderboard.test.ts` (new)

**Test cases:**

```
describe("GET /api/seasons/[seasonId]/leaderboard")
  should return teams ranked by total_tokens
  should only include usage within season date range
  should include end_date in the range (inclusive)
  should return empty entries for season with no registered teams
  should return member breakdown when expand=members
  should NOT return members when expand is not set
  should read from snapshot tables when snapshot exists
  should aggregate live when no snapshot exists
  should return 404 for non-existent season
  should handle no-such-table gracefully
```

---

### Commit 10: `feat: add season snapshot API`

**Files changed:**
- `packages/web/src/app/api/admin/seasons/[seasonId]/snapshot/route.ts` (new)

**`POST /api/admin/seasons/[seasonId]/snapshot`**
- Requires admin auth
- Validates season status is `ended`
- Aggregates usage data for all registered teams + members
- Computes ranks
- Idempotent: `DELETE FROM season_snapshots WHERE season_id = ?` then re-insert
- Same for `season_member_snapshots`
- Returns summary: team_count, member_count

---

### Commit 11: `test: add L1 tests for season snapshot`

**Files changed:**
- `packages/web/src/__tests__/season-snapshot.test.ts` (new)

**Test cases:**

```
describe("POST /api/admin/seasons/[seasonId]/snapshot")
  should create snapshots for all registered teams
  should create member snapshots for all team members
  should compute correct ranks by total_tokens DESC
  should be idempotent (re-run produces same result)
  should reject non-ended season
  should reject non-admin users
```

---

### Commit 12: `feat: add season list API`

**Files changed:**
- `packages/web/src/app/api/seasons/route.ts` (new)

**`GET /api/seasons`**
- Public endpoint
- Optional `status` filter
- Returns seasons with `team_count` and `has_snapshot`
- Sorted: active first, then upcoming, then ended (by start_date DESC)

---

### Commit 13: `test: add L1 tests for season list API`

**Files changed:**
- `packages/web/src/__tests__/season-list.test.ts` (new)

**Test cases:**

```
describe("GET /api/seasons")
  should return all seasons with computed status
  should filter by status parameter
  should include team_count and has_snapshot
  should sort active > upcoming > ended
  should handle no-such-table gracefully
```

---

### Commit 14: `feat: add season leaderboard page`

**Files changed:**
- `packages/web/src/app/leaderboard/seasons/page.tsx` (new)
- `packages/web/src/app/leaderboard/seasons/[slug]/page.tsx` (new)
- `packages/web/src/hooks/use-seasons.ts` (new)
- `packages/web/src/hooks/use-season-leaderboard.ts` (new)

**Season list page** (`/leaderboard/seasons`):
- Fetches `GET /api/seasons`
- Renders season cards with status badges
- Click navigates to season detail

**Season leaderboard page** (`/leaderboard/seasons/[slug]`):
- Fetches `GET /api/seasons/[seasonId]/leaderboard?expand=members`
- Note: Needs to resolve slug to id first via `GET /api/seasons` or a dedicated lookup
- Renders team rankings with expandable member details
- Shows "Live" badge for active seasons, "Final Results" for snapshot data

**Hooks:**
- `useSeasons()` — fetch and cache season list
- `useSeasonLeaderboard(seasonId)` — fetch season leaderboard with expand=members

**Proxy update:**
- Add `/leaderboard/seasons` to `isPublicRoute()` matcher

---

### Commit 15: `feat: add season navigation to leaderboard`

**Files changed:**
- `packages/web/src/app/leaderboard/page.tsx`

**Changes:**
- Add "Seasons" link/button next to existing controls
- Uses `lucide-react` Trophy or Flag icon
- Links to `/leaderboard/seasons`

---

### Commit 16: `feat: add admin season management page`

**Files changed:**
- `packages/web/src/app/(dashboard)/admin/seasons/page.tsx` (new)
- `packages/web/src/lib/navigation.ts` (update admin nav group)

**Features:**
- Season list with status, dates, team count
- "Create Season" form (name, slug, start_date, end_date)
- Edit season (inline or modal)
- "Generate Snapshot" button for ended seasons
- View registered teams per season

---

### Commit 17: `feat: add season registration UI for team owners`

**Files changed:**
- `packages/web/src/app/(dashboard)/teams/[teamId]/page.tsx` (update or new)
- `packages/web/src/hooks/use-season-registration.ts` (new)

**Features:**
- For team owner: show available seasons (upcoming + active)
- "Register" button per season
- "Registered" badge for already-registered seasons
- "Withdraw" button for upcoming seasons only

---

## Test Plan Summary

### L1 Unit Tests (mocked D1, no network)

| File | Coverage |
|------|----------|
| `admin-seasons.test.ts` | CRUD validation, auth gates, status computation |
| `season-registration.test.ts` | Registration/withdrawal, role checks, state guards |
| `season-leaderboard.test.ts` | Aggregation logic, date range, snapshot fallback, expand |
| `season-snapshot.test.ts` | Snapshot creation, idempotency, rank computation |
| `season-list.test.ts` | Public listing, status filter, sort order |

### Manual Verification

After deployment:

1. **Admin creates season:** `/admin/seasons` -> Create "S1" -> April 1-30
2. **Team owner registers:** Team detail -> Register for S1 -> success
3. **Leaderboard live:** `/leaderboard/seasons/s1` -> shows teams ranked by live tokens
4. **Mid-season join:** Another team registers -> sees data from season start
5. **Season ends:** Date passes -> status auto-changes to "ended"
6. **Snapshot:** Admin clicks "Generate Snapshot" -> data frozen
7. **Historical view:** `/leaderboard/seasons/s1` -> shows "Final Results" from snapshot
8. **Season list:** `/leaderboard/seasons` -> shows all seasons sorted by status

---

## Migration Notes

### Deploy Order

1. Deploy code (commits 2-17) — all `no such table` fallbacks ensure the app works before migration
2. Run migration:
   ```bash
   wrangler d1 execute pew-prod --file scripts/migrations/006-seasons.sql
   ```
3. Verify via admin page: create first season

### Rollback

```sql
-- Safe to drop all season tables (no existing data depends on them)
DROP TABLE IF EXISTS season_member_snapshots;
DROP TABLE IF EXISTS season_snapshots;
DROP TABLE IF EXISTS season_teams;
DROP TABLE IF EXISTS seasons;
```

### D1 Considerations

- Snapshot generation aggregates across `usage_records` which may have many rows.
  Use the batch approach: aggregate per-team in individual queries, not one massive JOIN.
  D1 Free plan limits 50 queries per Worker invocation, but the snapshot runs via
  Next.js API route (D1 REST API), not the Worker — no query limit applies.
- All new indexes are covering the primary access patterns (season_id lookups).
