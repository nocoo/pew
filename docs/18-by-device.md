# By Device — Multi-Device Analytics & Management

> Two new dashboard pages for visualizing per-device usage (Analytics) and
> managing device aliases (Settings), building on the `device_id` column
> introduced in migration 006.

## Overview

### Problem

Since migration 006 (`scripts/migrations/006-device-id.sql`), each usage record
carries a `device_id` — a UUID generated once per CLI install
(`packages/cli/src/config/manager.ts:43`). However:

1. **No visibility** — All existing dashboard queries `GROUP BY hour_start, source, model`
   without `device_id` (`packages/web/src/app/api/usage/route.ts:128-131`).
   Users cannot see which device produced which tokens.
2. **No naming** — `device_id` is a raw UUID (`crypto.randomUUID()`). Users see
   `a3f8c2d1-...` instead of "MacBook Pro" or "Work Desktop".
3. **No management** — There is no device registry or metadata table. The only
   place `device_id` exists as structured data is the `usage_records` column.

### Solution: Two Pages, Separate Concerns

| Page | Sidebar Group | Route | Icon | Responsibility |
|------|--------------|-------|------|----------------|
| **By Device** | Analytics | `/devices` | `Monitor` | Read-only visualization: charts + summary table |
| **Devices** | Settings | `/manage-devices` | `MonitorSmartphone` | Device registry: list devices, set aliases |

This follows the existing pattern where analytical views live in the Analytics
group (By Agent at `/agents`, By Model at `/models`) while management pages live
in the Settings group (Projects at `/projects`, Teams at `/teams`).

---

## Current State

### Data Model

The `device_id` column in `usage_records`:

```sql
-- scripts/migrations/001-init.sql (squashed schema)
device_id TEXT NOT NULL DEFAULT 'default',
UNIQUE(user_id, device_id, source, model, hour_start)
```

- **Index**: `idx_usage_device(user_id, device_id)` — ready for per-device queries
- **Default**: `'default'` for backward compat (old CLIs that don't send device_id)
- **Generation**: `crypto.randomUUID()` in `ConfigManager.ensureDeviceId()`
  (`packages/cli/src/config/manager.ts:43-51`)
- **Persistence**: `~/.config/pew/config.json` → `deviceId` field
  (`packages/core/src/types.ts:284-289`)

### Types

| Type | Location | `device_id` field |
|------|----------|-------------------|
| `QueueRecord` | `packages/core/src/types.ts:171` | `device_id: string` (required) |
| `IngestRecord` | `packages/core/src/validation.ts:97` | `device_id?: string` (optional, backward compat) |
| `PewConfig` | `packages/core/src/types.ts:284` | `deviceId?: string` |

### Gaps

- **Zero API routes** expose `device_id` in responses
- **Zero dashboard queries** include `device_id` in `GROUP BY`
- **No device metadata table** — no alias/name storage
- **`session_records`** has no `device_id` column (only `usage_records` tracks devices)

### The `default` Device

Old CLI versions (pre-006) did not send `device_id`, so their records carry the
column default `'default'`. This is **not** a UUID and must be handled distinctly:

| Aspect | Behavior |
|--------|----------|
| **Display name** | `"Legacy Device"` (hardcoded in `deviceLabel()`, not derived from `shortDeviceId`) |
| **Alias** | Users **may** set an alias for `device_id = 'default'` via `PUT /api/devices`. Once set, the alias replaces `"Legacy Device"` everywhere. |
| **Charts** | Appears as a normal line/bar alongside UUID devices. No special styling. |
| **Management page** | Shown with a subtle info badge: `"Records from CLI versions before device tracking was added."` |
| **`shortDeviceId('default')`** | Returns `'default'` unchanged (not truncated to 8 chars). The `shortDeviceId` helper must check for non-UUID inputs. |

---

## Database Changes

### Migration 009: `device_aliases`

```sql
-- scripts/migrations/009-device-aliases.sql
CREATE TABLE IF NOT EXISTS device_aliases (
  user_id    TEXT NOT NULL REFERENCES users(id),
  device_id  TEXT NOT NULL,
  alias      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, device_id)
);

-- Case-insensitive uniqueness: one alias name per user, regardless of casing
CREATE UNIQUE INDEX IF NOT EXISTS idx_device_alias_unique
  ON device_aliases (user_id, LOWER(TRIM(alias)));
```

Design notes:

- **Composite PK** `(user_id, device_id)` — no extra index needed, one alias per device per user
- **Alias uniqueness** — `idx_device_alias_unique` on `(user_id, LOWER(TRIM(alias)))` prevents
  two devices from sharing the same name (case-insensitive, trimmed). SQLite `UNIQUE INDEX`
  on expressions handles this at the DB level. The API layer also pre-checks for duplicates
  and returns a `409 Conflict` with a descriptive message before hitting the constraint.
- **No foreign key to usage_records** — devices are discovered from usage data, not pre-registered
- **`alias` is NOT NULL** — if the row exists, it has a name. No row = no alias = show short UUID
- **Lightweight** — no device type, OS, hostname columns. Keep it simple, iterate later.

---

## API Changes

### `GET /api/usage/by-device`

New endpoint for the analytics page. Accepts `from`, `to` query parameters
(same convention as `/api/usage`). When omitted, defaults to the last 30 days
(`from` = 30 days ago, `to` = now), matching `/api/usage` behavior.

Returns two datasets in a single response:

```typescript
interface ByDeviceResponse {
  /** Per-device aggregated stats */
  devices: Array<{
    device_id: string;
    alias: string | null;
    first_seen: string;         // MIN(hour_start)
    last_seen: string;          // MAX(hour_start)
    total_tokens: number;
    input_tokens: number;
    output_tokens: number;
    cached_input_tokens: number;
    reasoning_output_tokens: number;
    estimated_cost: number;     // Server-computed, see "Cost Estimation" below
    sources: string[];          // GROUP_CONCAT(DISTINCT source)
    models: string[];           // GROUP_CONCAT(DISTINCT model)
  }>;
  /** Daily timeline with device dimension */
  timeline: Array<{
    date: string;               // ISO date (YYYY-MM-DD)
    device_id: string;
    total_tokens: number;
    input_tokens: number;
    output_tokens: number;
    cached_input_tokens: number;
  }>;
}
```

#### Cost Estimation

Estimated cost is computed **server-side** to ensure a single consistent formula.
The API route iterates per-device detail rows (not the aggregated totals) using
the same `lookupPricing()` + `estimateCost()` pipeline from `@/lib/pricing` that
powers the existing `/api/usage` endpoint. Specifically:

1. Query detail rows grouped by `(device_id, source, model)` with token sums.
2. For each `(source, model)` pair, call `lookupPricing(pricingMap, model, source)`
   to resolve per-million rates, then `estimateCost(input, output, cached, pricing)`.
3. Sum per-device and attach as `estimated_cost` (USD, 6 decimal places).

This matches the existing cost calculation in `cost-helpers.ts:55` which also
operates on per-`(source, model)` detail rows. The front-end receives a final
number and does **not** re-derive cost from aggregated token counts.

SQL for `devices` (summary — used for display fields):

```sql
SELECT
  ur.device_id,
  da.alias,
  MIN(ur.hour_start) AS first_seen,
  MAX(ur.hour_start) AS last_seen,
  SUM(ur.total_tokens) AS total_tokens,
  SUM(ur.input_tokens) AS input_tokens,
  SUM(ur.output_tokens) AS output_tokens,
  SUM(ur.cached_input_tokens) AS cached_input_tokens,
  SUM(ur.reasoning_output_tokens) AS reasoning_output_tokens,
  GROUP_CONCAT(DISTINCT ur.source) AS sources,
  GROUP_CONCAT(DISTINCT ur.model) AS models
FROM usage_records ur
LEFT JOIN device_aliases da
  ON da.user_id = ur.user_id AND da.device_id = ur.device_id
WHERE ur.user_id = ?
  AND ur.hour_start >= ?
  AND ur.hour_start < ?
GROUP BY ur.device_id
ORDER BY total_tokens DESC
```

SQL for `devices` (cost detail — used to compute `estimated_cost`):

```sql
SELECT
  ur.device_id,
  ur.source,
  ur.model,
  SUM(ur.input_tokens) AS input_tokens,
  SUM(ur.output_tokens) AS output_tokens,
  SUM(ur.cached_input_tokens) AS cached_input_tokens
FROM usage_records ur
WHERE ur.user_id = ?
  AND ur.hour_start >= ?
  AND ur.hour_start < ?
GROUP BY ur.device_id, ur.source, ur.model
```

The API route joins these two result sets in-memory: for each device, sum the
per-`(source, model)` costs into `estimated_cost`, then merge into the summary row.

SQL for `timeline`:

```sql
SELECT
  date(ur.hour_start) AS date,
  ur.device_id,
  SUM(ur.total_tokens) AS total_tokens,
  SUM(ur.input_tokens) AS input_tokens,
  SUM(ur.output_tokens) AS output_tokens,
  SUM(ur.cached_input_tokens) AS cached_input_tokens
FROM usage_records ur
WHERE ur.user_id = ?
  AND ur.hour_start >= ?
  AND ur.hour_start < ?
GROUP BY date(ur.hour_start), ur.device_id
ORDER BY date ASC
```

The existing `idx_usage_device(user_id, device_id)` index supports both queries.

### `GET /api/devices`

Management endpoint. Returns all devices the user has ever synced from, with
alias and summary stats.

```typescript
interface DevicesResponse {
  devices: Array<{
    device_id: string;
    alias: string | null;
    first_seen: string;
    last_seen: string;
    total_tokens: number;
    sources: string[];          // GROUP_CONCAT(DISTINCT source), split into array
    model_count: number;
  }>;
}
```

### `PUT /api/devices`

Update (upsert) a device alias.

```typescript
// Request body
interface UpdateDeviceRequest {
  device_id: string;
  alias: string;            // Non-empty, max 50 chars
}

// Response
interface UpdateDeviceResponse {
  success: true;
}
```

Implementation (two-step):

1. **Duplicate check** — query for an existing alias with the same normalized name
   belonging to a *different* device:
   ```sql
   SELECT device_id FROM device_aliases
   WHERE user_id = ? AND LOWER(TRIM(alias)) = LOWER(TRIM(?)) AND device_id != ?
   LIMIT 1
   ```
   If a row is returned → respond `409 Conflict` with
   `{ error: "Alias already in use by another device" }`.

2. **Upsert** — write the alias using `ON CONFLICT ... DO UPDATE` (not `INSERT OR REPLACE`,
   which would delete + re-insert and could violate the alias uniqueness index if another
   device already holds the same name):
   ```sql
   INSERT INTO device_aliases (user_id, device_id, alias, updated_at)
   VALUES (?, ?, ?, datetime('now'))
   ON CONFLICT (user_id, device_id) DO UPDATE
     SET alias = excluded.alias, updated_at = excluded.updated_at
   ```

Validation:
- `device_id` must be a non-empty string
- `alias` must be 1-50 characters after `trim()`
- `alias` must be unique per user (case-insensitive, trimmed) — enforced by both
  the API duplicate check and the DB `idx_device_alias_unique` index
- `device_id` must exist in user's `usage_records` (prevent aliasing phantom devices)

---

## Frontend Changes

### Navigation (`packages/web/src/lib/navigation.ts`)

Add two sidebar entries:

```typescript
// Analytics group — after "By Model"
{ href: "/devices", label: "By Device", icon: "Monitor" },

// Settings group — after "Projects"
{ href: "/manage-devices", label: "Devices", icon: "MonitorSmartphone" },
```

Update `ROUTE_LABELS`:

```typescript
devices: "By Device",
"manage-devices": "Devices",
```

### Hooks

**`useDeviceData`** (`packages/web/src/hooks/use-device-data.ts`)
- Fetches `GET /api/usage/by-device?from=&to=`
- Returns `{ data, loading, error, refetch }`
- Same pattern as `useUsageData` (`packages/web/src/hooks/use-usage-data.ts`)

**`useDevices`** (`packages/web/src/hooks/use-devices.ts`)
- Fetches `GET /api/devices`
- Exposes `updateAlias(deviceId, alias)` → `PUT /api/devices`
- Refetches full list after mutation (same pattern as `useProjects`)

### Helpers (`packages/web/src/lib/device-helpers.ts`)

| Function | Purpose |
|----------|---------|
| `shortDeviceId(id)` | Returns first 8 chars of UUID; returns `id` unchanged if not a UUID (e.g. `'default'`) |
| `deviceLabel(device)` | Returns `alias ?? shortDeviceId(device_id)` — see "The `default` Device" above |
| `buildDeviceLabelMap(devices)` | Returns `Map<device_id, label>` for chart legend/tooltip lookup |
| `toDeviceTrendPoints(timeline)` | Pivots timeline into `{ date, [device_id]: tokens }[]` for LineChart. Uses `device_id` as series key (stable, unique), **not** display label. |
| `toDeviceSharePoints(timeline)` | Converts to percentage-based points for 100% stacked AreaChart. Same keying strategy. |

**Chart keying convention**: All chart data structures use `device_id` as the
series key. Display labels (`deviceLabel()`) are resolved at render time via
`buildDeviceLabelMap()` and passed to Recharts `nameKey` / `legendFormatter` /
tooltip formatters. This avoids series collisions when an alias happens to match
another device's short UUID or the `"Legacy Device"` fallback.

### Chart Components

Three new components in `packages/web/src/components/dashboard/`:

**`DeviceTrendChart`** — Multi-line `LineChart`
- One line per device, colored from `CHART_COLORS` palette
- Interactive legend toggle (same as `SourceTrendChart` pattern)
- X-axis: date, Y-axis: total tokens
- Legend labels: `deviceLabel()` (alias or short UUID)

**`DeviceShareChart`** — 100% stacked `AreaChart`
- Shows each device's share of total usage over time
- Same pattern as `ModelEvolutionChart`
- Useful for spotting when a user shifts between devices

**`DeviceBreakdownChart`** — Horizontal stacked `BarChart`
- One bar per device, stacked segments: input / output / cached
- Same pattern as `ModelBreakdownChart`
- Sorted by total tokens descending

All use `DashboardResponsiveContainer` wrapper and `palette.ts` colors.

### Analytics Page: `/devices` (`packages/web/src/app/(dashboard)/devices/page.tsx`)

Structure follows the By Model page pattern (`packages/web/src/app/(dashboard)/models/page.tsx`):

```
┌──────────────────────────────────────────────────┐
│  By Device                        [Period: All ▾] │
│  Compare usage across your devices                │
├──────────────────────────────────────────────────┤
│  StatGrid:                                        │
│  [N Devices]  [Most Active: MacBook Pro]  [7d: 2] │
├──────────────────────────────────────────────────┤
│  ┌─ Device Trend ──────────┐ ┌─ Device Share ───┐ │
│  │  LineChart               │ │  AreaChart 100%   │ │
│  │  (multi-line per device) │ │  (share over time)│ │
│  └──────────────────────────┘ └──────────────────┘ │
├──────────────────────────────────────────────────┤
│  ┌─ Token Breakdown by Device ──────────────────┐ │
│  │  Horizontal stacked BarChart                  │ │
│  └───────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────┤
│  Summary Table (read-only):                       │
│  Device | Tools | Models | Input | Output |       │
│  Cached | Total | Est. Cost | Share               │
└──────────────────────────────────────────────────┘
```

- Period selector reuses `PeriodSelector` component
- Loading state: skeleton (reuse existing pattern)
- Empty state: "No device data. Sync from multiple devices to compare."
- Device labels: alias if set, `"Legacy Device"` for `device_id = 'default'`, otherwise short UUID (first 8 chars)

### Management Page: `/manage-devices` (`packages/web/src/app/(dashboard)/manage-devices/page.tsx`)

Structure follows the Projects page pattern (`packages/web/src/app/(dashboard)/projects/page.tsx`):

```
┌──────────────────────────────────────────────────┐
│  Devices                                          │
│  Manage your synced devices and set aliases       │
├──────────────────────────────────────────────────┤
│  DeviceCard:                                      │
│  ┌────────────────────────────────────────────┐   │
│  │  [MacBook Pro ✏️]              a3f8c2d1-... │   │
│  │  First seen: Mar 1 · Last seen: Mar 12     │   │
│  │  Tools: Claude Code, OpenCode              │   │
│  │  3 models · 1.2M tokens                    │   │
│  └────────────────────────────────────────────┘   │
│                                                   │
│  DeviceCard (no alias):                           │
│  ┌────────────────────────────────────────────┐   │
│  │  [Set a name... ✏️]            7b4e9f12-... │   │
│  │  First seen: Mar 5 · Last seen: Mar 11     │   │
│  │  Tools: Gemini CLI                         │   │
│  │  2 models · 500K tokens                    │   │
│  └────────────────────────────────────────────┘   │
│                                                   │
│  DeviceCard (default device):                     │
│  ┌────────────────────────────────────────────┐   │
│  │  [Legacy Device ✏️]              default     │   │
│  │  ℹ Records from CLI versions before device  │   │
│  │    tracking was added.                      │   │
│  │  First seen: Jan 15 · Last seen: Feb 28    │   │
│  │  Tools: Claude Code                        │   │
│  │  1 model · 200K tokens                     │   │
│  └────────────────────────────────────────────┘   │
├──────────────────────────────────────────────────┤
│  ℹ Device IDs are auto-generated per machine      │
│    when you first run `pew sync`.                 │
└──────────────────────────────────────────────────┘
```

Interactions (all inline, no modals — matches Projects pattern):
- **Click alias** → inline text input, commits on blur/Enter → `PUT /api/devices`
- **Duplicate alias** → show inline error: "This name is already used by another device"
  (409 response from server)
- **No alias (UUID device)** → shows `shortDeviceId()` + placeholder "Set a name..."
- **No alias (default device)** → shows `"Legacy Device"` + placeholder "Set a name..."
- **No delete** — devices are auto-discovered from usage data, not user-created
- **Full refetch** after every mutation

---

## File Changes Summary

| Operation | Path |
|-----------|------|
| **New** | `scripts/migrations/009-device-aliases.sql` |
| **Edit** | `packages/core/src/types.ts` (add Device-related types) |
| **New** | `packages/web/src/app/api/usage/by-device/route.ts` |
| **New** | `packages/web/src/app/api/devices/route.ts` |
| **New** | `packages/web/src/hooks/use-device-data.ts` |
| **New** | `packages/web/src/hooks/use-devices.ts` |
| **New** | `packages/web/src/lib/device-helpers.ts` |
| **New** | `packages/web/src/components/dashboard/device-trend-chart.tsx` |
| **New** | `packages/web/src/components/dashboard/device-share-chart.tsx` |
| **New** | `packages/web/src/components/dashboard/device-breakdown-chart.tsx` |
| **New** | `packages/web/src/app/(dashboard)/devices/page.tsx` |
| **New** | `packages/web/src/app/(dashboard)/manage-devices/page.tsx` |
| **Edit** | `packages/web/src/lib/navigation.ts` (add 2 sidebar entries + route labels) |
| **New** | `packages/web/src/__tests__/device-helpers.test.ts` |
| **Edit** | `packages/web/src/__tests__/navigation.test.ts` (add device nav tests) |
| **New** | `packages/web/src/__tests__/by-device.test.ts` |
| **New** | `packages/web/src/__tests__/devices.test.ts` |

Total: **11 new files + 2 edits + 5 test files**. No CLI or Worker changes required.

---

## Testing Plan

Tests follow the project's existing conventions (`packages/web/src/__tests__/`).

### L1 — Unit Tests (pure logic, no I/O)

**`device-helpers.test.ts`** — covers all helper functions:

| Test | Input | Expected |
|------|-------|----------|
| `shortDeviceId` with UUID | `'a3f8c2d1-1234-5678-9abc-def012345678'` | `'a3f8c2d1'` |
| `shortDeviceId` with `'default'` | `'default'` | `'default'` (unchanged) |
| `shortDeviceId` with empty string | `''` | `''` |
| `deviceLabel` with alias | `{ alias: 'MacBook', device_id: '...' }` | `'MacBook'` |
| `deviceLabel` without alias, UUID | `{ alias: null, device_id: 'a3f8c2d1-...' }` | `'a3f8c2d1'` |
| `deviceLabel` without alias, default | `{ alias: null, device_id: 'default' }` | `'Legacy Device'` |
| `toDeviceTrendPoints` | timeline fixture | pivoted `{ date, [device_id]: tokens }[]` — keyed by `device_id`, not label |
| `toDeviceSharePoints` | timeline fixture | percentage rows summing to 100, keyed by `device_id` |

**`navigation.test.ts`** (extend existing):

| Test | What |
|------|------|
| Analytics group includes `/devices` | Verify `By Device` entry exists with `Monitor` icon |
| Settings group includes `/manage-devices` | Verify `Devices` entry exists with `MonitorSmartphone` icon |
| `ROUTE_LABELS` includes new entries | `devices → "By Device"`, `manage-devices → "Devices"` |
| `breadcrumbsFromPathname('/devices')` | Returns `[Home, By Device]` |

### L2 — API Tests (mocked D1, real route handlers)

**`by-device.test.ts`** — `GET /api/usage/by-device`:

| Test | What |
|------|------|
| Returns devices + timeline for valid date range | Happy path with 2 devices |
| Includes `estimated_cost` per device | Verify cost is a number, > 0 for devices with tokens |
| Joins alias from `device_aliases` | Device with alias → `alias: "MacBook"`, without → `alias: null` |
| `device_id = 'default'` appears in results | Legacy records included, not filtered out |
| `sources` and `models` are arrays | Parsed from `GROUP_CONCAT` |
| Missing/invalid auth → 401 | |
| Missing date params → uses default range | Same fallback as `/api/usage` |

**`devices.test.ts`** — `GET /api/devices` + `PUT /api/devices`:

| Test | What |
|------|------|
| GET returns all devices with stats | Includes `device_id`, `alias`, `first_seen`, `last_seen`, `total_tokens`, `sources[]` |
| GET includes `'default'` device | Not filtered out |
| PUT creates alias | New alias → 200, refetch shows alias |
| PUT updates existing alias | Overwrite → 200 |
| PUT rejects empty alias | `""` → 400 |
| PUT rejects alias > 50 chars | → 400 |
| PUT rejects duplicate alias (case-insensitive) | `"MacBook"` taken → `"macbook"` → 409 |
| PUT allows same alias for same device | Updating own alias to same value → 200 |
| PUT rejects phantom device_id | device_id not in usage_records → 400 |
| PUT alias for `'default'` device | Allowed → 200 |

### L3 — Integration (not required for this PR)

Covered by existing E2E infrastructure if needed later.

---

## Atomic Commits Plan

| # | Commit | Scope |
|---|--------|-------|
| 1 | `feat: add device_aliases migration` | `scripts/migrations/009-device-aliases.sql` |
| 2 | `feat: add device-related types to core` | `packages/core/src/types.ts` |
| 3 | `test: add by-device API tests` | `__tests__/by-device.test.ts` (TDD — tests first) |
| 4 | `feat: add GET /api/usage/by-device endpoint` | API route (make tests pass) |
| 5 | `test: add devices API tests` | `__tests__/devices.test.ts` (TDD — tests first) |
| 6 | `feat: add GET/PUT /api/devices endpoint` | API route (make tests pass) |
| 7 | `test: add device-helpers tests` | `__tests__/device-helpers.test.ts` (TDD — tests first) |
| 8 | `feat: add device data hooks and helpers` | hooks + lib (make tests pass) |
| 9 | `feat: add device chart components` | 3 chart components |
| 10 | `feat: add By Device analytics page` | `/devices` page |
| 11 | `feat: add Devices management page` | `/manage-devices` page |
| 12 | `test: add device navigation tests` | extend `navigation.test.ts` (TDD — tests first) |
| 13 | `feat: add device entries to sidebar navigation` | `navigation.ts` (make tests pass) |

---

## Out of Scope (Future Work)

- **Device-level session tracking** — `session_records` has no `device_id` column.
  Adding it would require a schema migration + CLI changes to include `device_id`
  in session snapshots. This is a separate effort.
- **Device deletion** — Users cannot remove stale devices. Could add a
  `DELETE /api/devices/:id` in the future to archive/hide old devices.
- **CLI `--device-name` flag** — Allow naming devices at sync time instead of
  in the dashboard. Requires CLI changes + API extension.
- **Hostname auto-detection** — Use `os.hostname()` as default alias suggestion
  when device is first seen. Requires CLI to send hostname alongside device_id.
