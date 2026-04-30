# C6 — Admin invalidation + rebuild + "Force sync now"

## Scope

Last commit. Wires the existing admin pricing CRUD (`/api/admin/pricing`) to the dynamic pricing pipeline so that admin writes do not leave `pricing:dynamic` stale until the next cron tick. Also exposes a manual "Force sync now" affordance on the C4 `/admin/model-prices` page for operators when an upstream source has just recovered.

Concretely:

- Worker-read gains a single new RPC method `pricing.rebuildDynamicPricing` (admin-gated, write-capable).
- Web admin `POST` / `PUT` / `DELETE` on `/api/admin/pricing` invalidate `pricing:all` (existing) AND call the new RPC.
- C4's `/admin/model-prices` page gets a "Force sync now" button that triggers the same RPC via a new admin-only proxy route.
- No changes to `lib/pricing.ts`, `lib/load-pricing-map.ts`, cost calculation, charts, or schema.

C6 is the only commit that introduces an admin **write surface** on the dynamic pricing pipeline. C3 deliberately did not register this RPC.

## Files added

```
packages/web/src/app/api/admin/pricing/rebuild/
├── route.ts                                          # POST → triggers worker rebuild; admin-only
└── route.test.ts                                     # auth + RPC delegation + error handling

packages/web/src/app/(dashboard)/admin/model-prices/
└── force-sync-button.tsx                             # client component; POSTs to /api/admin/pricing/rebuild
```

## Files modified

```
packages/worker-read/src/rpc/pricing.ts               # register pricing.rebuildDynamicPricing handler
packages/worker-read/src/rpc/pricing.test.ts          # tests for new handler
packages/worker-read/src/index.ts                     # route the new RPC method
packages/web/src/app/api/admin/pricing/route.ts       # POST/PUT/DELETE → invalidate + rebuild after write
packages/web/src/app/api/admin/pricing/route.test.ts  # extend tests for invalidate + rebuild side effects
packages/web/src/lib/db.ts                            # add rebuildDynamicPricing() to DbRead (write-capable RPC, but lives on read-worker per existing pattern)
packages/web/src/lib/db-worker.ts                     # implement rebuildDynamicPricing() RPC wrapper
packages/web/src/__tests__/test-utils.ts              # extend DbRead mock factory with rebuildDynamicPricing default stub
packages/web/src/app/(dashboard)/admin/model-prices/page.tsx  # mount <ForceSyncButton/>
```

No changes to schema, baseline JSON, sync core, or cost path.

## Module contracts

### `worker-read/src/rpc/pricing.ts` — new handler

```typescript
export interface RebuildDynamicPricingRequest {
  method: "pricing.rebuildDynamicPricing";
  // No params — orchestrator reads admin rows + cached upstream JSON internally.
}

export interface RebuildDynamicPricingResponse {
  ok: boolean;
  entriesWritten: number;
  warnings: string[];
  errors: Array<{ source: 'openrouter' | 'models.dev' | 'd1' | 'kv'; message: string }>;
  meta: DynamicPricingMeta;
}
```

Behavior:

1. **Admin gate**: reuse the same `isAdminUser`/auth helper that `pricing.listModelPricing` write paths use. Reject with the existing RPC-level 403 shape on failure. (The exact admin-gating helper lives in `worker-read/src/rpc/admin.ts`; C6 reuses it without modification.)
2. **Invocation policy**: by default, the orchestrator **does not refetch upstream** — it merges admin D1 + last cached `openrouter` / `models.dev` JSON + bundled baseline. Pass `{ forceRefetch: true }` only when called by the "Force sync now" UI (see below).
3. Calls `syncDynamicPricing(env, new Date().toISOString(), { forceRefetch })` — the same orchestrator C3 wired up, no duplication.
4. Returns the full `SyncOutcome` so the UI can surface partial-failure diagnostics inline.

The `forceRefetch` parameter is passed to the orchestrator via the existing `options` argument C3 already defined. Concrete plumbing:
- Admin CRUD invalidation path → `forceRefetch: false` (cheap, no upstream calls — D1 is the source of truth being mutated).
- "Force sync now" button → `forceRefetch: true` (operator just wants fresh upstream).

C3's orchestrator already accepts `options.forceRefetch`; it must skip the per-source `pricing:last-fetch:*` cache and always hit upstream when set. C6 exercises that branch — if C3's implementation didn't actually wire the option through, C6 fixes it as a 1-line follow-up. (Spec calls this out explicitly so the reviewer doesn't expect a wholly new orchestrator parameter to appear.)

### `web/app/api/admin/pricing/route.ts` — diff per write verb

After every successful `POST` / `PUT` / `DELETE` (i.e. `meta.changes >= 1` for PUT, `INSERT` returned a row for POST, `meta.changes === 1` for DELETE), run side effects in this order:

```typescript
// after the existing successful response is built but BEFORE returning:
await Promise.allSettled([
  dbRead.invalidateCacheKey("pricing:all"),
  dbRead.rebuildDynamicPricing(),
]);
// then return the existing response.
```

Rules:
- **`Promise.allSettled`, not `Promise.all`** — a transient KV/RPC failure must not flip a successful 201/200 into a 500. The DB write already succeeded; the side effects are best-effort.
- Each rejected settled result is logged with a source tag (`pricing:all` or `rebuildDynamicPricing`). No retry — next admin write or next cron will heal it.
- Write verbs that return 4xx (validation failure, conflict, not-found) **skip** side effects — nothing to invalidate.
- The side-effect block does NOT block the response contract; clients still get the same JSON shape they got pre-C6.

This invalidation pattern (best-effort, post-success, allSettled) matches the existing `app/api/admin/cache/` route's discipline.

### `web/app/api/admin/pricing/rebuild/route.ts` — new

```typescript
export async function POST(request: Request): Promise<Response>;
```

Behavior:
1. `const admin = await resolveAdmin(request);` — null → 403 (matches sibling `route.ts`).
2. `const dbRead = await getDbRead();`
3. `const outcome = await dbRead.rebuildDynamicPricing({ forceRefetch: true });`
4. Return `NextResponse.json(outcome, { status: outcome.ok ? 200 : 207, headers: { 'cache-control': 'private, no-store' } })`.
   - `207 Multi-Status` for partial-success conveys "rebuild ran but some sources failed" without flagging the operator's click as a hard error.
5. On RPC throw: 502 with `{ error, fallback: null }`. Log the failure.

Method is `POST` (not `GET`) because it has side effects (KV writes, possible upstream fetches). No CSRF concern beyond the existing admin session cookie posture used by the rest of `/api/admin/*`.

### `web/app/(dashboard)/admin/model-prices/force-sync-button.tsx` — new

```typescript
"use client";

export function ForceSyncButton({ onComplete }: { onComplete?: (outcome: SyncOutcome) => void }) {
  const [state, setState] = useState<'idle' | 'syncing' | 'ok' | 'error'>('idle');
  const [outcome, setOutcome] = useState<SyncOutcome | null>(null);
  // POST /api/admin/pricing/rebuild; on success setState('ok'); render outcome below button
  // (entries written, per-source error chips). 30s debounce — disabled while in-flight.
}
```

Mounted at the top of `/admin/model-prices/page.tsx`, next to the meta banner. Calls `mutate()` on the page's SWR key after success so the table + meta banner refresh without a hard reload.

The button is intentionally minimal: no scheduling UI, no per-source toggles. C6's job is to expose the lever, not to build a sync-management dashboard.

### `lib/db.ts` and `lib/db-worker.ts` additions

```typescript
// db.ts — DbRead interface
rebuildDynamicPricing(options?: { forceRefetch?: boolean }): Promise<SyncOutcome>;

// db-worker.ts — RPC wrapper
async rebuildDynamicPricing(options?: { forceRefetch?: boolean }): Promise<SyncOutcome> {
  return this.call("pricing.rebuildDynamicPricing", options ?? {});
}
```

`SyncOutcome` is the same type C3 exported from `sync/orchestrator.ts`. Web side imports the type only (no runtime), reusing the same type-only-import discipline established for `DynamicPricingEntry` in C5.

### `__tests__/test-utils.ts` — mock factory

`createMockDbRead()` gains a default `rebuildDynamicPricing: vi.fn().mockResolvedValue({ ok: true, entriesWritten: 0, warnings: [], errors: [], meta: STUB_META })`. Without this, every existing admin-pricing-route test that constructs a `DbRead` mock would fail typecheck post-C6.

## Tests

### `worker-read/src/rpc/pricing.test.ts` additions

- `pricing.rebuildDynamicPricing` rejects non-admin caller with the existing 403 shape.
- Admin call with `forceRefetch: false` skips upstream fetch (assert `fetch` not called) and writes KV from D1 + cached `last-fetch:*`.
- Admin call with `forceRefetch: true` calls upstream (mocked) and refreshes per-source caches.
- Returns full `SyncOutcome` shape; `ok: false` propagates partial failures.
- Two concurrent rebuild calls don't corrupt KV (last-write-wins is fine because merge is deterministic for the same inputs — verified by asserting the second write equals the first).

### `web/app/api/admin/pricing/route.test.ts` additions

For each of `POST`, `PUT`, `DELETE`:

- After a successful write, `dbRead.invalidateCacheKey('pricing:all')` is called exactly once.
- After a successful write, `dbRead.rebuildDynamicPricing()` is called exactly once with no args (default = no upstream refetch).
- When the DB write returns 4xx (validation / conflict / not-found), neither side-effect call is invoked.
- When `invalidateCacheKey` rejects, the route still returns the successful write response (logged).
- When `rebuildDynamicPricing` rejects, the route still returns the successful write response (logged).
- When both side effects reject, the route still returns the successful write response (both errors logged).

### `web/app/api/admin/pricing/rebuild/route.test.ts` (new)

- 403 when `resolveAdmin` returns null.
- Calls `dbRead.rebuildDynamicPricing({ forceRefetch: true })` exactly once.
- Returns 200 + outcome JSON when `outcome.ok === true`.
- Returns 207 + outcome JSON when `outcome.ok === false` and `outcome.entriesWritten > 0` (partial success).
- Returns 502 when the RPC throws.
- `cache-control: private, no-store` header set.

### Existing tests

- All C3/C4/C5 tests stay green — C6 adds methods, never modifies existing semantics.
- E2E: admin POSTs a new model row → page refresh → row appears in `/admin/model-prices` table with `origin='admin'` (proves rebuild ran).

## Conventions followed

- Admin RPC handler lives in the existing `pricing.ts` module alongside read methods (matches existing `pricing.listModelPricing` location for admin-write endpoints in this project; the `worker-read` name reflects historic split, not a hard read-only constraint — admin writes are already routed here, e.g. `cache.invalidate`).
- Side-effect ordering uses `Promise.allSettled` and post-success placement, matching `app/api/admin/cache/route.ts`.
- Force-sync UI is a single client component, no new state library; uses the same SWR cache key the page already owns.
- New 207 status code is used only for the operator-facing rebuild endpoint; CRUD endpoints stay strictly 2xx/4xx/5xx.

## What this commit does NOT do

- Does not change cost calculation, `lib/pricing.ts`, or `lib/load-pricing-map.ts`.
- Does not change the cron schedule or `wrangler.toml`.
- Does not introduce per-source manual toggles (e.g. "refresh only OpenRouter") — out of scope; would warrant its own commit.
- Does not change the baseline JSON, schema, or any worker-read storage layout.
- Does not change `/api/pricing` or its response shape.
- Does not auto-rebuild on schema migrations or on app startup — admin write and cron are the only triggers.

## Acceptance

- `bun run --filter @pew/worker-read test` green (new + existing).
- `bun run --filter @pew/web test` green (new + existing).
- `bun run --filter @pew/web typecheck` and `bun run --filter @pew/worker-read typecheck` green.
- `bun run lint` green.
- `bun run dev`, log in as admin:
  - Visit `/admin/pricing`, add a new model pricing row → 201 returned → within the same request lifecycle, `pricing:all` is invalidated AND `pricing:dynamic` reflects the new row (verified by visiting `/admin/model-prices` immediately after — no manual refresh window).
  - Visit `/admin/model-prices`, click "Force sync now" with worker-read reachable and upstream available → button shows "Synced N entries" within ~3s; meta banner `lastSyncedAt` jumps to now; `lastErrors` cleared.
  - Click "Force sync now" with one upstream killed (e.g. block models.dev in the network panel) → button shows partial success; meta banner shows orange warning + the per-source error chip; entries from the surviving source are still written.
  - Click "Force sync now" as a non-admin → 403 from the proxy route; button surfaces the error inline.
- E2E: editing an admin pricing row updates the dashboard cost numbers within the same browser session (no waiting for the cron tick).

## Rollback plan

Single-commit revert restores pre-C6 behavior. CRUD endpoints revert to write-without-invalidate; `pricing:dynamic` goes stale until the next cron tick (the documented C5 trade-off). `/admin/model-prices` loses the force-sync button but the page itself stays functional. The orchestrator stays callable via cron — no operational regression on the read path.

If only the CRUD invalidation hookup needs reverting (e.g. it produces unexpected RPC load), drop the `Promise.allSettled` block and keep the new RPC + force-sync route + button. The button gives operators a manual lever while the auto-invalidate is debugged.
