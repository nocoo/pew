# Changelog

## v0.6.1

### Fixes

- **Version display** — CLI help text now correctly shows v0.6.1 (v0.6.0 was published with stale build artifacts showing v0.5.0)

## v0.6.0

### Features

- **Shared validation layer** — `@pew/core` upgraded from pure types to runtime package with shared constants (`SOURCES`, `MAX_INGEST_BATCH_SIZE`, `MAX_STRING_LENGTH`) and validation functions (`validateIngestRecord`, `validateSessionIngestRecord`) used by both Next.js API routes and Cloudflare Worker for defense-in-depth
- **Generic upload engine** — `createUploadEngine<T>()` factory with configurable preprocessing, retry, batching, and progress callbacks; eliminates duplicate upload logic between token and session pipelines

### Fixes

- **ISO date validation** — Added `$` anchor and semantic `Date.parse()` check; previously accepted trailing garbage like `2026-01-01T00:00:00Zfoo` and impossible timestamps like `9999-99-99T99:99:99`
- **Integer enforcement** — Token and message count fields now reject floats (e.g. `1.5` tokens)
- **String length limits** — Model, session_key, and other string fields capped at 1024 chars to prevent abuse
- **Byte offset queue reads** — `BaseQueue.readFromOffset()` uses `Buffer.subarray()` instead of `String.slice()`, fixing incorrect cursor advancement on non-ASCII content (e.g. CJK model names)
- **Corrupted JSONL handling** — Per-line `JSON.parse` error handling in queue reads; a single malformed line no longer blocks all subsequent uploads
- **429 double-sleep** — Rate-limit retry no longer sleeps twice (Retry-After sleep + exponential backoff); `sleptFor429` flag skips redundant backoff
- **Worker validation parity** — Worker now validates source enum, ISO date format, non-negative integers, and string lengths (previously accepted any values)

### Refactoring

- `createIngestHandler<T>()` factory reduces two Next.js ingest routes from 169+210 lines to 17+31 lines
- `BaseQueue<T>` generic class reduces two queue implementations from 84+77 lines to 13+13 lines
- Token upload (282→90 lines) and session upload (278→85 lines) rewritten as thin wrappers around upload engine
- Worker rewritten from 302 to 207 lines using `@pew/core` validators

### Infrastructure

- `@pew/core` now has runtime exports (constants + validation), remains zero external dependencies
- Test suite: 50 test files, 725 tests passing (+95 tests, +4 files vs v0.5.0)

## v0.5.0

### Features

- **Codex CLI support** — Full token and session parsing for OpenAI Codex CLI (`~/.codex/sessions/`); cumulative diff strategy with counter-reset detection, SHA-256 hashed projectRef for privacy, incremental byte-offset cursors, and `$CODEX_HOME` env var support
- **Session statistics** — End-to-end session tracking pipeline: per-tool collectors (Claude, Gemini, OpenCode, OpenClaw, Codex), session-sync orchestrator, session-upload with queue, `POST /api/ingest/sessions` and `GET /api/sessions` API routes, Sessions dashboard page with overview cards, activity heatmap, and message chart
- **OpenCode SQLite sync** — Enabled by default (feature flag removed); reads token usage directly from OpenCode's SQLite database for higher fidelity data

### Fixes

- **Status source classification** — Refactored `classifySource()` from substring matching to prefix matching using resolved source directories, correctly handling `$CODEX_HOME` and other env var overrides
- **Codex privacy** — Hash `cwd` path with SHA-256 (first 12 chars) for projectRef to prevent absolute path leakage in uploads
- **OpenCode SQLite dedup** — Watermark boundary dedup and silent skip for warnings during SQLite incremental reads

### Infrastructure

- Codex added to web validation, display labels (`SOURCE_LABELS`), and pricing defaults (`$2/$8/$0.50 per MTok`)
- D1 schema migration for `session_records` table
- Worker extended with session ingest handler and path routing
- Test suite: 46 test files, 630 tests passing

## v0.4.0

### Fixes

- **Token accounting** — Include `cached_input_tokens` in `total_tokens` computation; previously only summed `input + output + reasoning`, now correctly sums `input + cached + output + reasoning`

### Docs

- **Token accounting spec** — Added `docs/05-token-accounting.md` documenting per-source token field mappings, formulas, and billing semantics
- **Read-only constraint** — Codified raw data read-only rule in `CLAUDE.md` (never modify `~/.claude/`, `~/.gemini/`, etc.)

### Chores

- Added `sync` and `sync:prod` shortcut scripts to root `package.json`

## v0.3.0

### Features

- **Sidebar overhaul** — 3 collapsible NavGroups (Overview, Analytics, Account) using Radix Collapsible + CSS Grid animation; collapsed mode flattens to icon-only tooltipped buttons
- **Dashboard period selector** — "All Time / This Month / This Week" pill selector with dynamic stat cards and charts
- **Daily Usage page** — Usage trend chart, source + model filter dropdowns, monthly pagination with prev/next buttons
- **By Model page** — Added ModelBreakdownChart (horizontal stacked bar) above the detail table
- **`useUsageData` hook** — Now supports explicit `from`/`to` date params for flexible date range queries
- **D1 schema** — Added `nickname` column to `users`, created `teams` and `team_members` tables for upcoming team features

### Refactoring

- Renamed "Daily Details" → "Daily Usage" across sidebar and route labels
- Removed ModelBreakdownChart from dashboard (moved to dedicated By Model page)
- Sidebar rewritten from flat nav list to data-driven `NavGroup[]` architecture

### Infrastructure

- Test suite: 32 test files, 403 tests passing

## v0.2.0

### Breaking Changes

- **Project rename** — Renamed from "zebra" to "pew" across all packages, types, config paths, API key prefixes (`zk_` → `pk_`), and domains
- **CLI package** — Now published as `@nocoo/pew` (was `@nocoo/zebra`)
- **Config directory** — Moved from `~/.config/zebra/` to `~/.config/pew/`

### Features

- **Worker ingest** — Cloudflare Worker with native D1 bindings replaces REST API, reducing 60 sequential HTTP calls to a single batched request
- **CLI pre-aggregation** — Idempotent upload pipeline with multi-row INSERT and chunked batches (20 rows / 180 params)
- **429 retry** — CLI retries on rate limit with `Retry-After` header support
- **Dev mode** — `--dev` flag with separate `config.dev.json`, `DEFAULT_HOST`/`DEV_HOST` constants, and `resolveHost` helper
- **Sync improvements** — Files scanned per source in summary, directory-level mtime skip for OpenCode, batch size tuned to 50 for D1 Free plan limits
- **Logo assets** — Asset pipeline (`scripts/resize-logos.py`), file-based metadata icons, OpenGraph images in layout

### Fixes

- Exclude API routes from proxy matcher to allow Bearer token auth
- Pass env vars as Docker build args for Next.js page data collection
- Chunk ingest into 20-row batches to avoid D1 999-param limit
- Skip TLS verification in dev mode for mkcert certs

### Refactoring

- Remove standalone `upload` and `init` commands (merged into `sync`)
- Extract testable pure functions from `auth.ts` and `proxy.ts`
- Replace `--api` string flag with `--dev` boolean

### Infrastructure

- Cloudflare Worker workspace (`packages/worker`) with wrangler config
- Dockerfile for Railway deployment with Bun workspaces
- Test suite expanded: 32 test files, 400 tests passing

## v0.1.1

### Features

- **Dashboard** — Overview with stat cards, usage trend chart, source donut, model breakdown bar chart, and GitHub-style activity heatmap
- **Cost estimation** — Static pricing table with cache savings calculation
- **Public profiles** — `/u/:slug` pages with SEO metadata and full usage widgets
- **Leaderboard** — Public ranking by total tokens with week/month/all periods
- **CLI upload** — Auto-upload on sync with batch retry and offset tracking
- **CLI login** — Browser-based OAuth flow with API key storage

### Fixes

- Fix Google OAuth redirect using `localhost` instead of reverse proxy domain — added `trustHost: true` and secure cookie config
- Fix D1 batch sending array to REST API (no batch endpoint) — send individual queries in loop
- Add `pew.dev.hexly.ai` to `allowedDevOrigins`

### Infrastructure

- Auth.js v5 with Google OAuth, JWT strategy, and D1 adapter
- Cloudflare D1 HTTP API client
- Basalt design system foundation (3-tier luminance, chart colors, shadcn/ui primitives)
- Four-layer test architecture: 25 test files, 256 tests passing
- L3 API E2E tests for ingest, usage, and CLI auth endpoints

## v0.1.0

Initial development — monorepo skeleton, core types, CLI parsers (Claude Code, Gemini CLI, OpenCode, OpenClaw), SaaS backend with D1 storage.
