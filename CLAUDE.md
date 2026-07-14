## Project

pew is a monorepo (Bun workspaces) for tracking token usage from local AI coding tools.

- `packages/core` — shared TypeScript types (`@pew/core`, private, zero runtime deps)
- `packages/cli` — CLI tool (`@nocoo/pew`, published to npm, citty + consola + picocolors)
- `packages/web` — SaaS dashboard (`@pew/web`, private, Next.js 16 + App Router)
- `packages/worker` — Cloudflare Worker for D1 ingest writes (`@pew/worker`, private)
- `packages/worker-read` — Cloudflare Worker for D1 read queries (`@pew/worker-read`, private)

### Supported AI Tools

Claude Code, Codex, Gemini CLI, GitHub Copilot CLI, Grok, Hermes, Kosmos, OpenCode, OpenClaw, Pi, PM Studio, VS Code Copilot, ZCode

### Source Scanning Principles

Three inviolable rules govern how pew interacts with source data:

1. **Raw Data is READ-ONLY**: Never modify, delete, or move any original log files from AI tools. pew only reads these files; write operations are limited to pew's own state files under `~/.config/pew/`.

2. **Source Isolation**: Each source must be completely independent. Even if a parser has a bug, the worst case is that one source returns incorrect data — it must never corrupt or affect data from other sources.

3. **Idempotent Uploads**: Users can `pew reset && pew sync` at any time. Duplicate uploads are safely deduplicated via `ON CONFLICT` upserts, never summed. The same raw data always produces the same final state.

### Key Conventions

- **Runtime**: Bun (package manager + runtime)
- **TypeScript**: Strict mode, composite project references
- **Port**: dev=7020, API E2E=17020, BDD E2E=27020
- **Testing**: Quality system — L1 Unit + L2 Integration + L3 System/E2E + G1 Static Analysis + G2 Security + D1 Test Isolation (see docs/30-quality-system-upgrade.md, docs/31-d1-test-isolation.md). Vitest for L1 (`bun run test`), real HTTP E2E for L2 (`bun run test:e2e`), Playwright for L3 (`bun run test:e2e:ui`). Quality system requirements: G1 runs `bun run typecheck` (`tsc --noEmit` across all 5 packages) + `biome check --error-on-warnings` + two AST-based gates (`scripts/check-dynamic-delete.ts`, `scripts/check-ts-expect-error.ts` — both use oxc-parser, decoupled from tsc version) + tests must not use `.skip` / `.only` (enforced by biome's `noSkippedTests` + `noFocusedTests` elevated to error in the test-file override); G2 must use `scripts/run-security.ts` as single entry point; L3 specs must be read-only (no writes to prod D1); D1 isolation: E2E tests use remote `pew-db-test` via remote `pew-ingest-test` + `pew-test` Workers, gated by `scripts/d1-test-guard.ts` (four-layer check: env vars set, DB ID ≠ prod, Worker URLs ≠ prod, `_test_marker` table verified via D1 REST); `push tag` does not trigger pre-push hooks (no `--no-verify` needed).
- **TDD**: Always write tests first, then implement
- **Commits**: Conventional Commits, atomic, auto-commit after changes
- **`@pew/core` is NOT published**: Pure types, `import type` only, `devDependencies`

### DateTime Strategy

All date/time values follow a strict UTC-in, local-out pattern:

- **Storage (D1 SQLite)**: All `created_at`, `updated_at`, `hour_start` use `datetime('now')` which returns UTC. Season `start_date`/`end_date` are ISO 8601 UTC strings (`YYYY-MM-DDTHH:mm:ssZ`).
- **Computation (API routes, Worker, CLI)**: All date arithmetic uses UTC (`toISOString()`, `Date.UTC()`, `getUTC*()` methods). Never use `setDate()`/`getDate()` for server-side date math — always use `setUTCDate()`/`getUTCDate()`.
- **Display (Web UI)**: Convert to user's local timezone before rendering. Use the `tzOffset` pattern (`new Date().getTimezoneOffset()`) for data bucketing. For timestamps use `toLocaleString()`/`toLocaleDateString()` on the client.
- **Form input (`datetime-local`)**: The input shows local wallclock time. On load, convert UTC → local via `utcToLocalDatetimeValue()`. On submit, convert local → UTC via `localDatetimeValueToUtc()`. Both helpers live in `date-helpers.ts`. Never append `Z` to a `datetime-local` value directly — that treats local time as UTC.
- **Season dates**: Stored as ISO 8601 UTC datetime (e.g. `2026-03-15T00:00:00Z`), **precision to minute**. Status derived at read time via `deriveSeasonStatus()`, never stored.
- **Date comparison**: Always use epoch ms (`new Date(x).getTime()`) for ordering/equality checks. Never use string comparison — ISO formats with/without seconds or milliseconds have unstable lexicographic order.

## CLI Dev Workflow

```bash
# Build all packages (core types → CLI → web → worker)
bun run build

# Start dev server (port 7020)
bun run --filter '@pew/web' dev

# Run sync against dev server
NODE_TLS_REJECT_UNAUTHORIZED=0 bun packages/cli/dist/bin.js sync --dev

# Full reset sync (delete cursors + queue, then sync)
rm -f ~/.config/pew/cursors.json ~/.config/pew/queue.jsonl ~/.config/pew/queue.state.json
NODE_TLS_REJECT_UNAUTHORIZED=0 bun packages/cli/dist/bin.js sync --dev
```

### State Files

- `~/.config/pew/config.json` — prod API key (`pk_...`)
- `~/.config/pew/config.dev.json` — dev API key
- `~/.config/pew/cursors.json` — per-file byte offsets + dir mtimes (shared across dev/prod)
- `~/.config/pew/queue.jsonl` — pending upload records
- `~/.config/pew/queue.state.json` — upload queue metadata

## npm Publish Procedure

CLI package `@nocoo/pew` is published to npm. Steps:

1. **Release** — `bun run release` (or `bun run release -- minor|major|x.y.z`). Bumps version across all files, syncs lockfile, generates CHANGELOG, verifies no stale versions remain, commits. Push/tag/GitHub-release runs interactively (pre-push runs L2/L3/G2 gates; ensure `packages/web/.env.local` and `.env.test` exist and CF_D1_API_TOKEN has access to both `pew-db` and `pew-db-test`).
2. **Build (mandatory both)** — `bun install && bun run build && bun run --filter '@nocoo/pew' build`. Root `bun run build` builds core + web only; CLI must be built explicitly.
3. **Test** — `bun run test`
4. **Verify dist version** — `grep 2.x.y packages/cli/dist/cli.js` (or check `packages/cli/package.json` — CLI reads version at runtime from `readVersion()`, so the package.json bump is authoritative).
5. **Dry-run** — `cd packages/cli && npm publish --dry-run`
6. **Publish** — `cd packages/cli && npm publish` (npm may prompt for OTP — supply `--otp=<code>` or complete browser auth)
7. **Verify** — `npx @nocoo/pew@latest --help`
8. **Watch CI** — after push, set a 2-3 min timer and check `gh run list --limit 5`. Local pre-push does not catch every failure mode (workspace links, deploy pipeline).

## Retrospective

Grouped by domain. Each entry is a bug we shipped or nearly shipped, and the lesson learned.

### Testing & TDD

- **Refactoring a widely-used factory function requires migrating tests in the same commit**: Introducing `getDbRead()` to replace `getD1Client()` broke 89 tests because (1) the async singleton cached the `DbRead` instance so `beforeEach` re-mocking of `getD1Client` never propagated, and (2) tests had to mock `@/lib/db` (with `mockResolvedValue`) instead of `@/lib/d1`. When you insert an abstraction layer, migrate every mock target in the same commit — mock-through-transitive-dependency silently breaks.
- **Next.js dev server rewrites `next-env.d.ts` and `tsconfig.json`**: Running `next dev` with `NEXT_DIST_DIR=.next-e2e` overwrites both files. Always `git checkout` them after E2E runs to avoid committing noise.
- **Split multi-file changes into atomic commits**: The season datetime upgrade (17 files) shipped as one commit — bisect/revert become impossible at granular level. Split by layer: lib helpers, API route validation, UI, display formatting, tests, docs, migration. Also, always write tests first; the `.000Z` vs `Z` lexicographic bug was caught by accident, not by red-green-refactor.

### CLI parsers

- **VSCode Copilot audit: verify raw data before writing conclusions**: The initial doc/17 spike reported wrong token counts (audit script conflated "empty result" with "result without tokens" and missed a whole category). Causal claims like "missing-token requests are non-billable incomplete turns" were false — 3 of them had 40+ tool calls and 10+ minutes elapsed. Design advice must cover the full read lifecycle (first parse + incremental resume), not just the happy path.
- **Claude Code subagent files share parent's `sessionId`**: One conversation = 1 main JSONL + N subagent files, all with the same `sessionId`. Real machine: 973 files → 124 unique sessions, heaviest spanning 38 files. Token pipeline is unaffected (ignores `sessionId`, counts per-file). Session pipeline is approximate — `deduplicateSessionRecords()` keeps only the last-seen snapshot instead of merging across files. Accepted trade-off: token accuracy is the priority.
- **Copilot-CLI parser endOffset rewind was off by one telemetry marker line**: `lastCompletedOffset` advanced past `[Telemetry] cli.telemetry:` unconditionally. On resume from a truncated JSON block, the parser started at `{` instead of the marker, never set `collectingJson=true`, and permanently skipped the block. Test codified the wrong behavior. Lesson: incremental offset tests must include a round-trip (parse → rewind → file grows → re-parse) that verifies the rewound content is actually retried.

### D1 / SQL

- **D1 REST API has no batch endpoint**: `/query` only accepts a single `{ sql, params }` object. Sending an array (like `db.batch()`) returns "Expected object, received array". Unit tests with mocked fetch won't catch it. Fix: send statements individually, or migrate to a Worker with native D1 bindings (see next).
- **Worker with native D1 bindings replaces REST bottleneck**: D1 REST rejected multi-row INSERTs beyond ~5 rows, requiring 60 sequential HTTP calls for 300 records. Migrating to a Worker with `env.DB.batch()` collapses this to a single HTTP call with implicit transactional semantics. D1 Free plan caps 50 queries per Worker invocation → CHUNK_SIZE=50.
- **D1 SQLite param limit is 999**: 300 rows × 9 cols = 2700 params triggers `SQLITE_ERROR: too many SQL variables`. Safe max ~100 rows (900 params). CHUNK_SIZE=20 (180 params) has comfortable headroom. Only production D1 reveals this — L1 mocks and local SQLite differ.
- **SQLite string comparison is format-sensitive — query format must match storage format exactly, byte-for-byte**: Season queries used `.replace("T", " ")` to convert ISO to space-separated for `hour_start >= ?`, but `hour_start` was stored as full ISO 8601. Lexicographically `'T'` (84) > `' '` (32), so a `'...T...'` value satisfied `>= '...'space...'` regardless of the actual time — leaked a whole day (894M tokens instead of 65M). Unit tests codified the wrong format as expected. Fix: `toISOString()` directly, no transformation.
- **Cursor-format-upgrade backfill must handle "field absent AND cursor already lost"**: The `knownDbSources` backfill initialized to `{}` when `openCodeSqlite` cursor was missing, assuming this state "never shipped". But if a user had `knownFilePaths` (v1.6.0) without `knownDbSources` AND the SQLite cursor was already lost, backfilling to `{}` meant later cursor-loss detection found nothing and skipped the full rescan — letting a full SQLite replay get SUM'd into an incremental sync (2× inflation). Fix: when the DB cursor is gone but other cursors exist, force a full rescan instead of `{}`. "Never shipped" assumptions in upgrade code are fragile — handle combinatorial state space defensively.

### Cloudflare Worker deploy

- **Any Worker code change requires `wrangler deploy` before it takes effect**: Two variants we've hit — (a) migration 006 added `device_id` to a UNIQUE constraint and the Worker's `ON CONFLICT` clause was updated in the same commit, but not deployed, so every ingest returned `ON CONFLICT clause does not match ...`; (b) adding a `deviceId` filter to `handleGetUsage()` in worker-read passed all local tests but the deployed Worker ignored the unknown field and returned unfiltered data — Deep Dive charts partially worked, confusing. Procedure: after any Worker RPC handler or schema change, run `wrangler deploy` and verify with a real request before considering the feature complete.

### Next.js / Auth.js

- **Next.js `next build` evaluates server modules at build time**: During "Collecting page data", API route modules are imported and their top-level code runs. If `getD1Client()` is called at module scope (e.g. in `auth.ts`), it throws when env vars are missing. Fix: pass Railway env vars via Docker `ARG` directives; Railway auto-injects service vars as build args.
- **Next.js 16 `proxy.ts` matcher must exclude API routes**: The `proxy.ts` convention replaces `middleware.ts` and runs on every matched route. Without excluding `/api/*`, Auth.js's `auth()` wrapper redirects unauthenticated GETs to `/login` before the route handler can check Bearer tokens via `resolveUser()`. POST requests may still work, making the bug intermittent. Fix: `api/(?!auth)` in the matcher's negative lookahead.
- **Next.js standalone output excludes `public/`**: `output: "standalone"` does NOT include `public/` (intended for CDN serving). Dockerfile must `COPY --from=builder /app/packages/web/public ./packages/web/public` alongside `.next/standalone` and `.next/static`. Without this, `<Image src="/logo.png">` triggers a 400 from `/_next/image?url=%2Flogo.png`. Invisible in `next dev`. File-based metadata (`icon.png` in `src/app/`) is fine — compiled into `.next/`. Anything referenced by `<Image>` with a string `src` needs the copy.
- **NextAuth lazy-init `auth()` wrapper must not be called at module scope in `proxy.ts`**: The `NextAuth((req) => config)` lazy-init pattern, when called at module top level and stored in a `const`, produces a non-function value in Turbopack production builds (minified `sZ is not a function`). Dev is fine because Turbopack evaluates modules differently. Fix: call `auth(callback)` inside `proxy()`'s function body so it runs at request time. Per-request overhead is negligible after NextAuth's first-call config cache.
- **NextAuth lazy-init `auth(callback)` returns `Promise<Function>`, not `Function`**: The `initAuth()` function is async; `auth(callback)` on the lazy-init pattern returns a Promise. Without `await` you get `TypeError: authHandler is not a function`. Fix: `const authHandler = await auth((req) => {...})`. Static-config pattern (`NextAuth({...})`) is sync and doesn't need await.
- **`request.url` in Docker uses internal hostname**: Behind a reverse proxy (Railway), `new URL(request.url).origin` resolves to `http://0.0.0.0:8080`, not the public domain. Any API route that constructs a redirect URL must go through `getPublicOrigin(request)` (reads `x-forwarded-host` / `x-forwarded-proto`, falls back to `NEXTAUTH_URL`, then `request.url`).

### Railway / deployment

- **Railpack cannot install Bun workspaces**: Even with `bun.lock` tracked and "Bun runtime detected", Railpack still uses `npm install`, which fails on `workspace:*`. Fix: custom Dockerfile with `oven/bun:1` base and `bun install --frozen-lockfile`.
- **Railway watch patterns block `railway up` deploys**: When watch patterns are set (e.g. `packages/web/**`), `railway up` compares against the previous deploy's files and skips the build even on first success. Fix: clear watch patterns when using `railway up` or Dockerfile builder.
- **Railway `startCommand` overrides Dockerfile `CMD`**: After switching builder to DOCKERFILE, the previously-set `startCommand` persists and overrides `CMD` (caused "executable `bun` could not be found" because the runner image was `node:22-slim`). Fix: explicitly clear `startCommand` to empty string via `railway environment edit`.
- **Never use `railway up` for web deployment**: `railway up` bypasses git-based CI/CD (pre-push hooks, L2/G2 gates). Deploy web via `git push` — Railway auto-deploys from the configured branch. Use `wrangler deploy` for Cloudflare Workers.

### UI / React

- **Lifting a React context provider requires auditing every consumer path**: PR #85 moved `TooltipProvider` from per-component to `LeaderboardPageShell`, but `/leaderboard/seasons/[slug]` renders those child components directly — runtime crash (`Tooltip must be used within TooltipProvider`). When lifting any Provider (Tooltip, Theme, etc.), grep for every import site of the child component and verify each is inside the new provider boundary.

### Process

- **After release, monitor CI**: After `git push`, set a 2-3 min timer and check `gh run list --limit 5`. Local pre-push doesn't catch every failure mode (workspace link resolution, deploy pipeline differences).
