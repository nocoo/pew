# Cache accounting contract

Cache reads and cache writes affect token prices differently. Pew retains the original collected counters and adds independently versioned accounting annotations. A reclassification never uploads another copy of the tokens or rewrites their historical allocation.

This extends [supplementary usage accounting](47-usage-evidence.md). The global token cursor schema remains version 2; upgrading cache extraction does not require a global reset.

## Counters and unknown values

Each matched billing group uses these totals and subsets:

| Symbol | Field | Meaning |
| --- | --- | --- |
| P | `input_total_tokens` | All recorded input |
| R | `cache_read_input_tokens` | Input read from cache, a subset of P |
| W | `cache_write_input_tokens` | Input written to cache, a subset of P |
| W5 / W1 | `cache_write_5m_input_tokens` / `cache_write_1h_input_tokens` | Optional, disjoint subsets of W |
| Q | `output_total_tokens` | All recorded output, including reasoning |
| G | `reasoning_output_tokens` | Reasoning subset of Q |

When the split is known, ordinary input is `N = P - R - W` and total usage is `P + Q`. Never add R, W or G to those totals again. All counts must be nonnegative safe integers; `R + W <= P`, `W5 + W1 <= W` and `G <= Q`.

`null` means unavailable, not zero. Zero is accepted only when supplied by the source or implied by a valid zero parent count. For example, zero writes imply zero TTL subsets when those subsets are absent, but an explicit positive TTL count with zero writes is invalid. Negative, fractional, unsafe or contradictory source values remain invalid even if an older normalization step clamps them for the legacy queue. A discrepancy in a provider's total is diagnostic evidence, not permission to infer missing writes.

The original five fields form `basis`: `input_tokens`, `cached_input_tokens`, `output_tokens`, `reasoning_output_tokens`, `total_tokens`. P equals legacy input plus legacy cache. Q equals legacy output plus legacy reasoning, except for Hermes, whose legacy output already includes reasoning. Thus a matched Hermes display can correct that overlap while retaining the exact old reconciliation basis.

## Extraction by source

| Source | Cache extraction and qualifications |
| --- | --- |
| Codex | Read `last_token_usage.cache_write_input_tokens` alongside inclusive input and cached input. Preserve provider and service tier context. Cumulative-only records do not prove a per-event write split. Existing event deduplication and bucket identity stay unchanged. |
| Claude Code | Input is exclusive of cache; include read and creation counts in P. Preserve `cache_creation` 5m/1h subsets. Anthropic-shaped JSON does not prove an Anthropic billing route. |
| Pi / Oh My Pi | `cacheRead` and `cacheWrite` are separate from ordinary input. Retain optional TTL and reasoning fields, and fold orchestration components into their respective totals once. SDK costs are estimates, not provider invoices; zero with unavailable billing status remains unknown. Compaction retains its existing operation identity and time. |
| Grok unified log | Prompt includes cached input; completion includes reasoning. Extract explicit `cache_write_tokens` / `cache_write_input_tokens` when available. Missing fields remain unknown. |
| Grok session ledger | ACP/persisted turn input is inclusive; use `cacheCreationTokens`. Per-model groups must exactly partition both token counts and reported money. A mixed amount that cannot be assigned to models is retained once under `mixed`. `usage.json` may enrich an identified completed turn only when timestamp, model, legacy vector and canonical split agree. Inherited session totals never create usage. |
| Hermes | Session legacy cache combines read and write; retain both original SQLite columns as annotations. Optional-column absence stays unknown. Main model-ledger rows (`task = ''`) split the session only when every counter matches exactly. Auxiliary read/write deltas require matching saved evidence annotations; otherwise keep the split unknown. Verified review calls retain explicit splits and original timing. A cumulative dollar amount is never distributed over individual calls. |
| OpenCode JSON / SQLite | Preserve explicit `tokens.cache.write` and provider metadata. An upgraded JSON cursor without a write baseline cannot prove the next incremental W; a full matching replay can enrich it later. |
| OpenClaw | Preserve explicit cache writes and reasoning as an output subset without changing legacy counters. |
| ZCode | Retain creation counters and provider identity. Use the provider total to retain its existing reasoning-subset crosscheck. |
| Other sources / old history | Keep existing usage. Unsupported cache details remain unknown and reduce coverage. |

Source files and databases are read-only. JSONL parsing is bounded to complete lines in a size snapshot; SQLite uses read-only handles. Session content, prompts, responses, credentials, original session IDs and billing URLs do not enter accounting records. Labels pass a strict projection; identities are hashed. A source-local annotation error does not invalidate another source's usage.

## Companion identity and reconciliation

`AccountingRecord.details_version = 1` contains the source/model/device/UTC half-hour key, `basis`, and up to 256 mutually exclusive billing groups. Group bases must sum exactly to the record basis.

- `event_id = null` references an original bucket. A hashed event ID references existing `usage_evidence` and requires its positive `evidence_snapshot_seq`.
- `source_revision` identifies an accepted base snapshot; it is retained across resets.
- `detail_revision` increases for a changed classification of the same base snapshot.
- `parser_revision` prevents an older collector from replacing newer extraction results.
- Groups retain actual model, safe provider/route/tier, request count, context min/max, quality and numeric diagnostics. Aggregate session/operation counts do not establish individual request context.

The additive `usage_details` table joins `usage_bases` in `usage_totals`. Details never enter the token SUM path. A read annotation is `matched` only when all five counters and the evidence sequence equal the live base; otherwise it is `pending` and its groups are excluded from calculation. Old clients can continue replacing original buckets. Stale details then become pending instead of silently changing their meaning. Zero evidence checkpoints do not create activity.

The read service preserves group boundaries through day, model and device aggregation. Public reads remove reported money by default; the authenticated `/api/usage` caller explicitly opts in. The public profile route also clears reported amounts at its own boundary.

Legacy aggregate APIs, including rankings, retain their original counters. Canonical display corrections require matched annotations on usage records; this change does not rebuild historical ranking data.

## Prices, reported money and display

Public estimates charge ordinary input, cache reads, cache writes and output separately. A write rate **replaces** the ordinary-input rate for W. It is not an additional full charge on top of input:

```text
estimated cost = N × input rate + R × read rate
               + W5 × 5m rate + W1 × 1h rate + (W - W5 - W1) × write rate
               + Q × output rate
read discount = R × (input rate - read rate)
write premium = estimated write cost - W × input rate
net cache savings = read discount - write premium
```

Rates are USD per million tokens, so divide each token/rate product by 1,000,000. If a distinct reasoning rate exists, split Q into Q−G and G instead of charging G again.

Direct provider prices and OpenRouter prices remain separate, including long-context and TTL rates. A bare model-name collision must not select another provider's direct price. Service-tier suffixes are significant. models.dev `context_over_272k` begins at 272001 tokens; OpenRouter's explicit minimum is used as published. Context prices are selected from request context before aggregation, never from daily token volume. Group min/max ranges that cross an applicable threshold produce an incomplete estimate.

`estimatedCost` remains numeric for compatibility when details or rates are missing. Its fallback assumptions are exposed through `complete = false` and diagnostic issues; `netSavings` is then null. Dropping incomplete records would understate the aggregate. Fallback prices, unknown routing/tier, unknown cache splits and unresolved context are disclosed beside cost totals, including model, agent and device pages. Device estimates also return `estimated_cost_complete` for row-level disclosure.

Reported amounts stay separate from public estimates. They use decimal integer strings with an explicit scale (`units / 10^scale`); Grok USD ticks use scale 10. Preserve the source distinction between `actual`, `estimate`, `included` and `unknown`, plus `complete`, `partial` or `unknown` status. A local SDK estimate is not a bill. A subscription inclusion is not proof of free token pricing. Grok nested or envelope partial flags survive ledger enrichment and compatible fork deduplication. Conflicting fork copies block the affected companion bucket.

Dashboard headline totals use P and Q. Stacked token charts use disjoint display counters; tables with a separate cache column retain that partition. An unresolved Hermes cache bucket stays in the legacy cache segment rather than becoming known uncached input. Device projections remove already-applied annotations so subsequent charts cannot apply the correction twice; billing detail rows retain their original bases.

Cache read rate uses `R / known-read P`, accompanied by the fraction of all recorded input that has read coverage. Write coverage independently measures input with known W. An unsupported zero is not evidence of a cache miss. Cache read rate replaces the old cache/non-cache percentage. Unknown chart intervals remain gaps; aggregate rates are weighted by covered input. Net savings may be negative when the write premium exceeds the read discount.

Overview retains the original annual Activity / Goal Tracker, statistics, Trends and Insights layout. Usage summary occupies two desktop rows: tokens and Cache Hit Rate first, then estimated cost, monthly forecast and daily average. Cache read/write totals, input coverage and net savings remain available in the expandable accounting details. The hit rate is token based: R / input with known read counts, weighted by that input across records. It is not an average of daily percentages or a fraction of requests. The daily hit-rate chart uses the same denominator. Mixed legacy and annotated records use the shared accounting helpers; uncollected reads show an unavailable rate, a measured zero stays 0%, and partial coverage is explicit. Cache is included in P and is never added to P + Q again.

Usage statistics, trends and insights share one local calendar period. Daily and half-hour queries receive identical UTC timestamps (`from` inclusive, `to` exclusive). All-time charts begin at the first recorded day. Activity and Goal Tracker retain the current-year scope and existing local goal settings; growth comparisons and the monthly forecast retain their calendar windows. The salary calculator opens from the header and uses the selected period's estimated cost divided by its calendar days, including inactive days. These presentation changes do not require an API or database migration.

Trends also pairs daily stacked token bars with a period-share donut. The model, harness and device selector changes both charts together and persists when the period changes. Both charts share one aggregation, including the five largest groups and the complete remainder as Other; missing calendar days are zero-filled. Device charts use the actual device timeline with the same UTC query bounds, never an estimated split by model or harness. A failed device query offers retry while model and harness views remain available.

The public pricing API includes a content snapshot ID, fetch time and dynamic/baseline/fallback status. `effectiveAt` remains null: a fetch timestamp is not a historical rate schedule. Estimates cover token charges; storage fees, subscriptions and historical/provider-specific billing adjustments are not modeled as a complete invoice.

## Durable local state and delivery

`accounting-queue.jsonl` is a retained companion ledger, with independent dirty/outbox state. Resetting cursors preserves it and the evidence ledger. Same-revision conflicts are rejected; lower parser revisions cannot win. Incremental annotation updates need an exact BEFORE basis; a full replay needs an exact AFTER basis. Unverified history is left intact.

Sync uses `sync-commit.json` to recover absolute evidence, accounting, legacy queue and cursor writes before parsing or uploading again. This supports retry after a process interruption between file replacements. State-changing commands use a separate `state.lock`, including sync/upload, session sync/upload, reset and enrichment apply. A stale lock fails closed: verify its owner has stopped before removing that lock alone. Preserve a pending journal for normal sync recovery; do not erase the ledger or reset to bypass it.

`/api/ingest/details` and Worker `/ingest/details` accept at most 25 records per batch. Each record uses an UPSERT and receipt query inside a native D1 transaction, fitting the 50-statement budget. Receipts identify the exact record key and all revisions, with `applied`, `duplicate`, `superseded`, `base_mismatch` or `conflict` status. The CLI clears only a matching positive receipt. Unsupported servers, malformed receipts and conflicts retain details for retry without changing successful legacy-upload results.

## Directed historical enrichment

```sh
pew enrich --source codex --from 2026-08-15 --to 2026-09-13
pew enrich --source codex --from 2026-08-15 --to 2026-09-13 --apply
```

The default is preview. Select a source or `all`, and a closed UTC half-hour window (`from` inclusive, `to` exclusive); bare dates mean UTC midnight. Enrichment requires an existing device ID. It does not log in, create a device, migrate state or upload.

Replay runs in scratch state while preserving prior evidence allocation. Only re-parsed, validated candidates are eligible to match retained original bases. Missing source logs cannot verify an old annotation merely because it is already stored. Preview reports eligible/matched/changed/unverified counts, known writes, covered input and a plan hash. Apply rechecks original bases under the state lock and writes only the companion ledger/outbox. It refuses an unresolved sync journal. Repeating the same successful apply makes no further change.

For machine validation, use a copy of Pew state, avoid copying credentials, disable network access and hash original state before/after. Inspect unmatched counts before deciding any real enrichment window. A local queue may not contain all online history, so never use a global rebuild as a cache migration.

## Activation and future changes

1. Review and apply migration `026-usage-accounting.sql` after the existing evidence migration. It adds annotations and replaces the read view; it does not update or delete collected tokens.
2. Deploy ingest/read Workers and web code that understand the new view and receipts, then distribute the CLI. New read SQL requires the migration; unsupported detail ingestion remains retryable.
3. Inspect directed enrichment previews before choosing actual historical windows and uploads. New annotation collection itself does not require resetting cursors.
4. Roll back code while retaining the additive table and local ledgers. Do not remove revisions or supplementary evidence to make an old client understand new metadata.

Deploying, publishing and actual-state enrichment are separate activation operations. Development tests and the readonly audit do not perform them.

Future cache fields must keep the original basis and identity stable, define subset/unknown semantics, pass both the shared server validator and the independently shipped CLI validator, and preserve pricing coverage disclosure. A changed parser increments its parser revision; incompatible wire formats require a new details version. Do not add runtime `@pew/core` imports to the published CLI: its release uses `tsc` and the core package is private.

References: [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching), [OpenAI pricing](https://developers.openai.com/api/docs/pricing), [models.dev](https://models.dev/), [OpenRouter model rates](https://openrouter.ai/api/v1/models), and the installed CLI schemas for each extractor.
