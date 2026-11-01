# Retrospective

### 2026-11-01: Verify delegated browser and commit results

A delegated device-focus fix was committed without running its browser regression
because the task-local Chromium path was not supplied; the controller's run then
found that the last-device focus target disagreed with the test. Pass the isolated
browser path to delegated runs and verify the actual focus target before claiming
success. A separate delegated commit also omitted the Conventional Commit colon;
check every resulting subject before considering the branch ready to push.

### 2026-11-01: A temporary registry changed lockfile provenance

Updating workspace versions with Bun's per-command registry override rewrote
resolved package URLs to the local mirror. The churn was caught before commit;
the existing dependency entries were restored and only workspace versions were
updated, then verified with a frozen-lockfile dry run. Inspect lockfile diffs
after registry overrides and keep machine-specific mirrors out of release commits.

### 2026-10-22: An IPv4-mapped socket is not native IPv6 evidence

The initial cutover probe used `curl -6`, but the machine's resolver/network layer
returned a synthetic IPv4-mapped peer. A successful response proved application
reachability, not public native IPv6. Before marking acceptance complete or
promoting the deployment phase, retrieved the real public AAAA records and forced
strict canonical-host HTTPS to each global, non-mapped IPv6 address. Both passed,
including after the temporary listener was removed. Record the connected address
and reject mapped/fake addresses when claiming IPv6 coverage; distinguish IPv6
at Cloudflare's edge from a source server without global IPv6. No DNS or proxy
rollback was required because the real-address acceptance passed.

### 2026-10-22: A historical replay is not a harmless upload probe

Independent review rejected an unexecuted production-acceptance script that
selected an old D1 bucket and replayed it through the CLI. Age does not establish
immutability: a concurrent correction could be overwritten, and an equal
post-read would then falsely certify the stale value. The revised design uses
the real CLI state lock and genuine pending usage, with original queue/cursor
bytes retained. A temporary collector is not automatically safe either: upgrades,
lost cursors and internal replay can rebuild incomplete history. Abort every
warning/replay/rescan path and verify complete monotonic baselines plus a genuine
increment before any POST. If the preconditions fail, report unverified instead
of manufacturing a passing production write. No rejected script was executed.

The same review required explicit `rejectUnauthorized: true` rather than relying
on environment defaults, and moved secret-bearing initialization inside sanitized
error handling. A failure after POST can follow a committed write; local cleanup
must never be described as a production rollback.

### 2026-10-22: Acceptance wrappers must preserve route and shell contracts

An extra private-origin check expected 200 from the protected `/leaderboard`
page. Its legitimate 307 to canonical login caused an AssertionError even though
health, data and image paths worked. The corrected check asserts that redirect;
the independent CLI E2E lane passed all 13 cases. A follow-up zsh loop also used
the special `path` variable, changing that child shell's executable search path.
Renaming it to `urlPath` restored the probe; no service configuration changed.
Inspect actual route authorization and avoid zsh's special parameter names in
operational wrappers instead of treating wrapper failures as application faults.

### 2026-10-22: A Docker gateway is not an SSH-only identity

The initial Caddy staging candidate trusted the edge bridge gateway to identify
SSH-forwarded requests. Review caught that Docker userland-proxy can map other
traffic to that address, particularly IPv6-to-IPv4 connections. Before applying
anything, the candidate was changed to an unpublished container-internal TLS
listener; the public Pew listener only denies requests. Verify socket exposure
and actual external behavior, not just a source-IP matcher or intended topology.
The runbook now distinguishes proposed privacy controls from verified receipts.

### 2026-10-22: Pass PEM requests through the CLI JSON body

The first Origin CA request supplied a PEM CSR as a separate `--csr` argument.
The CLI interpreted its leading dashes as options and rejected it before sending
an API request. Inspection of a dry run established that no certificate had been
created. Passing the public CSR through the documented JSON body succeeded; the
private key never left jp2. When an operation reports failure, distinguish local
argument parsing from a remote failure before retrying a certificate issuance.

### 2026-10-22: Resolve traced native modules from their runtime consumer

The first secretless Docker smoke check assumed standalone output retained
`packages/web/node_modules/sharp`. The build had succeeded, but that direct link
was absent: Bun's traced Sharp package and native bindings were present under
the isolated dependency tree used by Next.js. The check now resolves Sharp from
the traced Next package, as the image optimizer does, instead of adding unused
links or copying the full installation. Inspect the isolated runtime tree before
diagnosing a failed smoke-check import as a missing dependency. No image was
published and no running service changed.

## 2026-10-09: Antigravity reference decoders contradicted the installed schema

Recent high-star usage trackers treated `ModelUsageStats` field 1 as additional
system-prompt tokens; the installed CLI descriptor identifies it as the model
enum. One decoder also reversed thinking and visible-response fields. Copying
these mappings would inflate input and mislabel output despite plausible totals.
Verify descriptor names and cross-check independent persisted representations
before adopting undocumented wire mappings; popularity is not accounting proof.

The first full verification ran in the daily checkout and correctly failed its
environment-file guard. A clean clone then rejected external dependency symlinks
under Turbopack. Leave private environment files untouched and use an owned,
environment-file-free clone with copy-on-write dependencies for real HTTP tests.

Node's SQLite tests passed with a read-only copied WAL database, but the actual
Bun reader failed because the private copy lacked a shared-memory index. Only
the temporary snapshot may open writable to recover its copied WAL; original
databases and sidecars remain untouched. Add an actual Bun-process WAL regression
with source-byte equality assertions, not just tests under Vitest's Node runtime.
Run lifecycle coverage before HTTP/browser acceptance rather than concurrently:
the existing cleanup test inventories shared temporary roots, and rebuilding
Next while a development server is active can invalidate its generated output.

The initial parser mistook omitted cache and thinking scalars for unavailable
accounting. The installed descriptor uses proto3 implicit presence, so omitted
zero-hit calls must still contribute their input to the weighted cache-rate
denominator. Verify scalar presence as well as field numbers; regressions now
combine an omitted-zero cache field with a positive-hit call.

## 2026-10-04: Installed dependencies diverged from the release lockfile

The manifest and lockfile required Basalt 2.2.0, but the daily workspace still linked 2.1.8. Copying installed dependencies into an isolated acceptance checkout preserved that drift, so early green browser tests did not prove the locked release. The release installation exposed the mismatch; the corporate mirror lacked the exact tarball. Install from a verified allowed mirror, keep mirror URLs out of the lockfile, verify the resolved package version, and rerun build, coverage and browser gates before publication. A matching manifest alone is not installed-version evidence.

## 2026-10-04: Standalone agent share chart lacked a definite height

Reusing the overview donut as a standalone By Agent panel exposed its implicit dependency on a stretched parent. Its percentage-height responsive container rendered labels but no SVG when the flex parent had only a minimum height. The new real-data browser regression rejected the missing series at desktop and mobile widths. Give the shared donut an explicit chart height, and require populated marks rather than a title or legend before declaring a reused visualization ready.

## 2026-10-04 - A green page shell hid an all-time D1 failure

By Device's default all-time request failed at its first Worker query with
SQLITE_TOOBIG. One device had over 9 MB of valid accounting groups; the query
concatenated the entire history into one D1 JSON value. Monthly fixtures and
mocked arrays could not cross that limit. Browser tests accepted visible page
headings even when their data calls failed; several API tests even accepted 500.

Read annotations as bounded SQL partitions and combine them with checked
arithmetic in the Worker, retaining all counters, per-request context, pending
states and private-money boundaries. A synthetic >2 MiB history now exercises
the real local D1/Worker path in L1 and all four usage read methods. Reject 500
for known isolated schema, seed real page data, and require each page's key APIs
and modules to be ready. Keep intentional failure/visual mocks separate from
these readiness checks. Test the detector with a module returning 500 while its
page heading still renders. The pre-push shell must collect every lane's failure
and logs under Husky's `sh -e`, not exit before reporting the failed lane.

During recovery, concurrent native migrations took 34 seconds and exceeded
the 30-second startup deadline, masking the server-failure cleanup assertions.
Keep the native migration path and explicit timeout/abort tests; allow 60 seconds
for binding startup and 120 seconds for the two-database lifecycle, with outer
test deadlines above those bounds. These are reliability budgets, not evidence
that the full L1 gate meets its separate 30-second performance target.

Recovery shell commands must also fail closed: do not use zsh's special `path`
variable as a loop variable, and stop immediately when partial-index staging
fails. An incomplete commit attempt was stopped before it could commit; inspect
the staged diff before starting the full gate again.

## 2026-10-03 - Account for resize debounce before animation completion

The v3.1.1 push was rejected twice by the unchanged sidebar animation browser
test. After resuming, a real ResizeObserver notification schedules the existing
300 ms JS debounce; that later measurement can start a fresh 500 ms series
animation. The test advanced only 550 ms before asserting a final stable frame.
Advance the documented resize debounce before the animation interval and retain
the subsequent exact-frame equality check. Do not weaken the assertion, disable
animation or increase retries to hide the two-clock scheduling boundary.

## 2026-10-03 - A session index scan erased leaderboard savings

The v3.1.0 read-cache rollout reduced token leaderboard scans by about 80% in
the first comparable observation window, but session aggregates grew about
5.76-fold. Replacing the selected-user list with a join to all public users
made SQLite scan the entire session user/time index, including for recent
windows. Functional cold/warm and privacy tests passed because the totals were
correct; they did not verify the expensive session query's access path.

Use a public-user membership subquery so the existing user/time index performs
bounded searches. Regression tests now compare the complete results and inspect
the actual session SQL plan across time, source, team and organization filters.
Check every heavyweight query in a cache fill, not only the ranking query, and
distinguish an index scan from an index range search before claiming savings.

## 2026-10-03 - Cache review must include admission races and ingest bounds

The first leaderboard cache implementation measured a returned snapshot using
the current map entry's byte count after an await. A concurrent fill could put
a different object in that slot. Admission now measures the actual object and
has a delayed-fill regression. Review also caught a model-filter length limit
smaller than the ingest contract and extra cached envelope fields reaching the
response validator. Reuse ingest limits and project cache payloads explicitly;
successful cache shape validation does not authorize unrelated stored fields.

## 2026-10-03 - Local migration completion still waited on npm

The cache optimization commit was rejected twice by the staged L1 gate because
the local D1 lifecycle exceeded its existing deadlines. Wrangler logs showed
that every SQL migration had already completed; its banner's asynchronous npm
update check retained the process on this machine's blocked registry route.
Disabling the banner for isolated migration subprocesses avoids that unrelated
network operation. Keep the actual migrations, ownership checks, failure tests
and original deadlines; reducing test parallelism alone did not fix the cause.

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

### 2026-09-25 — Verify hook launchers in isolated worktrees

The security ingest checkout had materialized dependencies and `core.hooksPath=.husky/_`, but lacked the ignored Husky launchers. The first local body-limit commit therefore completed without running pre-commit. The missing launcher was detected immediately from the absent gate output, Husky was initialized using the existing installed package, and the commit was amended through the normal full staged-tree gate. Before committing in a fresh worktree, verify both the configured hook path and its executable launcher; the configuration value alone does not prove activation.

## 2026-09-25 — Visibility checks after cached pagination lose public rows

The first privacy fix filtered cached leaderboard pages after pagination. Independent review reproduced an early end to a page even though more public users existed, and the coordinator found that the 100-row page plus lookahead exceeded D1's 100-parameter limit. Revalidating one page also cannot repair offsets changed by a private user on an earlier page. Removed the global result cache so visibility, ordering and pagination execute together in SQL. A real SQLite regression covers privacy changes, deletion, successive pages and 101-row lookahead. Test authorization filtering together with pagination, not just the removal of a private row.

## 2026-09-25 — Keep native SQLite regressions outside Worker types

A roster-boundary regression imported `node:sqlite` into the read Worker's test directory. Vitest passed, but the normal commit gate correctly rejected the import because the Worker type environment contains no Node globals. Moved the native SQLite regression into `scripts/__tests__`, preserving the Worker runtime boundary and all strict checks. Choose the runtime-specific test lane before adding native imports. The later cross-runtime snapshot race regression also belongs in this scripts lane: placing it under Web tests pulls Worker source into the Web compiler settings. It was relocated after the unchanged strict typecheck rejected that placement.

## 2026-09-25 — Validate counts after every aggregation boundary

The initial numeric fix rejected unsafe native and cached Worker outputs, but independent review combined two individually safe historical values in the Web API and reproduced a rounded total with HTTP 200. Added shared checked integer addition to all six server-side count aggregation paths: usage, public profiles, sessions, device details, admin storage and user comparisons. Regression tests prove exact success at MAX_SAFE_INTEGER and failure above it for every path. A safe upstream row does not guarantee a safe downstream sum; trace the last aggregation before claiming output precision.

## 2026-09-25 — Freeze team and member totals from one observation

Independent review reproduced account deletion between the snapshot route's separate team and member aggregate reads. Deletion returned success and reduced a team's frozen total from 140 to 40, then snapshot generation restored the stale 140 while storing only 40 in member contributions. Snapshot generation now reads registered IDs and one member aggregate, derives team totals and ranks from those exact members, and retains zero-member teams. Checked addition rejects unsafe aggregates before any write. Real route/SQLite tests cover deletion before member reads, between reads and writes (foreign-key rollback), and after the atomic snapshot write. An atomic write cannot repair inconsistent observations assembled before its transaction.

## 2026-09-25 — Review lockfile transport changes before staging a release

A version-only `bun install` against the permitted temporary mirror expanded 445 tarball locations in the lockfile. The release commit was started before separating this transport churn from the version diff. Normalized only those mirror URLs after asserting every package resolution and integrity was otherwise unchanged, then reran the normal commit gate for the corrected staged release. Inspect the lockfile diff before staging; a successful no-dependency-change install can still persist machine-specific registry locations.

## 2026-10-03 — Exercise isolation failures before trusting local E2E

The first local E2E attempt checked health instead of SQL ownership, reused a fixed directory and tolerated duplicate migration errors. Replaced these shortcuts with per-run native Wrangler migrations, exact environment/run marker rows, authenticated loopback bindings and failure cleanup. Only three historical ALTER files are excluded because the checked-in initial schema explicitly supersedes them; invalid and duplicate SQL still fail. Strict checking caught a malformed table-driven guard fixture, so the harness and its regressions now belong to both normal typecheck paths.

A later SIGTERM regression showed that importing Wrangler in the runner installs Miniflare's immediate-exit hooks, interrupting asynchronous cleanup despite a `finally` block. The runtime now lives in a subprocess, imports Wrangler only after isolating its configuration directory, and closes via IPC after test/server children stop. Real D1 regressions cover interruption during migration, interruption after Next startup, failed startup, schema preservation, native Worker RPC and a corrupted ownership marker that must fail and retain files. Test the cleanup result, not just the presence of a cleanup function.

## 2026-10-03 — Make font builds independent of the Google resolver

Next 16.3.6 Turbopack rejected the generated Google-font URL query before compiling the production build. Bundled the same licensed Latin Inter, Space Grotesk and Caveat assets through `next/font/local`, retaining the existing weight declarations and CSS variables. Record font provenance and verify the original browser suite rather than substituting typography or treating a development server as build evidence.

## 2026-10-03 — Distinguish visible skeletons from ready chart geometry

The first pushed isolation repair passed local gates but CI's 2560px annual-calendar test read a null bounding box. Activity and Goal Tracker reuse the same region names while annual usage is loading; that response replaces the skeleton nodes independently of the main usage and salary content. A visible region was not proof of stable calendar DOM. The test now waits for the real 365 cells and non-busy regions, then retries the original strict alignment/order assertions without changing tolerances. Its wide-screen case deliberately holds the annual response until the loading state is observed, using the browser's local-year boundary rather than an assumed UTC date. The scrubbed child environment also now explicitly forwards only the CI flag so Playwright retains its configured CI policy; negative tests prove arbitrary parent values still do not cross the boundary.

## 2026-10-09 — Preserve history when retiring collectors

Independent review caught two historical-data risks before commit. Reset first
rewrote queues while active cursors still existed; a failed state write could
then prevent replay of deleted active buckets. Read and validate retained data
first, invalidate both cursor files, and only then rewrite queues. A synthetic
write-failure regression verifies recovery. Session UPSERT also allowed an active
source to overwrite a retired session sharing its key. Require the stored source
to match the submitted source and prove the original row remains unchanged in
SQLite. Retiring ingestion must not make historical data mutable through another
source or dependent on a successful multi-file reset.

## 2026-10-09 — Exercise reset and installed-hook upgrades end to end

The Antigravity reset tests initially checked unchanged input, missing the loss
of old bucket keys required to clear remote snapshots after model/time moves or
step deletion. Preserve that baseline through reset and verify actual upload
bodies against a synthetic remote store. A directory-name heuristic also deleted
active Copilot cursors under custom retired-looking paths, causing repeated SUM;
configured active roots now take precedence with native path-boundary checks.

Retiring generated hook templates did not update already installed dispatchers
or remove their upstream references during explicit uninstall. Repair only exact
Pew-owned dispatcher versions and consume the already admitted active sync window;
remove exact owned retired hooks on uninstall and retain the dispatcher on
ownership conflicts. Test old installed artifacts, not only new templates.
Session reset retains the existing byte-offset protocol rather than saving dirty
keys that its upload engine does not consume; failure leaves a safe replay offset.

## 2026-10-09 — Wait for hydrated UI before tooltip assertions

Release verification found CI hover tests interacting with server-rendered
information buttons before their client data and handlers were ready. Reuse the
existing API readiness watcher before interaction, retain hover/focus assertions,
and verify the populated pricing table. An intermittent local API 404 did not
reproduce in a serial isolated run; retain bounded failure-response diagnostics
rather than weakening its required 403 or claiming an unproven cause.

## 2026-10-09 — Make owned E2E output cleanup idempotent

The v3.3.0 CI browser suite passed all 93 cases, then failed because the owned
Next output disappeared between an existence check and recursive removal.
Remove that check and use native force removal for this known local output only.
Regression tests run the actual runner cleanup with missing output and preserve
permission errors. Published tags remain immutable; this harness-only correction
does not replace the already tested CLI artifact.
## 2026-10-21: Internal links must use the router

Dashboard actions and public privacy links used plain anchors, replacing the document and discarding shared layout state. Use Next Link while preserving external and new-tab links. Navigation regressions now retain shell node references and check collapsed state and Document requests rather than only checking the destination URL. The first test used an assumed "Agents" heading; checking the actual "By Agent" title corrected the assertion before recording the failing navigation behavior.

## 2026-10-21: Focused harness tests still require isolation

During the Cloudflare dependency upgrade, a focused Vitest run included the E2E process-isolation tests in the development checkout. Three cases failed because their child runners correctly rejected the existing `.env.local`; no remote fixtures ran. Rerun these checks in a temporary clone without environment files. Inspect subprocess entry points before treating a focused unit-test command as independent of the E2E isolation contract.

The Basalt navigation baseline also exposed two orchestration mistakes: externally symlinked dependencies are suitable for the staged static/unit gate but fall outside Turbopack's hermetic root, and running browser E2E alongside pre-commit competes for port 27020 with the harness tests. Install frozen dependencies inside the E2E clone and finish the unit gate before starting API/browser lanes; preserve port-conflict rejection rather than terminating another runner.

## 2026-10-21: Check intermediate breakpoints during UI upgrades

Basalt 3.2.0 added responsive SheetContent padding. Pew's unprefixed `p-0` did not override it between 640px and the application's 768px desktop breakpoint, leaving a 260px sidebar inside a padded 260px drawer. Independent review identified the mismatch, and a 700px browser regression confirmed 24px padding before the fix. Explicitly clear the responsive padding and verify drawer bounds, footer visibility, Escape focus restoration and close-on-navigation.

The full browser suite also caught a tooltip handoff race: the previous tooltip remains mounted during its exit animation while the next one opens. Assert that the previous tooltip leaves the DOM before using an unscoped tooltip locator; keep the content assertions and avoid arbitrary sleeps or longer timeouts.

## 2026-10-21: Verify the resolved peer after changing an override

Changing the Vite override and running `bun install` updated lockfile metadata but retained the old 7.3.5 peer with a warning. A targeted `bun update vite@8.3.4` resolved the new dependency graph; Bun rejects combining that explicit version with `--dev`. Verify both the locked version and the version resolved from Vitest's dependency context, since the isolated linker does not expose every peer at the repository root. A successful install alone is not evidence that the requested upgrade happened.
