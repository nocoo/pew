# 40 — Dynamic Model Pricing

## Status: Draft

## Background

Currently pew uses a hardcoded `DEFAULT_MODEL_PRICES` table in `packages/web/src/lib/pricing.ts` (14 models) plus optional DB overrides via the admin CRUD UI. This approach has two problems:

1. **Stale data** — new models or price changes require a code commit and deploy.
2. **Limited coverage** — only 14 exact models + 14 prefix patterns; any unseen model falls back to rough source-level defaults.

Reference implementation: **manifest** project fetches from OpenRouter API + models.dev API daily, merges them into an in-memory cache, and serves a full-featured pricing table page.

## Goals

1. **Dashboard Model Prices page** — sortable, filterable table showing all known model prices with last-updated timestamp.
2. **Automated daily sync** — fetch pricing from external APIs on worker startup + daily cron, store in KV.
3. **Unified cost calculation** — replace all hardcoded pricing lookups with a single function that resolves from KV-backed dynamic pricing.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  External APIs (daily fetch)                            │
│  • https://openrouter.ai/api/v1/models                  │
│  • https://models.dev/api.json                          │
└────────────────┬────────────────────────────────────────┘
                 │ worker-read cron trigger (Cloudflare)
                 ▼
┌─────────────────────────────────────────────────────────┐
│  worker-read: pricing-sync handler                      │
│  1. Fetch OpenRouter → parse → Map<modelId, entry>      │
│  2. Fetch models.dev → parse → overlay on OpenRouter    │
│  3. Merge admin DB overrides (highest priority)         │
│  4. Write merged result to KV key "pricing:dynamic"     │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  KV namespace: CACHE                                    │
│  Key: "pricing:dynamic"                                 │
│  Value: JSON array of DynamicPricingEntry[]             │
│  TTL: 86400 (24h, refreshed daily)                      │
└────────────────┬────────────────────────────────────────┘
                 │ RPC: pricing.getDynamicPricing
                 ▼
┌─────────────────────────────────────────────────────────┐
│  Next.js API: GET /api/pricing                          │
│  • Returns full DynamicPricingEntry[] for table page    │
│  • Returns PricingMap for cost calculation              │
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

## Data Model

### DynamicPricingEntry (KV stored)

```typescript
interface DynamicPricingEntry {
  model: string;              // e.g. "claude-sonnet-4-20250514"
  provider: string;           // e.g. "Anthropic"
  displayName: string | null; // e.g. "Claude Sonnet 4"
  inputPerMillion: number;    // USD per 1M input tokens
  outputPerMillion: number;   // USD per 1M output tokens
  cachedPerMillion: number | null; // USD per 1M cached tokens (if known)
  contextWindow: number | null;
  source: 'openrouter' | 'models.dev' | 'admin'; // which source provided this
  updatedAt: string;          // ISO 8601 timestamp of last sync
}
```

### DynamicPricingMeta (KV stored alongside)

```typescript
interface DynamicPricingMeta {
  lastSyncedAt: string;       // ISO 8601 of last successful sync
  modelCount: number;
  openRouterCount: number;
  modelsDevCount: number;
  adminOverrideCount: number;
}
```

KV keys:
- `pricing:dynamic` → `DynamicPricingEntry[]`
- `pricing:meta` → `DynamicPricingMeta`

## Implementation Plan

### Phase 1: External API Sync in worker-read

**Files to create:**
- `packages/worker-read/src/sync/openrouter.ts` — fetch & parse OpenRouter API
- `packages/worker-read/src/sync/models-dev.ts` — fetch & parse models.dev API
- `packages/worker-read/src/sync/pricing-sync.ts` — orchestrator: merge sources + DB overrides → write KV

**Merge priority (lowest → highest):**
1. OpenRouter (broadest coverage, baseline)
2. models.dev (curated, more accurate for major providers)
3. Admin DB overrides (user-defined, always wins)

**Protection rules (from manifest):**
- Never overwrite a real-priced entry with a zero/null-priced entry (prevents free-tier listings from erasing actual prices)
- OpenRouter model IDs use `provider/model` format — store under both full ID and bare model name

**Trigger:**
- On worker start (first request after deploy via lazy init)
- Daily via Cloudflare Cron Trigger (`crons = ["0 3 * * *"]` in wrangler.toml)

**OpenRouter parsing:**
```
GET https://openrouter.ai/api/v1/models
→ response.data[].id               → model ID (e.g. "anthropic/claude-sonnet-4")
→ response.data[].pricing.prompt   → string, parse to number (per-token)
→ response.data[].pricing.completion → string, parse to number (per-token)
→ response.data[].context_length   → contextWindow
→ response.data[].name             → displayName (strip "Provider: " prefix)
```

**models.dev parsing:**
```
GET https://models.dev/api.json
→ response[providerId].models[modelId].cost.input  → per-million-token price
→ response[providerId].models[modelId].cost.output → per-million-token price
→ response[providerId].models[modelId].cost.cache_read → cached price
→ response[providerId].models[modelId].name        → displayName
→ response[providerId].models[modelId].limit.context → contextWindow
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

### Phase 2: New RPC Endpoint + API Route

**worker-read RPC:**
- `pricing.getDynamicPricing` — read `pricing:dynamic` from KV (with fallback to on-demand sync if KV miss)
- `pricing.getDynamicPricingMeta` — read `pricing:meta` from KV
- `pricing.triggerSync` — admin-only: force immediate re-sync

**Next.js API route changes:**
- `GET /api/pricing` — extend to return dynamic pricing data when `?format=table` (full entries for page) or `?format=map` (PricingMap for cost calculation, default for backward compat)
- Or: new `GET /api/pricing/models` for the table page, keep `/api/pricing` as PricingMap

### Phase 3: Dashboard Model Prices Page

**Route:** `/pricing` (or `/models` — under dashboard layout)

**Features:**
| Feature | Description |
|---------|-------------|
| Sortable columns | Model, Provider, Input $/1M, Output $/1M, Cached $/1M, Context Window |
| Filter by provider | Multi-select dropdown (Anthropic, OpenAI, Google, etc.) |
| Search by model name | Text input, instant filter |
| Price formatting | Adaptive precision: <$0.01→4dp, <$1→3dp, else→2dp |
| Source badge | Color-coded: models.dev (green), OpenRouter (blue), admin (purple) |
| Last synced | Timestamp in page header |
| Model count | "Showing X of Y models" |
| Pagination | Client-side, 25 per page |
| Empty/loading states | Skeleton rows while loading |

**Components to create:**
- `packages/web/src/app/(dashboard)/pricing/page.tsx` — page component
- `packages/web/src/components/pricing/pricing-table.tsx` — table with sort/filter
- `packages/web/src/components/pricing/pricing-filters.tsx` — filter bar

### Phase 4: Unified Cost Calculation

**Current state — scattered pricing lookups:**
- `packages/web/src/lib/pricing.ts` → `lookupPricing()` uses static map + DB overrides
- `packages/web/src/lib/cost-helpers.ts` → `computeTotalCost()`, `toDailyCostPoints()`, etc.
- `packages/web/src/hooks/use-pricing.ts` → `usePricingMap()` fetches from API

**Target state — single source of truth from KV:**

1. **`buildPricingMap()` refactor** — instead of merging static defaults + DB rows, it consumes the full `DynamicPricingEntry[]` from the sync system. Static defaults become a last-resort fallback only when KV is empty (cold start).

2. **Remove `DEFAULT_MODEL_PRICES`** — all pricing data comes from external APIs. Keep `DEFAULT_FALLBACK` as the absolute last-resort ($3/$15/$0.3) for truly unknown models.

3. **`lookupPricing()` stays the same interface** — callers don't change. The resolution chain becomes:
   - Exact model match in dynamic map
   - Prefix match (e.g. `claude-sonnet-4` matches `claude-sonnet-4-20250514`)
   - Source default (per-tool fallback)
   - Global fallback

4. **Server-side cost calculation** — worker-read already has access to KV. Add a `pricing.lookupModel` RPC that returns pricing for a given model ID, so server-side aggregations can compute costs without the full map.

**Files to modify:**
- `packages/web/src/lib/pricing.ts` — remove hardcoded tables, consume dynamic data
- `packages/web/src/hooks/use-pricing.ts` — no change (already fetches from API)
- `packages/web/src/lib/cost-helpers.ts` — no change (already takes PricingMap as param)
- `packages/web/src/app/api/pricing/route.ts` — source data from worker-read KV instead of DB query + static merge

### Phase 5: Admin Override Integration

The existing admin UI (`/admin/pricing`) continues to work but its role changes:
- Admin overrides are the **highest priority** in the merge chain
- The sync process reads admin DB rows and applies them on top of API data
- Admin UI gains a "source" column showing where each price came from
- Admin can see which models were auto-synced vs manually overridden

## Migration Strategy

1. **Non-breaking**: Deploy Phase 1-2 first. KV gets populated, existing code unchanged.
2. **Feature flag**: New `/pricing` page is additive, no existing page changes.
3. **Gradual cutover**: Phase 4 replaces `DEFAULT_MODEL_PRICES` but `lookupPricing()` interface is identical — all callers work unchanged.
4. **Fallback safety**: If KV is empty or sync fails, fall back to current static defaults. Users never see broken cost calculations.

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| OpenRouter API down | Retry 3x with backoff; KV retains last good data (24h TTL) |
| models.dev API down | Independent of OpenRouter; partial sync still useful |
| Price format changes | Validate parsed numbers (>0, finite); skip invalid entries |
| KV cold start (empty) | Fall back to static `DEFAULT_FALLBACK`; trigger sync on first miss |
| Rate limiting | Single daily fetch; no user-triggered sync (admin only) |
| Stale KV (sync fails for days) | `pricing:meta.lastSyncedAt` displayed on page; alert if >48h stale |

## Testing Strategy

- **L1 Unit**: Parse functions for OpenRouter/models.dev responses (mock JSON fixtures)
- **L1 Unit**: Merge logic (priority, protection rules, dedup)
- **L2 Integration**: Full sync → KV write → RPC read round-trip (against test KV namespace)
- **L3 E2E**: `/pricing` page renders table, filters work, sort works

## Out of Scope

- Real-time price updates (sub-daily) — daily is sufficient for AI model pricing
- Historical price tracking — only current prices stored
- CLI-side pricing (CLI already uploads raw tokens; cost is calculated server-side)
- Custom provider pricing from CLI config — handled by existing admin override flow
