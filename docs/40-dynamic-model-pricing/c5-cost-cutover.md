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
packages/web/src/lib/pricing.ts                     # remove DEFAULT_MODEL_PRICES; new buildPricingMap signature
packages/web/src/app/api/pricing/route.ts           # fetch dynamic entries from worker-read; pass to buildPricingMap
packages/web/src/lib/db-worker.ts                   # (already added in C4) used here, no further change
packages/web/src/__tests__/pricing.test.ts          # update assertions for new buildPricingMap signature
packages/web/src/lib/pricing-cutover.test.ts        # new — proves identical PricingMap for the 14 legacy models
packages/web/src/app/api/pricing/route.test.ts      # update mocks to include getDynamicPricing
```

No changes to chart components, RPC layer beyond what was added in C3/C4, or any worker file.

## Module contracts

### `lib/pricing.ts` — diff

Remove:
```typescript
export const DEFAULT_MODEL_PRICES: Record<string, ModelPricing> = { ... 14 entries ... };
```

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

### `app/api/pricing/route.ts` — diff

```typescript
// before
const results = await db.listModelPricing();
const pricingMap = buildPricingMap(results);

// after
const [dynamicResp, dbRows] = await Promise.all([
  db.getDynamicPricing(),       // { entries, servedFrom }
  db.listModelPricing(),
]);
const pricingMap = buildPricingMap({ dynamic: dynamicResp.entries, dbRows });
```

Error fallback stays the same shape (`getDefaultPricingMap()`), but now applies when **either** RPC fails. Log the failed RPC; return the static safety net.

Response shape is unchanged. No new fields. No version bump.

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
import { LEGACY_DEFAULT_MODEL_PRICES } from "@pew-worker-read/data/model-prices.test";  // re-export the frozen copy
import baselineEntries from "@pew-worker-read/data/model-prices.json";

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

The cross-package import in the test (`@pew-worker-read/...`) follows whatever module-resolution pattern is set up in C2 for the test file location. If that resolution is awkward, copy the constant into this test file too — duplication of 14 entries is acceptable here because both copies are pinned by the same intent.

### `pricing.test.ts` updates

- All callers of `buildPricingMap(rows)` switched to `buildPricingMap({ dynamic: [], dbRows: rows })`. Behavior is identical when `dynamic` is empty — the test exercises pure DB-overlay semantics.
- One new case: `buildPricingMap({ dynamic, dbRows })` with both populated, verifying admin wins over dynamic for the same model.
- Snapshot for `getDefaultPricingMap()` updates: `models` is now `{}` (was 14 entries). This is expected and documented in the commit message.

### `route.test.ts` updates

- Add mock for `getDynamicPricing()` returning `{ entries: [], servedFrom: 'baseline' }` in the success path.
- New case: when `getDynamicPricing` rejects but `listModelPricing` resolves, route returns `getDefaultPricingMap()` (existing fallback behavior).
- New case: when both reject, route returns `getDefaultPricingMap()` and logs both errors.

### Existing chart / dashboard tests

Stay green. `lookupPricing` returns identical numbers for every legacy model (proven by `pricing-cutover.test.ts`); for any model not in the legacy table, behavior either stays identical (when prefix matches) or is more accurate (when dynamic data covers it).

## Conventions followed

- Unchanged `lookupPricing` / `estimateCost` / `formatCost` API surface.
- Removal of `DEFAULT_MODEL_PRICES` is clean (no `// removed in C5` comment, no shim re-export).
- `buildPricingMap` signature change is breaking for callers — all callers in the repo are updated in the same commit.
- New test file naming follows `__tests__/`-style where the rest of the package puts them; placed alongside the code it covers.

## What this commit does NOT do

- Does not introduce admin invalidation (C6) — admin writes still leave `pricing:dynamic` stale until next cron tick.
- Does not add the "Force sync now" button (C6).
- Does not touch any worker-read or scripts/ file.
- Does not change `/api/admin/pricing/models` or the `/admin/model-prices` page.

## Acceptance

- `bun run --filter @pew/web typecheck` green.
- `bun run --filter @pew/web test` green — including the new `pricing-cutover.test.ts`.
- `bun run lint` green.
- `bun run dev`:
  - `/dashboard` renders cost numbers identical to pre-C5 within ±0 cents for the 14 legacy models (manual spot check + the cutover test guarantees this).
  - For models *not* in the 14 legacy set (e.g. `deepseek-v3.1`), cost now uses the dynamic price instead of falling through to `DEFAULT_FALLBACK`.
- Existing E2E tests stay green.
- `git grep DEFAULT_MODEL_PRICES` returns nothing in `packages/web/` after this commit (only the frozen copy in `LEGACY_DEFAULT_MODEL_PRICES` inside `worker-read/src/data/model-prices.test.ts`).

## Rollback plan

Single-commit revert restores pre-C5 behavior. Because C1–C4 are additive, reverting only C5 leaves the dynamic data publishing path intact (the `/admin/model-prices` page and worker cron still work) — only the cost path goes back to static.
