# Zebra — Phase 1 Implementation Plan

> Monorepo skeleton for token usage tracking CLI + SaaS dashboard.
> Mirror structure from `../otter`, token collection logic from `../vibeusage`.

## Overview

Zebra collects token usage from 5 local AI coding tools and provides a SaaS dashboard
with auth, data display, public profiles, and leaderboards.

### Supported AI Tools

| # | Tool | Data Location |
|---|------|---------------|
| 1 | Claude Code | `~/.claude/projects/**/` |
| 2 | Codex CLI | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` |
| 3 | Gemini CLI | `~/.gemini/tmp/*/chats/session-*.json` |
| 4 | OpenCode | `~/.local/share/opencode/storage/message/` |
| 5 | OpenClaw | `~/.openclaw/agents/*/sessions/*.jsonl` |

### Tech Stack

- **Runtime**: Bun (workspaces, no Turborepo/Nx)
- **Language**: TypeScript 5.7+ strict mode, composite project references
- **Testing**: Vitest (unified root config, 90% coverage thresholds)
- **CLI**: citty (UnJS ecosystem) + consola + picocolors
- **Web**: Next.js 16 + App Router + React 19
- **Auth**: NextAuth v5 + Google OAuth
- **Storage**: Cloudflare D1 (NO R2)
- **UI**: Tailwind CSS v4 + shadcn/ui
- **Deploy**: Railway via Docker multi-stage build

---

## Four-Layer Testing Architecture (TDD)

All development follows **TDD** — write tests first, then implement.

| Layer | What | When | Tool | Port |
|-------|------|------|------|------|
| L1 | Unit Tests | pre-commit (Husky) | Vitest | — |
| L2 | Lint / Type Check | pre-commit (Husky) | `tsc --noEmit` strict | — |
| L3 | API E2E | pre-push (Husky) | Vitest + fetch | 17029 |
| L4 | BDD E2E | on-demand | Playwright | 27029 |

### Rules

- **L1**: 90%+ coverage enforced by pre-commit hook script. Fail = block commit.
- **L2**: Zero tolerance for errors/warnings. Strict mode mandatory.
- **L3**: 100% REST API coverage. `E2E_SKIP_AUTH=1` to bypass auth. Dev port 7029 → E2E port 17029.
- **L4**: Core user flows via Playwright. Port 27029. Run manually.
- **Husky**: pre-commit runs L1+L2 with coverage check; pre-push runs L3.

---

## Phase 1: Monorepo Skeleton

### 1.1 Root Configs
- [x] `package.json` — Bun workspaces (`"workspaces": ["packages/*"]`)
- [x] `tsconfig.json` — ES2022, NodeNext, strict, composite project references
- [x] `.gitignore` — node_modules, dist, .next, .env, coverage, etc.
- [x] `CLAUDE.md` — project conventions for AI agents

### 1.2 Core Package (`packages/core`)
- [x] `package.json` (`@zebra/core`, private, types-only)
- [x] `tsconfig.json` (extends root, composite: true)
- [x] `src/types.ts` — Source enum (5 tools), UsageRecord, TokenDelta, HourBucket, SyncCursor
- [x] `src/index.ts` — re-export types
- [x] `src/__tests__/types.test.ts` — type-level tests (TDD: write first)

### 1.3 CLI Package (`packages/cli`)
- [x] `package.json` (`@nocoo/zebra`, public, bin entry)
- [x] `tsconfig.json` (extends root, references core)
- [x] `src/bin.ts` — entry point
- [x] `src/cli.ts` — citty main command with subcommands
- [x] `src/commands/init.ts` — stub
- [x] `src/commands/sync.ts` — stub
- [x] `src/commands/status.ts` — stub
- [x] `src/commands/login.ts` — stub
- [x] `src/__tests__/cli.test.ts` — CLI smoke tests (TDD: write first)

### 1.4 Web Package (`packages/web`)
- [x] `package.json` (`@zebra/web`, private, Next.js 16)
- [x] `tsconfig.json` (extends root, Next.js settings)
- [x] `next.config.ts`
- [x] `src/app/layout.tsx` — root layout
- [x] `src/app/page.tsx` — landing page
- [x] `src/app/globals.css` — Tailwind v4 setup
- [x] `src/__tests__/page.test.tsx` — page render test (TDD: write first)

### 1.5 Testing Infrastructure
- [x] `vitest.config.ts` — root config, 90% coverage thresholds
- [x] `.husky/pre-commit` — runs L1 (vitest) + L2 (tsc --noEmit), checks coverage
- [x] `.husky/pre-push` — runs L3 (API E2E)
- [x] `scripts/check-coverage.ts` — coverage threshold enforcement script

---

## Phase 2: CLI Token Collection (future)

- [ ] Port 5 AI tool parsers from vibeusage
- [ ] Incremental parsing with cursor tracking (file offset, inode, mtime)
- [ ] Half-hour UTC bucket aggregation
- [ ] Local queue management (JSONL)
- [ ] Hook installation for each tool (init command)
- [ ] Batch upload to SaaS backend (sync command)

## Phase 3: SaaS Backend (future)

- [ ] NextAuth v5 + Google OAuth setup
- [ ] API routes: POST /api/ingest, GET /api/usage
- [ ] Cloudflare D1 storage layer (metadata DB)
- [ ] Rate limiting + validation

## Phase 4: Dashboard & Public Profiles (future)

- [ ] Usage trend display (day/week/month/total)
- [ ] Activity heatmap
- [ ] Model breakdown charts
- [ ] Cost estimates (OpenRouter pricing)
- [ ] Public profile pages
- [ ] Leaderboard (week/month/total)
