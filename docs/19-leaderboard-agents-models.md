# 19 — Leaderboard: Agents & Models Tabs

> Status: **Draft** — pending review before implementation.

## 1 Overview

Add two new leaderboard tabs — **Agents** (4th tab) and **Models** (5th tab) — to the existing leaderboard navigation. Each tab allows users to pick an agent or model, then shows a **top-20 ranked list** of public users sorted by total tokens consumed through that agent/model.

### 1.1 User Flow

```
/leaderboard/agents
  ┌─ Agent Selector: [Claude Code ▾] ─────────────────────┐
  │  Period: [7d] [30d] [All]    Scope: [Global ▾]        │
  ├────────────────────────────────────────────────────────┤
  │  #1  Alice   ████████████████████  12.4M tokens        │
  │       Sessions: 342   Duration: 48h 12m                │
  │  #2  Bob     ███████████████       8.1M tokens         │
  │  ...                                                   │
  └────────────────────────────────────────────────────────┘

/leaderboard/models
  ┌─ Model Selector: [claude-sonnet-4 ▾] ─────────────────┐
  │  Period: [7d] [30d] [All]    Scope: [Global ▾]        │
  ├────────────────────────────────────────────────────────┤
  │  #1  Carol   ████████████████████  9.8M tokens         │
  │       Sessions: —   Duration: —                        │
  │  #2  Dave    ███████████████       6.2M tokens         │
  │  ...                                                   │
  └────────────────────────────────────────────────────────┘
```

Row click → `UserProfileDialog` (same as Individual tab).

### 1.2 Key Decisions

| Topic                      | Decision                                                                     | Rationale                                                                                                                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent list                 | All 11 from `SOURCES` constant                                               | Exhaustive, no dynamic discovery needed                                                                                                                                                                           |
| Model list                 | All 14 models from `DEFAULT_MODEL_PRICES` keys (static list, vendor-grouped) | Exhaustive known models with pricing; covers Anthropic/Google/OpenAI                                                                                                                                              |
| Session stats (Agents tab) | Show sessions + duration                                                     | `session_records` has `source` column — filterable                                                                                                                                                                |
| Session stats (Models tab) | Show "—"                                                                     | `session_records.model` exists but is nullable and only populated for some sources; not reliable enough for ranked data. API returns `null` for session fields; `LeaderboardRow` renders "—" when null (see §6.3) |
| Pagination                 | Same as Individual: 20/page, max 100, "Show more" button                     | Consistency                                                                                                                                                                                                       |
| Scope dropdown             | Same as Individual: Global / Org / Team                                      | Reuse existing `ScopeDropdown` + org/team fetch logic                                                                                                                                                             |

---

## 2 Data Layer Changes

### 2.1 Worker RPC: `packages/worker-read/src/rpc/leaderboard.ts`

**Current** `GetGlobalLeaderboardRequest`:

```ts
interface GetGlobalLeaderboardRequest {
  method: "leaderboard.getGlobal";
  fromDate?: string;
  teamId?: string;
  orgId?: string;
  limit: number;
  offset?: number;
}
```

**Add** two optional filter fields:

```ts
interface GetGlobalLeaderboardRequest {
  method: "leaderboard.getGlobal";
  fromDate?: string;
  teamId?: string;
  orgId?: string;
  source?: string; // NEW — filter usage_records.source
  model?: string; // NEW — filter usage_records.model
  limit: number;
  offset?: number;
}
```

**SQL change** in `handleGetGlobalLeaderboard()` — add two conditional WHERE clauses using the same pattern as existing `teamId`/`orgId`/`fromDate` filters:

```ts
if (req.source) {
  conditions.push("ur.source = ?");
  params.push(req.source);
}

if (req.model) {
  conditions.push("ur.model = ?");
  params.push(req.model);
}
```

No new RPC methods. No schema changes.

**Session stats** — `handleGetUserSessionStats()`:

Add optional `source?: string` to `GetUserSessionStatsRequest`:

```ts
interface GetUserSessionStatsRequest {
  method: "leaderboard.getUserSessionStats";
  userIds: string[];
  fromDate?: string;
  source?: string; // NEW — filter session_records.source
}
```

SQL change:

```ts
if (req.source) {
  conditions.push("sr.source = ?");
  params.push(req.source);
}
```

No model filter for session stats (see Decision §1.2).

### 2.2 DB Abstraction: `packages/web/src/lib/db.ts`

Add `source?: string` and `model?: string` to `getGlobalLeaderboard()` options:

```ts
getGlobalLeaderboard(options: {
  fromDate?: string;
  teamId?: string;
  orgId?: string;
  source?: string;   // NEW
  model?: string;    // NEW
  limit: number;
  offset?: number;
}): Promise<LeaderboardEntryRow[]>
```

Add `source?: string` to `getLeaderboardSessionStats()`:

```ts
getLeaderboardSessionStats(
  userIds: string[],
  fromDate?: string,
  source?: string     // NEW
): Promise<LeaderboardSessionStatsRow[]>
```

### 2.3 DB Worker Adapter: `packages/web/src/lib/db-worker.ts`

Pass-through `source` / `model` to RPC calls:

```ts
// getGlobalLeaderboard
{ method: "leaderboard.getGlobal", ...options }
// options already contains source/model via spread

// getLeaderboardSessionStats
{ method: "leaderboard.getUserSessionStats", userIds, 
  ...(fromDate && { fromDate }),
  ...(source && { source }) }
```

### 2.4 API Route: `packages/web/src/app/api/leaderboard/route.ts`

Add query param parsing:

```ts
const sourceFilter = url.searchParams.get("source"); // NEW
const modelFilter = url.searchParams.get("model"); // NEW
```

Validation:

- `source`: must be in `VALID_SOURCES` set (import from `@pew/core/constants`)
- `model`: must be non-empty string (no exhaustive validation — DB query simply returns empty if no match)
- `source` and `model` are mutually exclusive (400 if both present)

Pass to DB calls:

```ts
db.getGlobalLeaderboard({
  fromDate,
  teamId,
  orgId,
  ...(sourceFilter && { source: sourceFilter }),
  ...(modelFilter && { model: modelFilter }),
  limit: limit + 1,
  offset,
});

db.getLeaderboardSessionStats(userIds, fromDate, sourceFilter ?? undefined);
```

Cache policy: `source`/`model` filters are identity-independent (public data, same result for all users), so they use the **public** cache policy: `Cache-Control: public, s-maxage=60, stale-while-revalidate=120` — same as unscoped global requests. Only `teamId`/`orgId` scoped requests use `private, no-store` (because those depend on user membership).

### 2.5 React Hook: `packages/web/src/hooks/use-leaderboard.ts`

Add optional fields to `UseLeaderboardOptions`:

```ts
interface UseLeaderboardOptions {
  period?: LeaderboardPeriod;
  limit?: number;
  teamId?: string | null;
  orgId?: string | null;
  source?: string | null; // NEW
  model?: string | null; // NEW
  enabled?: boolean;
}
```

Append to fetch URL:

```ts
if (source) params.set("source", source);
if (model) params.set("model", model);
```

Add `source`, `model` to `useCallback` deps and reset logic (same as `teamId`/`orgId`).

---

## 3 Navigation

### 3.1 Tab Registration: `packages/web/src/components/leaderboard/leaderboard-nav.tsx`

```ts
const TABS = [
  { href: "/leaderboard", label: "Individual" },
  { href: "/leaderboard/seasons", label: "Seasons" },
  { href: "/leaderboard/achievements", label: "Achievements" },
  { href: "/leaderboard/agents", label: "Agents" }, // NEW
  { href: "/leaderboard/models", label: "Models" }, // NEW
  { href: "/leaderboard/showcases", label: "Showcases" },
];
```

Agents and Models placed before Showcases (which is a social feature, lower priority in nav).

---

## 4 Shared Components (Extract & Reuse)

The Individual leaderboard page (`/leaderboard/page.tsx`, 688 lines) contains several components that the new pages need verbatim. **Extract** them into shared files:

### 4.1 `packages/web/src/components/leaderboard/scope-dropdown.tsx` (NEW)

Extract from `page.tsx`:

- `ScopeSelection` type
- `ScopeDropdown` component
- `DropdownItem` component
- `TeamLogoIcon`, `TeamLogoBadge`, `OrgLogoIcon` helpers
- `loadScopeFromStorage()`, `saveScopeToStorage()` functions
- `SCOPE_STORAGE_KEY` constant

### 4.2 `packages/web/src/components/leaderboard/leaderboard-row.tsx` (NEW)

Extract from `page.tsx`:

- `LeaderboardRow` component

**Type change**: `LeaderboardEntry.session_count` and `LeaderboardEntry.total_duration_seconds` become `number | null`:

```ts
interface LeaderboardEntry {
  // ... existing fields ...
  session_count: number | null; // was: number
  total_duration_seconds: number | null; // was: number
}
```

Rendering logic:

```tsx
// Session count column
{
  entry.session_count != null ? entry.session_count.toLocaleString("en-US") : "—";
}

// Duration column
{
  entry.total_duration_seconds != null ? formatDuration(entry.total_duration_seconds) : "—";
}
```

The API route returns `null` (not `0`) for these fields when `model` filter is active. This is a semantic distinction: `0` means "zero sessions" (real data), `null` means "not applicable" (display "—"). Existing Individual and Agents pages always receive numbers, so the UI is unchanged for them.

### 4.3 `packages/web/src/components/leaderboard/period-tabs.tsx` (NEW)

Extract from `page.tsx`:

- `PERIODS` constant
- `PERIOD_TO_TAB` mapping
- Inline period tab UI → `PeriodTabs` component with props `{ value, onChange }`

### 4.4 Refactor `page.tsx`

After extraction, `page.tsx` imports the shared components. Verify no regressions — the page's behavior stays identical.

---

## 5 Agents Page

### 5.1 File: `packages/web/src/app/leaderboard/agents/page.tsx` (NEW)

**Agent Selector**: Dropdown at the top showing all 11 agents.

- Default selection: `claude-code` (highest usage, most interesting default)
- Uses `sourceLabel()` for display names and `agentColor()` for the color dot
- **URL state**: Read initial value from `searchParams.get("source")`; on change, update URL via `router.replace()` with shallow navigation. If absent or invalid, fall back to `claude-code`. This makes links shareable (e.g. `/leaderboard/agents?source=gemini-cli`)

**Data flow**:

```
useLeaderboard({ period, teamId, orgId, source: selectedAgent, limit: 20 })
```

**Row rendering**: Reuses shared `LeaderboardRow`. Session count and duration are present (filtered by `source` in RPC).

**Layout** (identical to Individual page):

```
PageHeader → LeaderboardNav → [AgentSelector + PeriodTabs + ScopeDropdown]
  → TableHeader → LeaderboardRow[] → "Show more" → UserProfileDialog
```

### 5.2 Agent Selector Component

```tsx
function AgentSelector({ value, onChange }: { value: string; onChange: (source: string) => void }) {
  // Dropdown listing SOURCES with agentColor dot + sourceLabel text
}
```

Can be inline in the page file (small component), or extracted to `packages/web/src/components/leaderboard/agent-selector.tsx` if reuse is needed.

---

## 6 Models Page

### 6.1 File: `packages/web/src/app/leaderboard/models/page.tsx` (NEW)

**Model Selector**: Dropdown showing all 14 models from `DEFAULT_MODEL_PRICES`, vendor-grouped (Anthropic → Google → OpenAI).

- Default selection: `claude-sonnet-4-20250514`
- Uses `shortModel()` for display labels and `modelColor()` for color dots
- **URL state**: Same pattern as Agents — read from `searchParams.get("model")`, update via `router.replace()`. Shareable links (e.g. `/leaderboard/models?model=o3`)

**Data flow**:

```
useLeaderboard({ period, teamId, orgId, model: selectedModel, limit: 20 })
```

**Row rendering**: Reuses shared `LeaderboardRow`, but session count and duration display "—" (no `model` filter applied to session stats).

**Layout**: Same as Agents page, with `ModelSelector` replacing `AgentSelector`.

### 6.2 Model Selector Component

```tsx
const MODEL_LIST = Object.keys(DEFAULT_MODEL_PRICES);
// 14 models, vendor-grouped: claude-sonnet-4, claude-opus-4, ... gemini-2.5-pro, ... o3, gpt-4.1, ...

function ModelSelector({ value, onChange }: { value: string; onChange: (model: string) => void }) {
  // Dropdown listing MODEL_LIST with modelColor dot + shortModel text
}
```

### 6.3 Row Adaptation for Missing Session Stats

When `model` filter is active, session stats are not meaningful (see §1.2). The full-stack handling:

1. **API route**: When `model` param is set, skip the `getLeaderboardSessionStats()` DB call entirely. Set `session_count: null` and `total_duration_seconds: null` on each entry.

2. **Hook / types**: `LeaderboardEntry.session_count` and `total_duration_seconds` become `number | null` (see §4.2).

3. **`LeaderboardRow`**: Renders "—" when value is `null`, number when non-null (see §4.2).

This preserves the semantic distinction: `0` = "zero sessions (real data)", `null` = "not applicable (don't show)".

---

## 7 File Change Summary

| #   | File                                                          | Action  | Description                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `packages/worker-read/src/rpc/leaderboard.ts`                 | Modify  | Add `source?`, `model?` to `GetGlobalLeaderboardRequest`; `source?` to `GetUserSessionStatsRequest`; add WHERE clauses                                                                                                    |
| 2   | `packages/web/src/lib/db.ts`                                  | Modify  | Add `source?`, `model?` to `getGlobalLeaderboard()` options; `source?` to `getLeaderboardSessionStats()`                                                                                                                  |
| 3   | `packages/web/src/lib/db-worker.ts`                           | Modify  | Pass-through new fields to RPC                                                                                                                                                                                            |
| 4   | `packages/web/src/app/api/leaderboard/route.ts`               | Modify  | Parse `source`/`model` params, validate, pass to DB, skip session stats for model filter                                                                                                                                  |
| 5   | `packages/web/src/hooks/use-leaderboard.ts`                   | Modify  | Add `source?`, `model?` to options, append to fetch URL                                                                                                                                                                   |
| 6   | `packages/web/src/components/leaderboard/leaderboard-nav.tsx` | Modify  | Add Agents + Models tabs                                                                                                                                                                                                  |
| 7   | `packages/web/src/components/leaderboard/scope-dropdown.tsx`  | **New** | Extract ScopeDropdown + helpers from page.tsx                                                                                                                                                                             |
| 8   | `packages/web/src/components/leaderboard/leaderboard-row.tsx` | **New** | Extract LeaderboardRow from page.tsx                                                                                                                                                                                      |
| 9   | `packages/web/src/components/leaderboard/period-tabs.tsx`     | **New** | Extract PeriodTabs from page.tsx                                                                                                                                                                                          |
| 10  | `packages/web/src/app/leaderboard/page.tsx`                   | Modify  | Import extracted shared components                                                                                                                                                                                        |
| 11  | `packages/web/src/app/leaderboard/agents/page.tsx`            | **New** | Agents leaderboard page                                                                                                                                                                                                   |
| 12  | `packages/web/src/app/leaderboard/models/page.tsx`            | **New** | Models leaderboard page                                                                                                                                                                                                   |
| 13a | `packages/worker-read/src/rpc/leaderboard.test.ts`            | Modify  | **New tests**: `leaderboard.getGlobal` with source/model filters, `leaderboard.getUserSessionStats` with source filter. Verify SQL conditions and param binding. (Currently untested — only season methods have coverage) |
| 13b | `packages/web/src/__tests__/leaderboard.test.ts`              | Modify  | **New tests**: source/model param parsing, mutual exclusion validation, cache headers (public for source/model, private for team/org), session stats skipped when model filter active                                     |
| 13c | `packages/web/src/__tests__/...`                              | Modify  | Update `getGlobalLeaderboard` and `getLeaderboardSessionStats` mock signatures for new options                                                                                                                            |

**Total**: 10 modified + 4 new files.

---

## 8 Commit Plan (Atomic)

| #   | Scope        | Commit Message                                                                                     | Files           |
| --- | ------------ | -------------------------------------------------------------------------------------------------- | --------------- |
| C1  | RPC layer    | `feat(worker-read): add source/model filters to global leaderboard RPC`                            | #1              |
| C2  | RPC tests    | `test(worker-read): add tests for leaderboard.getGlobal and getUserSessionStats filters`           | #13a            |
| C3  | DB + API     | `feat(web): pipe source/model filters through db layer and API route`                              | #2, #3, #4      |
| C4  | API tests    | `test(web): add leaderboard API tests for source/model params and cache policy`                    | #13b            |
| C5  | Hook         | `feat(web): add source/model options to useLeaderboard hook`                                       | #5              |
| C6  | Nav          | `feat(web): add Agents and Models tabs to leaderboard nav`                                         | #6              |
| C7  | Extract      | `refactor(web): extract shared leaderboard components (ScopeDropdown, LeaderboardRow, PeriodTabs)` | #7, #8, #9, #10 |
| C8  | Agents page  | `feat(web): add Agents leaderboard page`                                                           | #11             |
| C9  | Models page  | `feat(web): add Models leaderboard page`                                                           | #12             |
| C10 | Mock updates | `test(web): update leaderboard test mocks for new options`                                         | #13c            |
| C11 | Deploy       | `wrangler deploy` worker-read (no commit — runtime deploy)                                         | —               |
| C12 | Index check  | Run `EXPLAIN QUERY PLAN` against production D1 (no commit — verify perf)                           | —               |

After C12: verify on live site — full scan acceptable → done. If slow → add migration 011 indexes.

---

## 9 Database Schema & Index Impact

**No schema migrations needed.** Filtering uses existing columns (`usage_records.source`, `usage_records.model`, `session_records.source`).

### 9.1 Index Analysis

The global leaderboard query scans **all public users** (no `user_id = ?` prefix). Current indexes:

| Table             | Index                             | Columns                          | Helps new filters?                                                                                        |
| ----------------- | --------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `usage_records`   | `idx_usage_user_time`             | `(user_id, hour_start)`          | No — `source`/`model` not in index; query has no single-user prefix                                       |
| `usage_records`   | `idx_usage_device`                | `(user_id, device_id)`           | No                                                                                                        |
| `session_records` | `idx_session_user_source_project` | `(user_id, source, project_ref)` | Partial — `source` is 2nd column, but query groups across all users so planner may not use it effectively |

**Standalone `idx_usage_source` and `idx_session_source` were dropped in migration 010** (deemed redundant when all queries had `user_id` prefix). The new leaderboard filters are the first case where `source`/`model` are filtered **without** a `user_id` prefix — the migration's assumption no longer holds.

### 9.2 Performance Risk & Mitigation

For current data volumes (hundreds of users, low millions of rows), a full table scan with WHERE filter is tolerable on D1. However, to validate this:

**Required**: Run `EXPLAIN QUERY PLAN` on the filtered leaderboard query against production D1 after C1 deploy, before considering the feature complete.

```sql
EXPLAIN QUERY PLAN
SELECT ur.user_id, u.name, u.image, u.slug,
       SUM(ur.total_tokens) AS total_tokens
FROM usage_records ur
JOIN users u ON u.id = ur.user_id
WHERE u.is_public = 1 AND ur.source = 'claude-code'
GROUP BY ur.user_id
HAVING total_tokens > 0
ORDER BY total_tokens DESC
LIMIT 21;
```

**If scan is too slow** (>500ms), add targeted indexes as a follow-up migration:

```sql
-- Migration 011 (only if needed):
CREATE INDEX IF NOT EXISTS idx_usage_source_user ON usage_records(source, user_id, hour_start);
CREATE INDEX IF NOT EXISTS idx_usage_model_user  ON usage_records(model, user_id, hour_start);
```

This is a measure-then-act approach — no speculative migration.

---

## 11 Decisions (Closed)

1. **Agent selector default**: `claude-code` — highest usage, most interesting default.

2. **Model list**: All 14 models from `DEFAULT_MODEL_PRICES` keys (static declaration order, vendor-grouped: Anthropic → Google → OpenAI). Not a "top N" ranking — it's the exhaustive static default list.

3. **URL state**: Selected agent/model stored as URL query param (e.g. `/leaderboard/agents?source=claude-code`) via `useSearchParams` + `router.replace()`. If absent or invalid, fall back to default. Component state is initialized from URL, not `useState` alone.

4. **Session stats null semantics**: API returns `null` (not `0`) for `session_count` / `total_duration_seconds` when model filter is active. `LeaderboardEntry` types become `number | null`. Row renders "—" for null, formatted number for non-null.
