# 49 · Time, CLI State, Quality Gates and Release Contracts

See the root [AGENTS.md](../AGENTS.md) for the engineering entrypoint and quality contract. Historical document 31 describes legacy remote test resources; it does not authorize creating or deploying remote `-test` resources (see [local E2E isolation](32-local-e2e-isolation.md)).

## Time semantics

All date/time values follow a strict UTC-in, local-out pattern:

- **Storage (D1 SQLite)**: All `created_at`, `updated_at`, `hour_start` use `datetime('now')` which returns UTC. Season `start_date`/`end_date` are ISO 8601 UTC strings (`YYYY-MM-DDTHH:mm:ssZ`).
- **Computation (API routes, Worker, CLI)**: All date arithmetic uses UTC (`toISOString()`, `Date.UTC()`, `getUTC*()` methods). Never use `setDate()`/`getDate()` for server-side date math — always use `setUTCDate()`/`getUTCDate()`.
- **Display (Web UI)**: Convert to user's local timezone before rendering. Use the `tzOffset` pattern (`new Date().getTimezoneOffset()`) for data bucketing. For timestamps use `toLocaleString()`/`toLocaleDateString()` on the client.
- **Form input (`datetime-local`)**: The input shows local wallclock time. On load, convert UTC → local via `utcToLocalDatetimeValue()`. On submit, convert local → UTC via `localDatetimeValueToUtc()`. Both helpers live in `date-helpers.ts`. Never append `Z` to a `datetime-local` value directly — that treats local time as UTC.
- **Season dates**: Stored as ISO 8601 UTC datetime (e.g. `2026-03-15T00:00:00Z`), **precision to minute**. Status is derived at read time via `deriveSeasonStatus()`, never stored.
- **Date comparison**: Always use epoch ms (`new Date(x).getTime()`) for ordering/equality checks. Never use string comparison — ISO formats with/without seconds or milliseconds have unstable lexicographic order.

## CLI dev workflow, state files and source data

- Original AI logs/SQLite are read-only. Sources remain independent; `ON CONFLICT` uploads replace identical snapshots idempotently, never sum duplicates.
- CLI `sync`, `init`, and `reset` are state-changing operations, not documentation checks. Use synthetic sources and temporary directories for CLI tests (`bun run test:e2e:cli`).
- Local CLI dev sync against local Web (`:7020`):

  ```sh
  bun run build
  bun run --cwd packages/cli build
  bun run --filter '@pew/web' dev
  NODE_TLS_REJECT_UNAUTHORIZED=0 bun packages/cli/dist/bin.js sync --dev
  ```

- CLI state lives under `~/.config/pew/`:
  - `config.json` — production API key (`pk_...`)
  - `config.dev.json` — development API key
  - `cursors.json` — per-file byte offsets + directory mtimes, shared across dev/prod
  - `queue.jsonl` — pending upload records
  - `queue.state.json` — queue metadata
- Full reset validates retained queues and upload state, invalidates token/session cursors, then rebuilds active-source queues. Retired token/session records and their pending upload intent remain in Pew's queues because their collectors no longer replay them; Antigravity snapshot baselines remain so corrected or removed keys can upload tombstones; accounting history stays readable and counts toward rankings. Retired sessions retain the existing acknowledged-prefix byte offset, not unused dirty keys. Exact retired uploads are acknowledged and ignored, never stored, while mixed batches still accept active records.
- `sync --no-upload` still updates the local queue. `init`/`uninstall` modify selected tool configuration and must stay within the requested scope.
- Root `bun run build` covers `@pew/core` and `@pew/web` only. Build the CLI explicitly before publication (`bun run --cwd packages/cli build` or `bun run --filter '@nocoo/pew' build`).
- `@pew/core` is private, type-only, a `devDependencies` entry, imported with `import type`, and never published.
- Source identities, default paths, and parser constraints live in `packages/cli/src/utils/paths.ts` and source docs. Never use real conversation bodies to construct fixtures.

## Local L1 gate self-test and verification details

- **Pre-commit chain (`sh .husky/pre-commit`)**: checks out the staged Git index into a temporary snapshot, verifies staged manifests/lockfile match worktree and `bun install --frozen-lockfile --dry-run --ignore-scripts`, reuses `node_modules` read-only via `scripts/snapshot-node-modules.sh`, builds `@pew/core`, runs `bun x next typegen`, then executes sequentially:
  1. `bun x vitest run --coverage` (95/95/95/95 v8 floors in `vitest.config.ts`) + `coverage/index.html` and `coverage/coverage-summary.json` presence guard
  2. `bash scripts/parallel-typecheck.sh` (5 packages + `tsconfig.e2e.json`)
  3. `biome check --no-errors-on-unmatched --error-on-warnings --max-diagnostics=500 .`
  4. AST gates (`scripts/check-dynamic-delete.ts`, `scripts/check-ts-expect-error.ts`, both on `oxc-parser`, decoupled from the `tsc` version)
- **Negative-probe self-test (`bun run test:l1-gate`)**: runs in a detached worktree with read-only `node_modules` reuse and exercises: healthy pass, UT failure, each coverage floor below threshold (statements/branches/functions/lines), lint error, lint warning-only, type error, `.only`, `.skip`, staged bad vs unstaged good, UT failure must not reach Biome, missing `bun`, missing coverage output, and timeout/interrupt.
- **Cold/warm timing (`bun run test:l1-gate -- --measure`)**: runs optional cold (after deleting `node_modules/.cache/vitest` and `node_modules/.cache/xdg`) and warm timings on the invoking worktree. Full cold-path timing exceeds the 30s governance target while `@pew/core` build and `next typegen` stay in-hook; treat as an execution hardening item, never a skipped check.
- **Browser readiness & API E2E**: API E2E (`bun run test:e2e`, `:17020`) tests real HTTP against local Next + per-run local D1/KV and source Workers (exhaustive endpoint/method inventory is not certified). Playwright E2E (`bun run test:e2e:ui`, `:27020`) verifies page readiness across all 29 pages against populated real-API/module checks or explicit redirects; L1 rejects missing page inventory entries and typechecks browser tests (`tsconfig.e2e.json`). Keep intentional visual/failure mocks separate from real-data readiness checks.

## Release and deployment

### Versioning & scoped releases

- Root `package.json` is the project/Web release version; keep `packages/web/package.json` aligned with it. CLI, core, and Workers are independently versioned and do not change for a Web-only release.
- Prepare scoped releases manually with the matching manifests, lockfile, `CHANGELOG.md`, normal Git hooks, exact tag, and GitHub Release. Never move tags.
- `bun run release` (`scripts/release.ts`, patch by default; accepts minor/major/version) is a coordinated-release script: it synchronizes every package and Worker constant, commits, pushes, and publishes without an interactive confirmation. Never use it for independent Web or CLI releases.

### npm publication (`@nocoo/pew`)

Authorized operation only — never a per-edit step; a Web-only release does not authorize an npm publication:

1. Prepare the explicitly authorized CLI version in `packages/cli/package.json`, sync `bun.lock`, update `CHANGELOG.md`, and commit. Pre-push runs isolated local L2/L4/security gates without cloud credentials.
2. Build both core/Web and CLI: `bun install --frozen-lockfile && bun run build && bun run --cwd packages/cli build` (root `build` excludes CLI).
3. Run `bun run test`.
4. Verify the built dist version (`packages/cli/package.json` is authoritative; the CLI reads its version at runtime via `readVersion()`).
5. Run `cd packages/cli && npm publish --dry-run`.
6. Run `npm publish` (provide OTP via `--otp=<code>` or complete browser auth when prompted).
7. Verify with `npx @nocoo/pew@latest --help`.
8. Monitor CI after push (`gh run list --limit 5` within a few minutes); local pre-push does not catch every CI or deploy failure mode.

### Web Docker CD (jp2) and Railway recovery

- Successful `main` push CI (`quality / Z1: Gate`) triggers `.github/workflows/release.yml` (pinned Docker CD), publishing `ghcr.io/nocoo/pew` and deploying one immutable-digest container (`pew-app`) to `/opt/pew` on jp2.
- All Git hooks remain enabled; never use `railway up` or manual image rebuilds to bypass the proven-source CI/CD chain. Preserve pinned Bun (`1.4.0`), pinned Node (`26.13.1`), standalone `public`/`.next/static` assets, and `scripts/fix-standalone-swc-helpers.ts`.
- Public `pew.md` runs on jp2 with Full (strict) TLS, shared AOP, and `DEPLOY_PHASE=production` (temporary internal listener removed). Shared Caddy uses validated `SIGUSR1` hot reload, never a proxy restart.
- Railway's runtime is stopped and its `main` trigger is removed, while its project, service, variables, and old deployment record remain for recovery — do not delete those resources.
- An authorized Railway recovery must reuse the recorded old image in [docs/52-jp2-migration.md](52-jp2-migration.md), verify its running instance, digest, and health before routing back, and restore `DEPLOY_PHASE=precutover` before later releases. An image-only rollback on jp2 retains `DEPLOY_PHASE=production`.
- Check CI and jp2 Docker CD verification for the exact pushed commit.

### Cloudflare Workers

- Deploy `packages/worker` (ingest) and `packages/worker-read` (read RPC) separately via `wrangler deploy`.
- Apply dependent D1 migrations first, then deploy the corresponding Worker and verify with a real request. A Web deployment never updates Workers.

## Specialized audit

Use `.agents/skills/ponytail-audit/SKILL.md` and `sh scripts/ponytail-audit.sh` for Pew's read-only audit. Inspect parser → cursor → spool → upload → Worker UPSERT → API/UI correctness, privacy, timestamps, and compatibility. Output deterministic JSON only to stdout; do not write reports or touch real logs, state, queues, or services. Full tests and independent reviews stay separate from this read-only audit.
