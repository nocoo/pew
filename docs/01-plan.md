# pew — Implementation Plan

> Monorepo skeleton for token usage tracking CLI + SaaS dashboard.
> Mirror structure from `../otter`, token collection logic from `../vibeusage`.

## Overview

pew collects token usage from 7 local AI coding tools and provides a SaaS dashboard
with auth, data display, public profiles, and leaderboards.

### Supported AI Tools

| # | Tool | Data Location |
|---|------|---------------|
| 1 | Claude Code | `~/.claude/projects/**/` |
| 2 | Codex | `~/.codex/` |
| 3 | Gemini CLI | `~/.gemini/tmp/*/chats/session-*.json` |
| 4 | OpenCode | `~/.local/share/opencode/storage/message/` |
| 5 | OpenClaw | `~/.openclaw/agents/*/sessions/*.jsonl` |
| 6 | VS Code Copilot | `~/.config/github-copilot/chat/` |
| 7 | GitHub Copilot CLI | `~/.copilot/logs/process-*.log` |

### Tech Stack

- **Runtime**: Bun (workspaces, no Turborepo/Nx)
- **Language**: TypeScript 5.7+ strict mode, composite project references
- **Testing**: Vitest (unified root config, 90% coverage thresholds)
- **CLI**: citty (UnJS ecosystem) + consola + picocolors
- **Web**: Next.js 16 + App Router + React 19
- **Auth**: Auth.js v5 + Google OAuth
- **Storage**: Cloudflare D1 (via HTTP API from Railway)
- **UI**: Tailwind CSS v4 + shadcn/ui
- **Deploy**: Railway via Docker multi-stage build

---

## Four-Layer Testing Architecture (TDD)

All development follows **TDD** — write tests first, then implement.

| Layer | What | When | Tool | Port |
|-------|------|------|------|------|
| L1 | Unit Tests | pre-commit (Husky) | Vitest | — |
| L2 | Lint / Type Check | pre-commit (Husky) | `tsc --noEmit` strict | — |
| L3 | API E2E | pre-push (Husky) | Vitest + fetch | 17020 |
| L4 | BDD E2E | on-demand | Playwright | 27020 |

### Rules

- **L1**: 90%+ coverage enforced by pre-commit hook script. Fail = block commit.
- **L2**: Zero tolerance for errors/warnings. Strict mode mandatory.
- **L3**: 100% REST API coverage. `E2E_SKIP_AUTH=1` to bypass auth. Dev port 7020 → E2E port 17020.
- **L4**: Core user flows via Playwright. Port 27020. Run manually.
- **Husky**: pre-commit runs L1+L2 with coverage check; pre-push runs L3.

---

## Phase 1: Monorepo Skeleton ✅

### 1.1 Root Configs
- [x] `package.json` — Bun workspaces (`"workspaces": ["packages/*"]`)
- [x] `tsconfig.json` — ES2022, NodeNext, strict, composite project references
- [x] `.gitignore` — node_modules, dist, .next, .env, coverage, etc.
- [x] `CLAUDE.md` — project conventions for AI agents

### 1.2 Core Package (`packages/core`)
- [x] `package.json` (`@pew/core`, private, types-only)
- [x] `tsconfig.json` (extends root, composite: true)
- [x] `src/types.ts` — Source enum (4 tools), UsageRecord, TokenDelta, HourBucket, SyncCursor
- [x] `src/index.ts` — re-export types
- [x] `src/__tests__/types.test.ts` — type-level tests (TDD: write first)

### 1.3 CLI Package (`packages/cli`)
- [x] `package.json` (`@nocoo/pew`, public, bin entry)
- [x] `tsconfig.json` (extends root, references core)
- [x] `src/bin.ts` — entry point
- [x] `src/cli.ts` — citty main command with subcommands (sync, status, login)
- [x] `src/__tests__/cli.test.ts` — CLI smoke tests (TDD: write first)

### 1.4 Web Package (`packages/web`)
- [x] `package.json` (`@pew/web`, private, Next.js 16)
- [x] `tsconfig.json` (Next.js strict settings)
- [x] `next.config.ts` (standalone output, turbopack root)
- [x] `postcss.config.mjs` (Tailwind v4 PostCSS plugin)
- [x] `src/app/layout.tsx` — root layout
- [x] `src/app/page.tsx` — landing page
- [x] `src/app/globals.css` — Tailwind v4 import

### 1.5 Testing Infrastructure
- [x] `vitest.config.ts` — root config, 90% coverage thresholds (V8 provider)
- [x] `.husky/pre-commit` — runs L1 (vitest) + L2 (tsc --noEmit)
- [x] `.husky/pre-push` — runs L3 (API E2E via scripts/run-e2e.ts)
- [x] `scripts/e2e-utils.ts` — shared port/cleanup utilities
- [x] `scripts/run-e2e.ts` — L3 API E2E runner (port 17020)
- [x] `scripts/run-e2e-ui.ts` — L4 Playwright BDD runner (port 27020)

---

## Phase 2: CLI Token Collection ✅

### 2.1 Core Types
- [x] `ByteOffsetCursor`, `GeminiCursor`, `OpenCodeCursor`, `FileCursor`, `CursorState`
- [x] `QueueRecord`, `PewConfig`

### 2.2 CLI Infrastructure
- [x] `ConfigManager` — config.json read/write
- [x] `CursorStore` — cursors.json persistence + per-file cursor CRUD
- [x] `LocalQueue` — append-only JSONL queue with offset tracking
- [x] Bucket utilities — `toUtcHalfHourStart()`, `bucketKey()`, `addTokens()`, `emptyTokenDelta()`
- [x] Path utilities — `resolveDefaultPaths()`

### 2.3 Parsers (4 tools)
- [x] Claude Code parser — byte-offset JSONL, `normalizeClaudeUsage()`
- [x] Gemini CLI parser — array-index JSON, cumulative diff via `diffTotals()`
- [x] OpenCode parser — per-file messages, cumulative diff, triple-check unchanged optimization
- [x] OpenClaw parser — byte-offset JSONL

### 2.4 Commands
- [x] `executeSync()` — orchestrator with dependency injection, progress events
- [x] `executeStatus()` — queue/cursor state reporting
- [x] File discovery for all 4 sources (optimized with `withFileTypes`)
- [x] CLI wiring — citty subcommands (sync/status/login)

### 2.5 Tests
- [x] 128 unit tests across 14 test files
- [x] 9 CLI E2E tests (dedicated vitest.e2e-cli.config.ts)
- [x] Real-machine validation: 67,582 events → 1,525 queue records

---

## Phase 3: SaaS Backend ✅

### Architecture

```
CLI (pew sync) ──→ POST /api/ingest ──→ D1 (via Cloudflare HTTP API)
Browser          ──→ Auth.js (Google)  ──→ Session cookie
Dashboard        ──→ GET /api/usage    ──→ D1 query → JSON response
CLI (pew login)──→ Browser OAuth flow → Token saved to ~/.config/pew/config.json
```

### Database: Cloudflare D1

Accessed from Railway via Cloudflare D1 HTTP API:
`POST https://api.cloudflare.com/client/v4/accounts/{account_id}/d1/database/{database_id}/query`

#### Schema

```sql
-- Users table (synced from Auth.js)
CREATE TABLE users (
  id TEXT PRIMARY KEY,           -- Auth.js user ID
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  image TEXT,                    -- avatar URL
  slug TEXT UNIQUE,              -- public profile slug (e.g. "nocoo")
  api_key TEXT UNIQUE,           -- for CLI auth (pk_* prefix)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Usage records table (main data)
CREATE TABLE usage_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  source TEXT NOT NULL,          -- 'claude-code' | 'gemini-cli' | 'opencode' | 'openclaw'
  model TEXT NOT NULL,
  hour_start TEXT NOT NULL,      -- ISO 8601 half-hour boundary
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, source, model, hour_start)  -- upsert key
);

CREATE INDEX idx_usage_user_time ON usage_records(user_id, hour_start);
CREATE INDEX idx_usage_source ON usage_records(source);

-- Auth.js required tables
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  refresh_token TEXT,
  access_token TEXT,
  expires_at INTEGER,
  token_type TEXT,
  scope TEXT,
  id_token TEXT,
  UNIQUE(provider, provider_account_id)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  session_token TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires TEXT NOT NULL
);

CREATE TABLE verification_tokens (
  identifier TEXT NOT NULL,
  token TEXT NOT NULL,
  expires TEXT NOT NULL,
  PRIMARY KEY(identifier, token)
);
```

### 3.1 D1 Client
- [x] `packages/web/src/lib/d1.ts` — Cloudflare D1 HTTP API client
- [x] Environment variables: `CF_ACCOUNT_ID`, `CF_D1_DATABASE_ID`, `CF_D1_API_TOKEN`
- [x] Typed query helpers: `d1Query()`, `d1Execute()` (note: no batch — D1 REST API limitation)

### 3.2 Auth (Auth.js v5 + Google OAuth)
- [x] `packages/web/src/auth.ts` — NextAuth config with Google provider, JWT strategy
- [x] `packages/web/src/app/api/auth/[...nextauth]/route.ts` — route handler
- [x] Custom D1 adapter for Auth.js (`D1AuthAdapter`, maps to D1 HTTP API)
- [x] Environment variables: `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`
- [x] Reverse proxy support: `trustHost: true`, secure cookie config

### 3.3 API Routes
- [x] `POST /api/ingest` — receive queue records from CLI
  - Auth: Bearer token / session cookie / E2E bypass
  - Body: `QueueRecord[]` array (max 1000)
  - Upsert into `usage_records` (ON CONFLICT UPDATE, additive merge)
  - Validate source, model, hour_start format
- [x] `GET /api/usage` — query usage data for dashboard
  - Auth: Bearer token / session cookie / E2E bypass
  - Query params: `from`, `to`, `source`, `granularity` (half-hour/day)
  - Returns `{ records, summary }`
- [x] `GET /api/auth/cli` — CLI login callback endpoint
- [x] `GET /api/leaderboard` — public leaderboard with period filtering
- [x] `GET /api/users/[slug]` — public profile data with daily aggregation

### 3.4 CLI Login (Browser OAuth Flow)
- [x] `pew login` starts local HTTP server on random port
- [x] Opens browser to `https://pew.md/api/auth/cli?callback=http://localhost:{port}` (or `pew.dev.hexly.ai` with `--dev`)
- [x] User authenticates via Google OAuth on SaaS
- [x] SaaS generates `pk_*` API key, redirects back to local server
- [x] CLI saves API key to `~/.config/pew/config.json`

### 3.5 CLI Upload (pew sync → POST /api/ingest)
- [x] After local sync, read queue records from JSONL
- [x] Batch upload to POST /api/ingest with Bearer token (max 1000 per batch)
- [x] Track upload cursor (last uploaded byte offset)
- [x] Retry on failure with exponential backoff
- [x] `pew sync --upload` auto-uploads after parsing (default if logged in)

### 3.6 Tests
- [x] D1 client unit tests
- [x] Auth adapter unit tests
- [x] Ingest API unit tests
- [x] Usage API unit tests
- [x] CLI auth endpoint unit tests
- [x] L3 API E2E tests against real D1 (ingest, usage, cli-auth)

---

## Phase 4: Dashboard & Public Profiles ✅

### 4.1 Basalt Design System
- [x] 3-tier luminance theme (dark/light) with chart color palette
- [x] App shell layout — sidebar, breadcrumbs, theme toggle
- [x] Login page with Google OAuth sign-in
- [x] `proxy.ts` — Next.js 16 proxy convention for auth redirects

### 4.2 Dashboard (`/`)
- [x] Stat cards — total tokens, estimated cost, cache savings, input/output/cached breakdown
- [x] Usage trend chart — Recharts area chart (daily)
- [x] Source donut chart — by AI tool
- [x] Model breakdown chart — horizontal bar chart
- [x] Activity heatmap — GitHub-style 365-day calendar
- [x] Dashboard skeleton loading state
- [x] Cost estimation — static pricing table (Anthropic, Google, OpenAI) with cache savings

### 4.3 Public Profiles (`/u/:slug`)
- [x] Public profile pages with full usage widgets
- [x] Dynamic SEO metadata (generateMetadata)
- [x] `ProfileView` client component

### 4.4 Leaderboard (`/leaderboard`)
- [x] Public ranking by total tokens
- [x] Period tabs: week / month / all
- [x] Trophy/medal/award icons for top 3

### 4.5 Tests
- [x] Pricing + cost estimation unit tests
- [x] Usage helpers unit tests
- [x] Public profile API unit tests
- [x] Leaderboard API unit tests

---

## Phase 5: Remaining Work (TODO)

- [ ] `/settings` page — user profile, API key management, preferences
- [ ] Database migration files — version-controlled schema management
- [ ] L4 BDD E2E tests — Playwright core user flows (port 27020)
- [ ] Rate limiting on `/api/ingest`
