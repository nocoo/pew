# C4 — Web read API + `/pricing` dashboard page

## Scope

Expose the dynamic pricing data published by C3 to the web app, and add a sortable/filterable dashboard page for it. The cost calculation path stays on the existing static `lib/pricing.ts` — C5 is the cutover. C4 only **publishes a new view**; existing `/api/pricing` and all charts continue to work unchanged.

## Files added

```
packages/web/src/app/api/admin/pricing/models/
└── route.ts                                          # GET → { entries, meta, servedFrom }, admin-only

packages/web/src/app/api/admin/pricing/models/
└── route.test.ts                                     # auth + RPC delegation + error fallback

packages/web/src/app/(dashboard)/admin/model-prices/
├── page.tsx                                          # client component (admin-gated via useAdmin())
├── pricing-table.tsx                                 # presentation: sort/filter/search
├── pricing-meta-banner.tsx                           # presentation: meta + lastErrors[] surface
├── pricing-table-helpers.ts                          # pure sort/filter helpers (unit-tested)
└── __tests__/
    └── pricing-table-helpers.test.ts                 # vitest unit tests for the pure helpers
```

(Path `/admin/model-prices` chosen to avoid colliding with existing `/admin/pricing` (Token Pricing CRUD). Final label/path subject to one-line product confirmation; spec uses `model-prices` as placeholder.)

## Files modified

```
packages/web/src/lib/db-worker.ts                     # add getDynamicPricing(), getDynamicPricingMeta() RPC wrappers
packages/web/src/lib/navigation.ts                    # add { href: '/admin/model-prices', label: 'Model Prices', icon: 'Tag' } to ADMIN_NAV_GROUP
```

No edits to existing routes, charts, `lib/pricing.ts`, or any cost calculation.

## Module contracts

### `app/api/admin/pricing/models/route.ts`

```typescript
export async function GET(request: Request): Promise<Response>;
```

Behavior:

1. **Auth gate** (existing pattern from `app/api/organizations/mine/route.ts`):
   - `const auth = await resolveUser(request)`; null → 401.
   - `const admin = await isAdminUser(auth.userId)`; false → 403.
2. **Fetch**:
   - `entries = await db.getDynamicPricing()` (returns `{ entries, servedFrom }`)
   - `meta = await db.getDynamicPricingMeta()`
   - Both via the existing `getDbRead()` worker-read client.
3. **Return** `NextResponse.json({ entries: entries.entries, servedFrom: entries.servedFrom, meta }, { headers: { 'cache-control': 'private, no-store' } })`. Admin-gated data is never cached at the edge — same posture as existing admin APIs.
4. **Error fallback**: if either RPC throws (worker-read unreachable), return 503 with `{ error, fallback: { entries: [], meta: null } }`. Page must render the error state without crashing.

This route does **not** import `lib/pricing.ts` — it's strictly the dynamic dataset, separate from the cost-calc `PricingMap` served by `/api/pricing`.

### `lib/db-worker.ts` additions

```typescript
async getDynamicPricing(): Promise<{ entries: DynamicPricingEntry[]; servedFrom: 'kv' | 'baseline' }>;
async getDynamicPricingMeta(): Promise<DynamicPricingMeta>;
```

Implemented as thin RPC wrappers, mirroring the existing `listModelPricing()` pattern.

**Type sourcing**: there is no `@pew/worker-read` source alias in the web tsconfig (verified). C4 inlines the `DynamicPricingEntry` / `DynamicPricingMeta` interfaces in `lib/db-worker.ts` (or a sibling `lib/dynamic-pricing-dto.ts`) as web-side DTOs that match the worker's shape exactly. A contract test in `route.test.ts` round-trips a representative payload to ensure shape parity. Future C5 may collapse this duplication once the cost path also reads dynamic types — but introducing a cross-package alias is out of scope for C4.

### `app/(dashboard)/admin/model-prices/page.tsx`

Client component, mirroring the existing `(dashboard)/admin/pricing/page.tsx` pattern:

```typescript
"use client";

import { useAdmin } from "@/hooks/use-admin";

export default function ModelPricesPage() {
  const { isAdmin, isLoading } = useAdmin();
  if (isLoading) return <PricingSkeleton />;
  if (!isAdmin) return <ForbiddenView />;

  // useSWR or useEffect+fetch on /api/admin/pricing/models
  const { data, error } = usePricingModels();
  if (error) return <ErrorBanner error={error} />;
  if (!data) return <PricingSkeleton />;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Model Prices</h1>
      <PricingMetaBanner meta={data.meta} servedFrom={data.servedFrom} />
      <PricingTable entries={data.entries} />
    </div>
  );
}
```

Auth pattern (`useAdmin()` + redirect/forbidden view) matches existing `/admin/pricing/page.tsx`. No new auth helper introduced.

### `pricing-meta-banner.tsx` (client)

Renders:
- `lastSyncedAt` as relative time + absolute UTC tooltip.
- Stale warning (yellow) when `lastSyncedAt > 36h ago`; danger (red) when `> 7d ago`.
- `servedFrom: 'baseline'` → orange banner: "Showing bundled baseline — KV cache is empty (cold start) or worker-read is unreachable."
- `lastErrors[]`: one line per source. Each line is `[source] message — at <time>`. Empty/null → no row.
- Origin counts: `baseline N · openrouter N · models.dev N · admin N` as a small footer chip row.

No write actions in C4 — the "Force sync now" button arrives in C6.

### `pricing-table.tsx` (client)

Columns:
| Model | Provider | Display name | Input | Output | Cached | Context | Origin | Updated |

Features:
- Sort by any column (default: provider asc, model asc).
- Filter input: case-insensitive substring match on model + displayName + provider.
- Origin column rendered as a colored chip per the main design doc (baseline=gray, models.dev=green, openrouter=blue, admin=purple).
- Aliases shown in a hover tooltip on the model cell.
- Numeric columns right-aligned; null cached/context shown as "—".
- Empty state when entries array is empty: "No pricing data available — check the meta banner for sync status."

Pure presentation; no data fetching. Receives `entries` as a prop.

## Tests

### `route.test.ts`

```typescript
test('401 when unauthenticated')
test('403 when authenticated but not admin')
test('returns entries + meta + servedFrom for admin')
test('503 with fallback shape when worker-read throws')
test('cache-control: private, no-store')
test('contract: response shape round-trips a representative DynamicPricingEntry/Meta')
```

Mocks `getDbRead()` and `isAdminUser()` per existing `app/api/organizations/mine/route.test.ts` pattern; no real worker-read.

### `pricing-table-helpers.test.ts`

The C4 spec deliberately keeps table behavior in pure helpers because the project does **not** currently depend on `@testing-library/react` (verified — no such dep in `packages/web/package.json`). Introducing a UI test library is out of scope.

```typescript
test('sortEntries: default sort is [provider asc, model asc]')
test('sortEntries: column toggle reverses direction')
test('sortEntries: numeric columns sort numerically not lexicographically')
test('filterEntries: case-insensitive substring match on model + displayName + provider')
test('filterEntries: empty filter returns all entries')
test('originChipClass: returns the expected color class per origin')
test('formatNullable: null context renders as "—"')
```

The React components themselves are thin wrappers around these helpers and validated manually via `bun run dev`. If a future commit adds `@testing-library/react`, component-level tests can be filled in then.

### Existing tests

`/api/pricing/route.test.ts` (if present) and all cost-calc unit tests stay green — C4 makes zero behavioral changes to the existing path.

## Conventions followed

- Page lives under `(dashboard)` route group and inherits the dashboard layout.
- Server / client component split mirrors existing pages like `(dashboard)/sessions/page.tsx`.
- RPC method names in `db-worker.ts` match the worker-side names exactly (`getDynamicPricing`, `getDynamicPricingMeta`).
- Tests use vitest + `@testing-library/react` per repo norm.
- Type re-export pattern (`lib/dynamic-pricing-types.ts`) follows the existing `lib/rpc-types.ts` precedent.

## What this commit does NOT do

- Does not change `/api/pricing` or `lib/pricing.ts`.
- Does not change any cost calculation, chart, or summary.
- Does not add a "Force sync now" button (C6).
- Does not add edit/admin write actions on the page (admin CRUD lives in the existing admin section).
- Does not modify worker-read.

## Acceptance

- `bun run --filter @pew/web typecheck` green.
- `bun run --filter @pew/web test` green (new + old).
- `bun run lint` green.
- `bun run dev`, log in as admin, visit `/admin/model-prices`:
  - Table renders all entries.
  - Meta banner shows `lastSyncedAt`.
  - When worker-read KV is empty, banner shows orange `servedFrom=baseline` notice and table shows the bundled baseline rows.
  - Filter + sort work without page reload.
- Non-admin user visiting `/admin/model-prices` sees the standard forbidden view (same as other admin pages).
- Existing `/dashboard` charts and cost summaries render identical numbers as before C4.
- `/admin/pricing` (existing Token Pricing CRUD) is untouched and renders identically.
