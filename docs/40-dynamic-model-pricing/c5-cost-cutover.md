# C5 — Cost path cutover (`lib/pricing.ts`)

## Scope

The single behavioral switch in this initiative. After C5:

- `buildPricingMap()` consumes the dynamic dataset (worker-read RPC) on top of D1 admin rows.
- `DEFAULT_MODEL_PRICES` is removed; the 14-entry baseline is now embedded in `model-prices.json` (via C2's regression floor) and read through worker-read.
- `DEFAULT_PREFIX_PRICES`, `DEFAULT_SOURCE_DEFAULTS`, `DEFAULT_FALLBACK` stay as the safety net beneath dynamic data.
- `/api/pricing` keeps its response shape (`PricingMap`) — only its internal source changes.

C5 is the only commit reviewers should expect cost-calculation diffs from. Every prior commit was additive.

## Files modified

```
packages/web/src/lib/pricing.ts                     # remove DEFAULT_MODEL_PRICES; new buildPricingMap signature; client-safe DynamicPricingEntry type
packages/web/src/lib/load-pricing-map.ts            # NEW — server helper: fetch dynamic + dbRows with partial degradation, build PricingMap
packages/web/src/lib/load-pricing-map.test.ts       # NEW — partial-degradation matrix
packages/web/src/app/api/pricing/route.ts           # use loadPricingMap(db)
packages/web/src/app/api/usage/by-device/route.ts   # use loadPricingMap(db) (was buildPricingMap(rows) directly)
packages/web/src/lib/db.ts                          # add getDynamicPricing/getDynamicPricingMeta to DbRead interface
packages/web/src/lib/db-worker.ts                   # (impl from C4) type-only import of DynamicPricingEntry from lib/pricing.ts
packages/web/src/__tests__/test-utils.ts            # extend DbRead mock factory with the two new methods
packages/web/src/__tests__/pricing.test.ts          # update assertions for new buildPricingMap signature
packages/web/src/lib/pricing-cutover.test.ts        # NEW — proves identical PricingMap for the 14 legacy models
packages/web/src/app/api/pricing/route.test.ts      # update mocks to use loadPricingMap path
packages/web/src/app/api/usage/by-device/route.test.ts  # update mocks for loadPricingMap path
```

No changes to chart components, RPC layer beyond what was added in C3/C4, or any worker file.

### Why a `loadPricingMap(db)` helper

Two server entry points compute cost from a `PricingMap`: `/api/pricing` (returns the map) and `/api/usage/by-device` (uses it inline for `estimated_cost`). Inlining the dynamic+DB+fallback policy in two places guarantees drift. C5 introduces a single helper so both routes share one implementation of:

- Parallel fetch of `db.getDynamicPricing()` and `db.listModelPricing()`.
- Per-source degradation (see below).
- Final `buildPricingMap({ dynamic, dbRows })` call.

## Module contracts

### `lib/pricing.ts` — diff

Remove:
```typescript
export const DEFAULT_MODEL_PRICES: Record<string, ModelPricing> = { ... 14 entries ... };
```

Add the client-safe DTO type at the top of the module (so client code that imports `getDefaultPricingMap` does not transitively pull `db-worker.ts` server code):

```typescript
// lib/pricing.ts — client-safe. No server-only imports allowed in this file.
export interface DynamicPricingEntry {
  model: string;
  provider: string;
  displayName: string | null;
  inputPerMillion: number;
  outputPerMillion: number;
  cachedPerMillion: number | null;
  contextWindow: number | null;
  origin: 'baseline' | 'openrouter' | 'models.dev' | 'admin';
  updatedAt: string;
  aliases?: string[];
}
```

`db-worker.ts` (server-only) drops its inline DTO from C4 and switches to a **type-only** import:
```typescript
import type { DynamicPricingEntry } from "./pricing";
```

`lib/db.ts` `DbRead` interface gains the two C4 methods so callers can type their `db` parameter against the interface (not the concrete worker impl):
```typescript
interface DbRead {
  // ... existing methods
  getDynamicPricing(): Promise<{ entries: DynamicPricingEntry[]; servedFrom: 'kv' | 'baseline' }>;
  getDynamicPricingMeta(): Promise<DynamicPricingMeta>;
}
```

Test-utils mock factory for `DbRead` is extended with default stubs for both — otherwise any test that builds a fake `DbRead` through the factory would fail typecheck post-C5.

This keeps `lib/pricing.ts` free of server imports — `useSWR(... /api/pricing)` consumers and `use-pricing.ts` (which imports `getDefaultPricingMap`) stay in the client bundle without dragging `db-worker` along.

Replace `buildPricingMap` signature:

```typescript
// before (C0..C4)
export function buildPricingMap(dbRows: DbPricingRow[]): PricingMap;

// after (C5)
export interface BuildPricingMapInput {
  dynamic: DynamicPricingEntry[];
  dbRows: DbPricingRow[];
}
export function buildPricingMap(input: BuildPricingMapInput): PricingMap;
```

New body:
```typescript
export function buildPricingMap({ dynamic, dbRows }: BuildPricingMapInput): PricingMap {
  const map: PricingMap = {
    models: {},                                 // was {...DEFAULT_MODEL_PRICES}
    prefixes: [...DEFAULT_PREFIX_PRICES],
    sourceDefaults: { ...DEFAULT_SOURCE_DEFAULTS },
    fallback: DEFAULT_FALLBACK,
  };

  // 1. Layer dynamic entries (baseline → openrouter → models.dev → admin from sync layer).
  //    Already merged in C1; just project to ModelPricing.
  for (const entry of dynamic) {
    map.models[entry.model] = {
      input: entry.inputPerMillion,
      output: entry.outputPerMillion,
      ...(entry.cachedPerMillion != null ? { cached: entry.cachedPerMillion } : {}),
    };
    // Aliases get the same pricing pointer.
    if (entry.aliases) {
      for (const alias of entry.aliases) {
        if (!(alias in map.models)) map.models[alias] = map.models[entry.model];
      }
    }
  }

  // 2. Apply admin DB rows (existing semantics preserved):
  //    - row.source != null → write sourceDefaults[source] AND models[model]
  //    - row.source == null → write models[model]
  for (const row of dbRows) {
    const pricing: ModelPricing = {
      input: row.input,
      output: row.output,
      ...(row.cached != null ? { cached: row.cached } : {}),
    };
    if (row.source) map.sourceDefaults[row.source] = pricing;
    map.models[row.model] = pricing;
  }

  return map;
}
```

`getDefaultPricingMap()` keeps existing semantics for callers without a DB (returns the **prefix/source/fallback** safety net only — no exact-match models). This is what falls through when both the worker is unreachable AND we have no DB.

`lookupPricing()`, `estimateCost()`, `formatCost()`, `getModelPricing()` unchanged.

### `lib/load-pricing-map.ts` — new server helper

```typescript
import type { DbRead } from "./db";
import {
  buildPricingMap,
  getDefaultPricingMap,
  type PricingMap,
} from "./pricing";

// Narrowed to the two methods we need so test mocks don't have to satisfy the
// full DbRead surface.
type PricingMapDb = Pick<DbRead, "getDynamicPricing" | "listModelPricing">;

/**
 * Server-only. Imports `db` (RPC client). Do NOT import from client code.
 *
 * Partial-degradation policy:
 *   - Both succeed   → buildPricingMap({ dynamic, dbRows })
 *   - dynamic fails  → buildPricingMap({ dynamic: [], dbRows })  (admin overlay still applied)
 *   - dbRows fails   → buildPricingMap({ dynamic, dbRows: [] })  (dynamic still applied)
 *   - Both fail      → getDefaultPricingMap()                    (prefix/source/fallback only)
 *
 * Each failure is logged with its source tag. The map ALWAYS returns; callers
 * never see exceptions from this helper.
 */
export async function loadPricingMap(db: PricingMapDb): Promise<PricingMap> {
  const [dynamicSettled, dbSettled] = await Promise.allSettled([
    db.getDynamicPricing(),
    db.listModelPricing(),
  ]);

  const dynamic =
    dynamicSettled.status === "fulfilled" ? dynamicSettled.value.entries : [];
  const dbRows = dbSettled.status === "fulfilled" ? dbSettled.value : [];

  if (dynamicSettled.status === "rejected") {
    console.error("loadPricingMap: getDynamicPricing failed", dynamicSettled.reason);
  }
  if (dbSettled.status === "rejected") {
    console.error("loadPricingMap: listModelPricing failed", dbSettled.reason);
  }

  if (dynamicSettled.status === "rejected" && dbSettled.status === "rejected") {
    return getDefaultPricingMap();
  }

  return buildPricingMap({ dynamic, dbRows });
}
```

### `app/api/pricing/route.ts` — diff

```typescript
// before
const results = await db.listModelPricing();
const pricingMap = buildPricingMap(results);

// after
const pricingMap = await loadPricingMap(db);
```

Response shape is unchanged. No new fields. No version bump.

### `app/api/usage/by-device/route.ts` — diff

The existing inline try/catch at lines 114–122 is replaced with the same helper:

```typescript
// before
let pricingMap;
try {
  const pricingRows = await db.listModelPricing();
  pricingMap = buildPricingMap(pricingRows);
} catch {
  pricingMap = getDefaultPricingMap();
}

// after
const pricingMap = await loadPricingMap(db);
```

The route now picks up dynamic entries for non-legacy models (e.g. `deepseek-v3.1`) automatically — same behavior as `/api/pricing`. Per-device cost numbers for the 14 legacy models stay byte-identical (proven via the cutover test plus existing by-device tests).

### Removed exports

- `DEFAULT_MODEL_PRICES` — deleted. Any importer outside `lib/pricing.ts` is a breakage that must be fixed in this same commit. (Per N6 in the design doc and codex's lifecycle note in C2.)

Confirmed importers as of C0 baseline (must be audited in implementation):
- `lib/pricing.ts` (self) — internal use only.
- C2's `model-prices.test.ts` — already decoupled via `LEGACY_DEFAULT_MODEL_PRICES` frozen copy. ✅

If any other importer surfaces during implementation, the choice is: replace with `lookupPricing(getDefaultPricingMap(), …)` if it wanted a safety-net price, or fetch through `/api/pricing` if it wanted the real merged map.

## Tests

### `pricing-cutover.test.ts` (new — the central proof)

The whole point of C5 is that for every model the previous code priced via `DEFAULT_MODEL_PRICES`, the new code returns an identical `ModelPricing` object. This test makes that property explicit and unkillable:

```typescript
import baselineEntries from "@pew-worker-read/data/model-prices.json";

// Frozen 14-entry copy of the pre-C5 DEFAULT_MODEL_PRICES table.
// Duplicated inline (not imported) on purpose — the regression-floor JSON in
// worker-read carries the same numbers, but pinning them here makes this test
// independent of any other file's mutation. 14 entries is small enough that
// duplication is preferable to a brittle cross-package test-file import.
const LEGACY_DEFAULT_MODEL_PRICES: Record<string, ModelPricing> = {
  // ... 14 entries copied verbatim from the pre-C5 DEFAULT_MODEL_PRICES ...
};

test("for every legacy model, buildPricingMap({dynamic: baseline, dbRows: []}) returns identical pricing", () => {
  const map = buildPricingMap({ dynamic: baselineEntries, dbRows: [] });
  for (const [model, expected] of Object.entries(LEGACY_DEFAULT_MODEL_PRICES)) {
    expect(map.models[model]).toEqual(expected);
  }
});

test("admin row with source=null still wins over dynamic baseline for that model", () => {
  const map = buildPricingMap({
    dynamic: baselineEntries,
    dbRows: [{ id: 1, model: "claude-sonnet-4-20250514", input: 99, output: 199, cached: 9.9, source: null, ... }],
  });
  expect(map.models["claude-sonnet-4-20250514"]).toEqual({ input: 99, output: 199, cached: 9.9 });
});

test("admin row with source='codex' writes both sourceDefaults['codex'] and models[model]", () => {
  const map = buildPricingMap({
    dynamic: baselineEntries,
    dbRows: [{ id: 1, model: "gpt-4o", input: 7, output: 21, cached: 1.5, source: "codex", ... }],
  });
  expect(map.sourceDefaults["codex"]).toEqual({ input: 7, output: 21, cached: 1.5 });
  expect(map.models["gpt-4o"]).toEqual({ input: 7, output: 21, cached: 1.5 });
});

test("alias resolves to the canonical entry's pricing", () => {
  // Pick an alias from baseline (e.g. 'claude-sonnet-4' -> 'anthropic/claude-sonnet-4')
  const map = buildPricingMap({ dynamic: baselineEntries, dbRows: [] });
  // Find an entry with an alias and assert
});

test("dynamic empty + dbRows empty → models is empty (only safety net survives)", () => {
  const map = buildPricingMap({ dynamic: [], dbRows: [] });
  expect(map.models).toEqual({});
  expect(map.prefixes).toEqual(DEFAULT_PREFIX_PRICES);
  expect(map.sourceDefaults).toEqual(DEFAULT_SOURCE_DEFAULTS);
});
```

The cross-package import for `baselineEntries` (`@pew-worker-read/...`) is the same path C2 introduced for the regression test. If that resolution is awkward at the web-package layer, copy the JSON into a fixture under `packages/web/src/__fixtures__/` — duplication of pinned data is acceptable to keep the test self-contained.

### `pricing.test.ts` updates

- All callers of `buildPricingMap(rows)` switched to `buildPricingMap({ dynamic: [], dbRows: rows })`. DB overlay semantics are preserved; **exact legacy equivalence for the 14 baked-in models is covered by `pricing-cutover.test.ts` with baseline dynamic entries** (not by these tests, since `dynamic=[]` no longer materializes the legacy exact-match table).
- One new case: `buildPricingMap({ dynamic, dbRows })` with both populated, verifying admin wins over dynamic for the same model.
- Snapshot for `getDefaultPricingMap()` updates: `models` is now `{}` (was 14 entries). This is expected and documented in the commit message.

### `load-pricing-map.test.ts` (new — partial-degradation matrix)

```typescript
test("both succeed → buildPricingMap with both inputs")
test("getDynamicPricing rejects, listModelPricing resolves → dynamic=[], dbRows applied (NOT full fallback)")
test("listModelPricing rejects, getDynamicPricing resolves → dynamic applied, dbRows=[] (NOT full fallback)")
test("both reject → getDefaultPricingMap() (safety net only)")
test("both reject → both errors logged with source tag")
test("never throws — even when db.* throws synchronously")
```

Mocks the `PricingMapDb` shape (the narrowed `Pick<DbRead, ...>` from the helper); no real RPC. The matrix exists so that future regressions in either degradation branch fail loudly.

### `route.test.ts` updates (api/pricing)

- Mock `loadPricingMap` directly (single seam) instead of mocking the two RPC methods.
- Existing success / error assertions stay; they now verify that the route surfaces whatever map the helper returns.

### `by-device/route.test.ts` updates

- Replace the existing `listModelPricing` mock with a `loadPricingMap` mock returning a representative `PricingMap`.
- New case: when `loadPricingMap` returns `getDefaultPricingMap()` (both-fail path), per-device `estimated_cost` falls through to prefix/source/fallback for legacy models, matching pre-C5 behavior modulo the missing exact-match table. Document the expected-cost delta in the test name (it is intentional — exact-match data is now sourced from dynamic, and dynamic was unreachable in this branch).

### Existing chart / dashboard tests

Stay green. `lookupPricing` returns identical numbers for every legacy model (proven by `pricing-cutover.test.ts`); for any model not in the legacy table, behavior either stays identical (when prefix matches) or is more accurate (when dynamic data covers it).

## Conventions followed

- Unchanged `lookupPricing` / `estimateCost` / `formatCost` API surface.
- Removal of `DEFAULT_MODEL_PRICES` is clean (no `// removed in C5` comment, no shim re-export).
- `buildPricingMap` signature change is breaking for callers — all callers in the repo are updated in the same commit.
- All server cost paths go through `loadPricingMap(db)` — no inline duplication of the dynamic+DB+fallback policy.
- `lib/pricing.ts` stays **client-safe**: no server-only imports added. `DynamicPricingEntry` lives here; `db-worker.ts` imports it as `type`-only.
- New test file naming follows `__tests__/`-style where the rest of the package puts them; placed alongside the code it covers.

## What this commit does NOT do

- Does not introduce admin invalidation (C6) — admin writes still leave `pricing:dynamic` stale until next cron tick.
- Does not add the "Force sync now" button (C6).
- Does not touch any worker-read or scripts/ file.
- Does not change `/api/admin/pricing/models` or the `/admin/model-prices` page.

## Acceptance

- `bun run --filter @pew/web typecheck` green.
- `bun run --filter @pew/web test` green — including the new `pricing-cutover.test.ts` and `load-pricing-map.test.ts`.
- `bun run lint` green.
- `bun run dev`:
  - `/dashboard` renders cost numbers identical to pre-C5 within ±0 cents for the 14 legacy models (manual spot check + the cutover test guarantees this).
  - `/api/usage/by-device` returns identical `estimated_cost` per device for legacy models; non-legacy models now use dynamic prices instead of `DEFAULT_FALLBACK`.
  - For models *not* in the 14 legacy set (e.g. `deepseek-v3.1`), cost now uses the dynamic price instead of falling through to `DEFAULT_FALLBACK`.
  - With worker-read deliberately broken (kill `getDynamicPricing`), routes still serve admin DB rows + safety net (no 5xx); with D1 deliberately broken, routes still serve dynamic + safety net.
- Existing E2E tests stay green.
- `git grep DEFAULT_MODEL_PRICES packages/web/` returns nothing after this commit. The only frozen copy lives inline in `pricing-cutover.test.ts` (and the regression-floor copy in `worker-read/src/data/model-prices.test.ts` from C2).

## Rollback plan

Single-commit revert restores pre-C5 behavior. Because C1–C4 are additive, reverting only C5 leaves the dynamic data publishing path intact (the `/admin/model-prices` page and worker cron still work) — only the cost path goes back to static.
