# pew

Bun-workspaces monorepo tracking token usage from local AI coding tools. Human overview: [README.md](README.md).

- `packages/core` — shared TypeScript types (`@pew/core`, private, zero runtime deps)
- `packages/cli` — CLI tool (`@nocoo/pew`, published to npm, citty + consola + picocolors)
- `packages/web` — SaaS dashboard (`@pew/web`, private, Next.js 16 + App Router)
- `packages/worker` — Cloudflare Worker for D1 ingest writes (`@pew/worker`, private)
- `packages/worker-read` — Cloudflare Worker for D1 read queries (`@pew/worker-read`, private)

Supported tools: Claude Code, Codex, Gemini CLI, GitHub Copilot CLI, Grok, Hermes, Kosmos, Oh My Pi, OpenCode, OpenClaw, Pi, PM Studio, VS Code Copilot, ZCode.

## Scope and instruction sources

- This file applies throughout the repository.
- `packages/web/AGENTS.md` and `packages/web/CLAUDE.md` are Next.js-generated adapters, not maintained handbooks; do not treat them as competing scopes or recreate root legacy compatibility in them.
- Maintain this file as the only root handbook; do not recreate `CLAUDE.md`, a symlink, an import or a compatibility alias.
- Source of truth: root and `packages/*/package.json`, `vitest.config.ts` and `vitest.e2e-cli.config.ts`, `biome.json`, composite `tsconfig` references, `.husky/`, `scripts/`, `.github/workflows/ci.yml`, and the quality-system docs ([upgrade](docs/30-quality-system-upgrade.md), [D1 isolation](docs/31-d1-test-isolation.md)). Record drift rather than lowering the contract.

## Setup and commands

Run from the repository root with Bun as package manager and runtime.

```sh
bun install --frozen-lockfile
bun run build
bun run dev
bun run typecheck
bun run lint
bun run test
bun run test:coverage
bun run test:e2e
bun run test:e2e:cli
bun run test:e2e:ui
bun run test:security
bun run sync-prices
bun run release
```

`build` builds core types then web; the CLI must be built explicitly with `bun run --filter '@pew/pew' build`-equivalent (`bun run --cwd packages/cli build`) before publishing. `lint` chains typecheck, Biome `--error-on-warnings`, and the two AST gates (`scripts/check-dynamic-delete.ts`, `scripts/check-ts-expect-error.ts`, both on oxc-parser, decoupled from the tsc version). Ports: dev=7020, API E2E=17020, BDD E2E=27020.

## Source scanning principles

Three inviolable rules govern how pew interacts with source data:

1. **Raw data is read-only**: never modify, delete or move original AI-tool log files. Write operations are limited to pew's own state files under `~/.config/pew/`.
2. **Source isolation**: each source is completely independent. Even a buggy parser must never corrupt or affect data from other sources.
3. **Idempotent uploads**: `pew reset && pew sync` is always safe. Duplicate uploads deduplicate via `ON CONFLICT` upserts, never summed; the same raw data always produces the same final state.

## Conventions

- TypeScript strict mode with composite project references across all five packages.
- TDD: write tests first, then implement. Conventional Commits, atomic, one logical change per commit.
- `@pew/core` is not published: pure types, `import type` only, `devDependencies`.
- Tests must not use `.skip`/`.only`; Biome elevates `noSkippedTests`/`noFocusedTests` to errors in the test-file override.

### DateTime strategy

All date/time values follow a strict UTC-in, local-out pattern:

- **Storage (D1 SQLite)**: `created_at`, `updated_at`, `hour_start` use `datetime('now')` (UTC). Season `start_date`/`end_date` are ISO 8601 UTC strings (`YYYY-MM-DDTHH:mm:ssZ`), precision to minute; status is derived at read time via `deriveSeasonStatus()`, never stored.
- **Computation (API routes, Worker, CLI)**: all date arithmetic in UTC (`toISOString()`, `Date.UTC()`, `getUTC*()`); never `setDate()`/`getDate()` server-side — use `setUTCDate()`/`getUTCDate()`.
- **Display (Web UI)**: convert to the user's local timezone before rendering; `tzOffset` pattern for bucketing; `toLocaleString()`/`toLocaleDateString()` on the client.
- **`datetime-local` inputs** show local wallclock time: UTC → local via `utcToLocalDatetimeValue()`, local → UTC via `localDatetimeValueToUtc()` (both in `date-helpers.ts`). Never append `Z` to a `datetime-local` value directly.
- **Ordering/equality**: always epoch ms (`new Date(x).getTime()`), never string comparison — ISO variants have unstable lexicographic order.

## CLI dev workflow and state files

```sh
bun run build
bun run --filter '@pew/web' dev
NODE_TLS_REJECT_UNAUTHORIZED=0 bun packages/cli/dist/bin.js sync --dev
```

A full reset removes `~/.config/pew/cursors.json`, `queue.jsonl` and `queue.state.json` before re-syncing. State files: `config.json` (prod API key `pk_...`), `config.dev.json` (dev API key), `cursors.json` (per-file byte offsets + directory mtimes, shared across dev/prod), `queue.jsonl` (pending upload records), `queue.state.json` (queue metadata).

## Testing and quality contract

Run the checks relevant to the change; hook and CI requirements still apply. Statuses: `enforced`, `planned`, `manual`, `N/A`.

| Dimension | Required contract | Current status and evidence |
| --- | --- | --- |
| L1 — pre-commit quality | UT with all four coverage metrics ≥95%; strict types and check-only lint with zero errors/warnings; installed hooks on the index snapshot; proven rejection; under 30s; no skipped/focused tests. Pure Views may be covered by L3; business logic stays in scope. | planned, with the core subchecks implemented. `.husky/pre-commit` materializes the staged tree with `checkout-index` into a temp snapshot, verifies staged manifests match the installed worktree, dry-run-checks the frozen lockfile, regenerates staged prerequisites (`@pew/core` build, `next typegen`), reuses worktree `node_modules` read-only, and runs `vitest run --coverage`, `scripts/parallel-typecheck.sh` (five packages, strict tsc), Biome `--error-on-warnings` and both AST gates there; every commit runs the full gate with no caches and exit-code rejection. `vitest.config.ts` enforces 95/95/95/95 (v8) with documented by-design exclusions (presentation `.tsx`, `use-*` hooks, CLI command entry points covered by CLI E2E, framework adapters, pure type modules). The <30s budget is unmeasured, so full unified L1 (including the static lanes, former G1) remains planned rather than certified. |
| L2 — integration | Real HTTP against the actual application; complete endpoint/method coverage | planned. `scripts/run-e2e.ts` runs real HTTP E2E against a local dev server on `127.0.0.1:17020`, but `validateAndOverride` points `CF_D1_DATABASE_ID`, `WORKER_INGEST_URL` and `WORKER_READ_URL` at the remote `pew-db-test`/test-Worker resources, and no exhaustive endpoint/method inventory is certified. Because the configured backing store is remote, the lane conflicts with the local-only test-resource policy and must not be executed for documentation-only changes. |
| L3 — system | Critical user journeys on isolated resources | planned. `scripts/run-e2e-ui.ts` runs Playwright BDD on `:27020` (pre-push plus the CI browser job) with read-only specs, but it shares the same remote `-test` D1/Worker backing as L2, so its target proof is planned and the lane is out of scope for documentation-only changes. |
| G2 — security | Dependency and secret scans; missing required scanner fails | enforced. `scripts/run-security.ts` is the single entry point (osv-scanner + gitleaks) and runs in pre-push; CI quality uses the tracked `osv-scanner.toml`. |
| D1 — test isolation | Test state physically separate from production and daily development; guards before destructive fixture operations | planned, with a disclosed conflict. E2E lanes use the remote `pew-db-test` database via remote `pew-ingest-test`/`pew-test` Workers, gated by `scripts/d1-test-guard.ts` (env vars set, DB ID ≠ prod, Worker URLs ≠ prod, `_test_marker` verified via the D1 REST API). This remote `-test` arrangement predates and conflicts with the 2026-09-12 local-only test-resource policy: do not run these lanes for documentation changes and do not deploy new remote test resources. Safe local target: `bun run test` (unit Vitest with mocked D1). No local Miniflare replacement is implemented yet. |

Current hooks: pre-commit runs the full local index-snapshot L1 gate; pre-push runs L2 E2E, L3 BDD and G2 in parallel and fails fast when `packages/web/.env.local` and `.env.test` are missing. The pre-push L2/L3 lanes call `scripts/d1-test-guard.ts`, which verifies the four-layer remote-test isolation and then targets the remote `pew-db-test`, `pew-ingest-test` and `pew-test` resources over the network: executing that hook is remote E2E and is not authorized for documentation-only changes — stop before the hook and report blocked rather than bypassing it. `git push tag` does not trigger pre-push hooks, so no `--no-verify` is needed for tags. CI mirrors quality, L2 and L3 with repository secrets. Target: unified L1 under 30s on the index snapshot; pre-push L2/G2 under three minutes on stdin pushed refs — the ref-reading part is not implemented and L2/L3 need a local Miniflare backing to meet the isolation contract.

The owner merged former G1 into L1 on 2026-09-21; the framework keeps the 6DQ name. Use `system0-6dq-l1` for the L1 contract and its S/A/B/F rubric.

## Operations and release

npm publication of `@nocoo/pew` follows the full procedure; it is an authorized operation, not a per-edit step:

1. `bun run release` (or `-- minor|major|x.y.z`): bumps versions across files, syncs the lockfile, generates the changelog, verifies no stale versions, commits. Push/tag/GitHub-release are interactive; pre-push runs the L2/L3/G2 gates and needs `packages/web/.env.local`, `.env.test` and a `CF_D1_API_TOKEN` with access to both `pew-db` and `pew-db-test`.
2. Build both: `bun install && bun run build && bun run --cwd packages/cli build` — root `build` builds core + web only.
3. `bun run test`.
4. Verify the dist version (`packages/cli/package.json` is authoritative; the CLI reads its version at runtime via `readVersion()`).
5. `cd packages/cli && npm publish --dry-run`.
6. `npm publish` (OTP via `--otp=<code>` or browser auth when prompted).
7. Verify with `npx @nocoo/pew@latest --help`.
8. Watch CI: after push, check `gh run list --limit 5` within a few minutes; local pre-push does not catch every failure mode (workspace links, deploy pipeline).

Web deploys go through `git push` (Railway auto-deploy); never `railway up`, which bypasses the git-based gates. Any Worker code or schema change requires `wrangler deploy` plus a real verification request before the feature counts as complete. See [Retrospective.md](Retrospective.md) for the shipped-bug narratives behind these rules.

## Ponytail audit

For `ponytail-audit`, read `.agents/skills/ponytail-audit/SKILL.md`. Its pew-specific scope extends the global complexity audit to parser → cursor → spool → upload → Worker UPSERT → API/UI correctness, privacy, timestamps and compatibility. Run `sh scripts/ponytail-audit.sh` for deterministic JSON on stdout; the audit must not write reports or touch real logs, state, queues or services. Full tests and independent reviews stay separate from this read-only audit.

## Retrospective

Accident narratives live in [Retrospective.md](Retrospective.md). Keep only concise recurring project rules here; cross-project lessons go to global rules/nmem, deterministic checks to hooks/tests.
