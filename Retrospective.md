# Retrospective

Accident narratives and detailed root causes live here; recurring project rules stay in `AGENTS.md`.
Historical instructions describe their time; the current handbook takes precedence.
The entries below were migrated verbatim from the former root `CLAUDE.md` during handbook normalization; they were originally undated.

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

### Next.js standalone / Docker

- **`@swc/helpers@0.5.23` + Node 22 standalone crash**: `next@16.3.1` pulled `@swc/helpers` 0.5.15 → 0.5.23. The new package adds a `module-sync` export condition, so Node 22+ `require("@swc/helpers/_/...")` resolves to `esm/_interop_require_default.js`. Next standalone NFT only traces/copies the CJS files (`cjs/*.cjs` + `package.json` — 3 files). Railway boots `node packages/web/server.js` from standalone and dies with `MODULE_NOT_FOUND` for the ESM path. CI stays green because L2/L3 run `next dev` against the full `node_modules` tree and never build or boot the Docker standalone image. Fix: `scripts/fix-standalone-swc-helpers.ts` copies the full package into standalone after `next build` (wired in `@pew/web` build + Dockerfile).

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

- **Floating `oven/bun:1` broke Railway frozen-lockfile on Bun 1.4**: Dockerfile copied bun from `oven/bun:1`. Bun 1.4.0 (2026-08-20) rewrote override encoding (`brace-expansion@^2` string → `{ ".": "..." }`) and `lockfileVersion` 1 → 3. Local was 1.3.14; `--frozen-lockfile` failed from 8/22 onward. A later hand-edit also left a malformed `@types/react-dom` integrity hash. Fix: pin `oven/bun:1.4.0`, regenerate `bun.lock` with Bun 1.4, pin CI `bun-version` to 1.4.0. Never float the Bun image tag across minors.
- **Railpack cannot install Bun workspaces**: Even with `bun.lock` tracked and "Bun runtime detected", Railpack still uses `npm install`, which fails on `workspace:*`. Fix: custom Dockerfile with a pinned `oven/bun` image and `bun install --frozen-lockfile`.
- **Railway watch patterns block `railway up` deploys**: When watch patterns are set (e.g. `packages/web/**`), `railway up` compares against the previous deploy's files and skips the build even on first success. Fix: clear watch patterns when using `railway up` or Dockerfile builder.
- **Railway `startCommand` overrides Dockerfile `CMD`**: After switching builder to DOCKERFILE, the previously-set `startCommand` persists and overrides `CMD` (caused "executable `bun` could not be found" because the runner image was `node:22-slim`). Fix: explicitly clear `startCommand` to empty string via `railway environment edit`.
- **Never use `railway up` for web deployment**: `railway up` bypasses git-based CI/CD (pre-push hooks, L2/G2 gates). Deploy web via `git push` — Railway auto-deploys from the configured branch. Use `wrangler deploy` for Cloudflare Workers.

### UI / React

- **Lifting a React context provider requires auditing every consumer path**: PR #85 moved `TooltipProvider` from per-component to `LeaderboardPageShell`, but `/leaderboard/seasons/[slug]` renders those child components directly — runtime crash (`Tooltip must be used within TooltipProvider`). When lifting any Provider (Tooltip, Theme, etc.), grep for every import site of the child component and verify each is inside the new provider boundary.

### Process

- **After release, monitor CI**: After `git push`, set a 2-3 min timer and check `gh run list --limit 5`. Local pre-push doesn't catch every failure mode (workspace link resolution, deploy pipeline differences).

### 2026-09-24 — Explicit Herdr pane targets

During dependency maintenance, `herdr pane resize --current` resolved to a neighboring project's focused pane despite the intended project context. The returned workspace ID exposed the mismatch; the resize was reversed immediately, then applied to pew using its explicit pane ID. For layout mutations, resolve the target from agent discovery and verify the returned pane/workspace IDs instead of relying on `--current`.

### 2026-09-25 — Preserve invitation consumption during account deletion

The first account-deletion revision cleared `invite_codes.used_by` while removing
identifiers. Review of the consumer showed that `used_by IS NULL` authorizes
redemption, so clearing it would reopen a consumed code. Before release, replace
the identity with an anonymous consumed marker and verify in SQLite that deleting
the user never makes the code redeemable. Check authorization predicates before
anonymizing fields that also encode state.

### 2026-09-25 — Verify delegated work starts

Two Codex panes became idle after the provider rejected an unsupported service
tier on their first request. Reading the actual pane output revealed that no work
had started; the sessions were resumed with a supported model. A ready pane or an
idle status is not execution evidence. Verify the first request before relying on
parallel progress.


## 2026-09-25 — Bound automated RPC migration edits to syntax

During the final read-RPC migration, a broad multiline replacement matched across
separate organization route functions. Diff inspection caught the deletion before
commit. The affected files were regenerated from the checkout baseline using
bounded call matches, and route behavior was rechecked with the existing tests.
For repetitive migrations, inspect the first transformed diff before expanding
it, and use the installed AST parser for chained test rewrites. TypeScript 7 in
this repository does not expose the old compiler parsing API; use oxc-parser.

The isolated worktree had dependencies and `core.hooksPath` but no local Husky
launchers, so the first commit did not invoke pre-commit. The launchers were
materialized locally and the commit amended through the full staged-snapshot
gate. Verify the executable hook entrypoint exists before committing in a new
worktree; dependency links alone do not install Git hooks.
