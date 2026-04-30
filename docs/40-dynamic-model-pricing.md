# 40 — Dynamic Model Pricing

## Status: Draft (Review Round 2)

## Background

Currently pew uses a hardcoded `DEFAULT_MODEL_PRICES` table in `packages/web/src/lib/pricing.ts` (14 models) plus optional DB overrides via the admin CRUD UI. This approach has two problems:

1. **Stale data** — new models or price changes require a code commit and deploy.
2. **Limited coverage** — only 14 exact models + 14 prefix patterns; any unseen model falls back to rough source-level defaults.

Reference implementation: **manifest** project fetches from OpenRouter API + models.dev API daily, merges them into an in-memory cache, and serves a full-featured pricing table page.

## Goals

1. **Dashboard Model Prices page** — sortable, filterable table showing all known model prices with last-updated timestamp.
2. **Automated daily sync** — fetch pricing from external APIs on a Cloudflare Cron Trigger, store in KV.
3. **Unified cost calculation** — replace the hardcoded `DEFAULT_MODEL_PRICES` exact-match table with a KV-backed dynamic dataset; keep the existing prefix/source/fallback safety net.

## Architecture

### Pricing Data Lifecycle

```
  ┌── One-time / on-demand (developer) ───────────────────┐
  │  bun run sync-prices  (root script)                   │
  │  Fetch OpenRouter + models.dev → merge → write        │
  │  packages/worker-read/src/data/model-prices.json      │
  │  (checked into git as the bundled baseline)           │
  └───────────────────────────────────────────────────────┘

  ┌── Runtime (Cloudflare Worker) ────────────────────────┐
  │  scheduled() handler (cron: "0 3 * * *")              │
  │  1. Async fetch OpenRouter + models.dev               │
  │  2. Read admin override rows from D1                  │
  │  3. Merge: baseline → OpenRouter → models.dev → admin │
  │  4. Write merged result to KV "pricing:dynamic"       │
  │  5. Write meta to KV "pricing:dynamic:meta"           │
  │                                                       │
  │  fetch() handler — read-only:                         │
  │  - Returns KV data; on KV miss returns bundled        │
  │    baseline JSON (zero-latency cold start).           │
  │  - NEVER calls external APIs from the request path.   │
  └───────────────────────────────────────────────────────┘
```

> **Workers note:** Cloudflare Workers have no "startup" hook. Sync runs only on `scheduled` (cron) or via an admin-triggered RPC that hits the same sync function. Cold-start safety comes from the bundled JSON, not from in-handler fetching.

### Request Flow

```
┌─────────────────────────────────────────────────────────┐
│  KV namespace: CACHE                                    │
│  Key:  "pricing:dynamic"       Value: DynamicPricingEntry[]
│  Key:  "pricing:dynamic:meta"  Value: DynamicPricingMeta
│  TTL:  none (long-lived) — staleness judged by meta.lastSyncedAt
│                                                         │
│  Fallback (KV empty): model-prices.json bundled in      │
│  worker-read at deploy time                             │
└────────────────┬────────────────────────────────────────┘
                 │ RPC: pricing.getDynamicPricing
                 │ RPC: pricing.getDynamicPricingMeta
                 ▼
┌─────────────────────────────────────────────────────────┐
│  Next.js API:                                           │
│  • GET /api/pricing         → PricingMap (compat path)  │
│  • GET /api/pricing/models  → DynamicPricingEntry[] +   │
│                                meta (for table page)    │
└────────────────┬────────────────────────────────────────┘
                 │
        ┌────────┴────────┐
        ▼                 ▼
┌──────────────┐  ┌──────────────────────────┐
│  Dashboard   │  │  Cost calculation        │
│  /pricing    │  │  (all charts, summaries) │
│  page (new)  │  │  via unified lookupPrice │
└──────────────┘  └──────────────────────────┘
```

### Pricing Resolution Order (read path)

1. **KV `pricing:dynamic`** (populated by latest sync)
2. **Bundled `model-prices.json`** (deploy-time baseline; used when KV is empty)
3. **`DEFAULT_PREFIX_PRICES`** (existing prefix table — kept for dated-suffix matching)
4. **`DEFAULT_SOURCE_DEFAULTS`** (existing per-source defaults — kept for sources never covered by OpenRouter/models.dev, e.g. `pi`, `pmstudio`)
5. **`DEFAULT_FALLBACK`** ($3 / $15 / $0.3 — absolute last resort)

The hardcoded `DEFAULT_MODEL_PRICES` exact-match table is removed in C5; everything below it stays.

## Data Model

### DynamicPricingEntry (KV stored)

```typescript
interface DynamicPricingEntry {
  model: string;              // e.g. "claude-sonnet-4-20250514"
  provider: string;           // e.g. "Anthropic"
  displayName: string | null; // e.g. "Claude Sonnet 4"
  inputPerMillion: number;    // USD per 1M input tokens
  outputPerMillion: number;   // USD per 1M output tokens
  cachedPerMillion: number | null; // USD per 1M cached input tokens
  contextWindow: number | null;
  /**
   * Where THIS pricing data was sourced. Renamed from `source` to avoid
   * collision with existing `model_pricing.source` (which is a usage/tool
   * source like "codex", "claude-code"). The two concepts are orthogonal.
   */
  origin: 'baseline' | 'openrouter' | 'models.dev' | 'admin';
  updatedAt: string;          // ISO 8601 timestamp of last sync
  /** Optional bare-name aliases that resolve to this entry. See "Alias / collision policy". */
  aliases?: string[];
}
```

### DynamicPricingMeta (KV stored alongside)

```typescript
interface DynamicPricingMeta {
  lastSyncedAt: string;       // ISO 8601 of last successful sync
  modelCount: number;
  baselineCount: number;
  openRouterCount: number;
  modelsDevCount: number;
  adminOverrideCount: number;
  /** Per-source errors from the last sync run; UI surfaces them on the /pricing page.
   *  Multi-entry because openrouter/models.dev/d1 can fail independently in one cron tick. */
  lastErrors?: Array<{ source: 'openrouter' | 'models.dev' | 'd1' | 'kv'; at: string; message: string }> | null;
}
```

KV keys:
- `pricing:dynamic` → `DynamicPricingEntry[]`
- `pricing:dynamic:meta` → `DynamicPricingMeta`
- `pricing:all` (existing) → admin DB rows; **kept unchanged** to serve the admin CRUD list.

## Naming & Boundary Decisions (locked)

These resolve ambiguities raised in review.

### N1. `origin` vs `source`
- `DynamicPricingEntry.origin` ∈ `{baseline, openrouter, models.dev, admin}` — provenance of the pricing data.
- `model_pricing.source` (existing DB column) — usage/tool source (`codex`, `claude-code`, etc.); **unchanged semantics**, still drives `sourceDefaults` in `PricingMap`.
- The two never share a column or value space.

### N2. KV channels
- `pricing:all` — existing; admin CRUD list of D1 rows. **Kept**.
- `pricing:dynamic` — new; merged dynamic dataset. **New**.
- `pricing:dynamic:meta` — new; sync stats.
- These are independent. `/api/admin/pricing` reads `pricing:all`; `/api/pricing` and `/api/pricing/models` read `pricing:dynamic`.

### N3. Admin override semantics

Admin DB rows in `model_pricing` are keyed by `(model, source)` where `source` may be `null`. This `source` is the **usage/tool** dimension (`codex`, `claude-code`, …), which dynamic upstream entries (OpenRouter / models.dev / baseline) do **not** carry. So admin overrides do not "replace a dynamic entry by `(model, source)`" — they overlay onto distinct slots in `PricingMap`:

- **`source = null`**: admin row overrides `PricingMap.models[model]`. This shadows whatever the dynamic system wrote for that exact model ID (baseline / OpenRouter / models.dev).
- **`source != null`**: admin row sets `PricingMap.sourceDefaults[source]`, **and** also writes `PricingMap.models[model]` — preserving current `buildPricingMap()` behavior. The `models[model]` write still shadows any dynamic exact-match entry for that model.

In both cases:
- `DynamicPricingEntry.origin = 'admin'` is recorded only on entries the admin layer added/replaced; it is never written back to D1.
- Deleting the admin row reverts `models[model]` (and, if applicable, `sourceDefaults[source]`) to whatever the dynamic / static layer last provided. If nothing else covers it, lookup falls through to prefix → source default → fallback.

### N4. Admin cache invalidation
The current `/api/admin/pricing` POST/PUT/DELETE writes D1 but does **not** invalidate `pricing:all`. With dynamic pricing in play this is a gap — admin overrides could be stale up to 24h.
- C6 adds: after every admin write, invalidate `pricing:all`, then call the same merge function used by `scheduled()` to rebuild `pricing:dynamic` + `pricing:dynamic:meta` synchronously (admin endpoints are low-traffic; the rebuild does no external fetch — it reads D1 + bundled baseline + the latest cached external fetch results, which are stored alongside meta).
- To support this, `scheduled()` also stores the most recent raw external fetch results in KV (`pricing:dynamic:openrouter-raw` / `:models-dev-raw`) so admin rebuilds don't need network IO.

### N5. Reasoning-token pricing (out of scope, explicitly)
- pew records `reasoning_output_tokens` but `estimateCost()` currently bills it via the `output` price.
- This proposal **does not** introduce a separate reasoning price field on `DynamicPricingEntry`.
- If a future provider exposes reasoning cost separately (some OpenAI o-series models on OpenRouter do), a follow-up issue extends `DynamicPricingEntry` and `estimateCost()` together.

### N6. Alias / collision policy
OpenRouter IDs are `provider/model` (e.g. `anthropic/claude-sonnet-4`). Models.dev IDs are bare. To resolve naming friction:
- Always store the canonical entry under its full provider-qualified ID when one exists.
- Compute candidate bare aliases. **Write a bare alias only when no other entry already claims it** (no cross-provider collision).
- When a bare name has multiple claimants, none win — the resolver falls back to prefix/source/fallback chain.
- Aliases are recorded on the entry's `aliases` field for transparency; the `PricingMap.models` map is built by expanding canonical ID + non-conflicting aliases.

## Implementation Plan

### Phase 0: Bootstrap Static Baseline (one-time)

**Goal:** Fetch current pricing from external APIs and check in as a JSON file — this becomes the always-available default that ships with every deploy.

**Script to create:**
- `scripts/sync-prices.ts` (monorepo root) — CLI script (`bun run sync-prices`)
  - Imports the **same** parse/normalize/merge pure functions used by the worker.
  - Fetches OpenRouter + models.dev.
  - Writes `packages/worker-read/src/data/model-prices.json`.
  - Outputs summary (model count, provider breakdown, alias collisions).

> Why monorepo root, not `packages/worker-read/scripts/`? worker-read is a Cloudflare Worker bundle; its build/typecheck config is workers-only. Local Node/Bun scripts in that package would muddle the build.

**Output file:** `packages/worker-read/src/data/model-prices.json`
- Array of `DynamicPricingEntry[]` (same schema as KV storage).
- Checked into git — serves as the deploy-time baseline.
- Refresh anytime via `bun run sync-prices`.

**Root package.json script:**
```json
"sync-prices": "bun scripts/sync-prices.ts"
```

### Phase 1: External API Sync — pure functions

**Files to create (worker-read, but tree-shakeable / Node-importable):**
- `packages/worker-read/src/sync/openrouter.ts` — fetch & parse OpenRouter API
- `packages/worker-read/src/sync/models-dev.ts` — fetch & parse models.dev API
- `packages/worker-read/src/sync/merge.ts` — merge sources (priority + protection rules + alias policy)

**Merge priority (lowest → highest):**
1. Bundled `model-prices.json` (always available)
2. OpenRouter (broadest coverage)
3. models.dev (curated, more accurate for major providers)
4. Admin DB overrides (user-defined, highest)

**Protection rules (from manifest):**
- Never overwrite a real-priced entry with a zero/null-priced entry.
- Validate all parsed numbers: finite, ≥0; skip invalid entries with a warning.
- Apply alias policy from N6.

**OpenRouter parsing:**
```
GET https://openrouter.ai/api/v1/models
→ response.data[].id               → model ID (e.g. "anthropic/claude-sonnet-4")
→ response.data[].pricing.prompt   → string, parse to number (per-token → ×1e6 for per-million)
→ response.data[].pricing.completion → string, parse to number
→ response.data[].context_length   → contextWindow
→ response.data[].name             → displayName
```

**models.dev parsing:**
```
GET https://models.dev/api.json
→ response[providerId].models[modelId].cost.input      → per-million-token price
→ response[providerId].models[modelId].cost.output     → per-million-token price
→ response[providerId].models[modelId].cost.cache_read → cached price
→ response[providerId].models[modelId].name            → displayName
→ response[providerId].models[modelId].limit.context   → contextWindow
```

Provider ID mapping for models.dev:
```typescript
const MODELS_DEV_PROVIDERS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  deepseek: 'DeepSeek',
  mistral: 'Mistral',
  xai: 'xAI',
  'github-copilot': 'GitHub Copilot',
  alibaba: 'Alibaba',
};
```

### Phase 2: worker-read scheduled handler + RPC

**`packages/worker-read/wrangler.toml`** additions:
```toml
[triggers]
crons = ["0 3 * * *"]
```

**`packages/worker-read/src/index.ts`** additions:
- Export `scheduled(event, env, ctx)`. It calls a single `runPricingSync(env)` function that performs fetch → merge → KV write (`pricing:dynamic`, `pricing:dynamic:meta`, raw caches).

**RPC endpoints (new):**
- `pricing.getDynamicPricing` — read `pricing:dynamic` from KV; on miss return bundled baseline. Never fetches externally.
- `pricing.getDynamicPricingMeta` — read `pricing:dynamic:meta`.
- `pricing.rebuildDynamicPricing` — admin-only; runs `runPricingSync` synchronously (used by admin CRUD invalidation in C6, and by an optional admin "force sync now" button).

> No HTTP-triggered external fetch from `fetch()` request handlers — all external IO lives in `scheduled` and the admin-gated rebuild RPC.

**Existing `pricing.listModelPricing` / `pricing:all`:** unchanged. Continues to back the admin CRUD list.

### Phase 3: Web API + Dashboard Page

**Next.js API:**
- `GET /api/pricing` — **unchanged response shape** (`PricingMap`); internally now sourced from `pricing.getDynamicPricing` instead of `pricing.listModelPricing` + static merge.
- `GET /api/pricing/models` — new; returns `{ entries: DynamicPricingEntry[]; meta: DynamicPricingMeta }` for the table page.

**Page route:** `/pricing` (under dashboard layout)

**Features:**
| Feature | Description |
|---------|-------------|
| Sortable columns | Model, Provider, Input $/1M, Output $/1M, Cached $/1M, Context Window |
| Filter by provider | Multi-select dropdown |
| Search by model name | Text input, instant filter |
| Price formatting | Adaptive precision: <$0.01→4dp, <$1→3dp, else→2dp |
| Origin badge | Color-coded: baseline (gray), models.dev (green), OpenRouter (blue), admin (purple) |
| Last synced | Timestamp in page header (from meta.lastSyncedAt); warn banner if >48h |
| Model count | "Showing X of Y models" |
| Pagination | Client-side, 25 per page |
| Empty/loading states | Skeleton rows while loading |

**Components:**
- `packages/web/src/app/(dashboard)/pricing/page.tsx`
- `packages/web/src/components/pricing/pricing-table.tsx`
- `packages/web/src/components/pricing/pricing-filters.tsx`

### Phase 4: Unified Cost Calculation (the cutover)

**Files to modify:**
- `packages/web/src/lib/pricing.ts`
  - **Remove** `DEFAULT_MODEL_PRICES`.
  - **Keep** `DEFAULT_PREFIX_PRICES`, `DEFAULT_SOURCE_DEFAULTS`, `DEFAULT_FALLBACK`.
  - `buildPricingMap()` now takes `{ dynamic: DynamicPricingEntry[]; dbRows: DbPricingRow[] }`. Dynamic entries become exact-match models; DB rows still feed `sourceDefaults` and override `models` (existing semantics preserved).
- `packages/web/src/app/api/pricing/route.ts` — fetch dynamic entries via worker-read RPC, then call updated `buildPricingMap`.
- `packages/web/src/hooks/use-pricing.ts` — no change.
- `packages/web/src/lib/cost-helpers.ts` — no change.

**Regression guarantee:** existing `packages/web/src/__tests__/pricing.test.ts` snapshots must stay green. C2's `model-prices.json` MUST contain all 14 models currently in `DEFAULT_MODEL_PRICES` with the same `input`/`output`/`cached` values, so `lookupPricing()` returns identical results across the cutover.

### Phase 5: Admin Override Integration

The existing admin UI (`/admin/pricing`) continues to work; this phase wires it into the dynamic system.

- Admin POST/PUT/DELETE endpoints invalidate `pricing:all` AND call `pricing.rebuildDynamicPricing` synchronously.
- Admin UI gains an "Origin" column (baseline / openrouter / models.dev / admin).
- Optional "Force sync now" button → `pricing.rebuildDynamicPricing`.

## Migration Strategy

1. **C0 (this commit):** Doc revisions; no code change.
2. **C1–C2:** Add sync core + bundled baseline JSON. Nothing reads them yet.
3. **C3:** worker-read writes KV via cron; new RPC available but unused.
4. **C4:** New `/pricing` page + `/api/pricing/models`. Old `/api/pricing` still uses static path. **Additive only.**
5. **C5 (cutover):** `lib/pricing.ts` switches to dynamic source. Existing tests green; behavior identical for 14 known models, expanded coverage for the rest.
6. **C6:** Admin invalidation hookup. Optional UI polish.

Fallback chain at every step: KV fresh → KV stale → bundled `model-prices.json` → prefix/source/fallback. Users never see broken cost calculations.

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| OpenRouter API down | Retry 3x with backoff in `scheduled`; KV retains last good data; baseline JSON always available |
| models.dev API down | Independent of OpenRouter; partial sync still useful |
| Price format changes | Validate parsed numbers (finite, ≥0); skip invalid entries with warning logged to meta.lastErrors |
| KV cold start (empty) | Read path falls through to bundled `model-prices.json` |
| Rate limiting | Single daily fetch via cron; admin-triggered rebuild reuses cached raw fetch results |
| Stale KV (sync fails for days) | `pricing:dynamic:meta.lastSyncedAt` shown on page; warn banner if >48h |
| Stale baseline JSON | CI lint warns when `model-prices.json` is >30 days old; refresh before each release |
| Bare-alias collisions across providers | Alias policy N6: collisions skip writing the alias; resolver falls through |
| Admin override stale up to 24h | C6 invalidates KV + rebuilds synchronously on every admin write |

## Testing Strategy

- **L1 Unit:** OpenRouter parser (mock `data.json` fixture; covers missing fields, zero prices, malformed pricing strings)
- **L1 Unit:** models.dev parser (mock fixture; covers missing providers, missing cost fields)
- **L1 Unit:** Merge logic (priority order, zero-price protection, alias collision policy, admin override semantics)
- **L1 Unit:** `scripts/sync-prices.ts` produces a `model-prices.json` that matches schema and contains all 14 currently-hardcoded models with identical prices (regression guard for C5 cutover)
- **L1 Unit:** existing `pricing.test.ts` stays green after C5
- **L2 Integration:** `scheduled()` end-to-end against test KV + mocked external APIs (KV write → RPC read round-trip)
- **L2 Integration:** Cold start with empty KV returns bundled baseline
- **L2 Integration:** Admin write invalidates and rebuilds dynamic KV (C6)
- **L3 E2E:** `/pricing` page renders, filters/sort/pagination work

## Out of Scope

- Real-time price updates (sub-daily) — daily is sufficient.
- Historical price tracking — only current prices stored.
- CLI-side pricing (CLI uploads raw tokens; cost is calculated server-side).
- Custom provider pricing from CLI config — handled by existing admin override flow.
- Reasoning-token-specific pricing — see N5; tracked as a follow-up issue if needed.

## Atomic Commit Plan

| # | Scope | Files | Touches behavior? |
|---|-------|-------|-------------------|
| C0 | Doc revision (this commit) | `docs/40-dynamic-model-pricing.md` | No |
| C1 | Sync pure functions + L1 tests | `packages/worker-read/src/sync/{openrouter,models-dev,merge}.ts`, fixtures, tests | No |
| C2 | Root sync script + checked-in baseline | `scripts/sync-prices.ts`, `packages/worker-read/src/data/model-prices.json`, root `package.json` script, baseline schema/regression tests | No |
| C3 | Worker `scheduled` + RPC + KV writes | `packages/worker-read/{wrangler.toml, src/index.ts, src/rpc/pricing.ts}`, tests | New surface only — no read switchover |
| C4 | New `/api/pricing/models` + `/pricing` page | `packages/web/src/app/api/pricing/models/route.ts`, `(dashboard)/pricing/page.tsx`, components, tests | Additive |
| C5 | **Cutover**: `lib/pricing.ts` consumes dynamic data | `packages/web/src/lib/pricing.ts`, `packages/web/src/app/api/pricing/route.ts`, regression tests | **Yes** — single behavioral switch |
| C6 | Admin invalidation + UI polish | `packages/web/src/app/api/admin/pricing/*`, admin UI, optional "force sync now" button | Yes — admin path only |

Each commit is independently deployable. C5 is the only behavioral switch on the read path; if anything regresses there, revert C5 alone.
