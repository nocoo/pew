# 49 · Time, CLI State and Release Contracts

See the root [AGENTS.md](../AGENTS.md) for the engineering entrypoint and local 6DQ target. Document 31 and legacy test runners describe remote test resources; they do not authorize creating or deploying remote `-test` resources.

## Time semantics

All date/time valuesfollow a strict UTC-in, local-out pattern:

- **Storage (D1 SQLite)**: All `created_at`, `updated_at`, `hour_start` use `datetime('now')` which returns UTC. Season `start_date`/`end_date` are ISO 8601 UTC strings (`YYYY-MM-DDTHH:mm:ssZ`).
- **Computation (API routes, Worker, CLI)**: All date arithmetic uses UTC (`toISOString()`, `Date.UTC()`, `getUTC*()` methods). Never use `setDate()`/`getDate()` for server-side date math — always use `setUTCDate()`/`getUTCDate()`.
- **Display (Web UI)**: Convert to user's local timezone before rendering. Use the `tzOffset` pattern (`new Date().getTimezoneOffset()`) for data bucketing. For timestamps use `toLocaleString()`/`toLocaleDateString()` on the client.
- **Form input (`datetime-local`)**: The input shows local wallclock time. On load, convert UTC → local via `utcToLocalDatetimeValue()`. On submit, convert local → UTC via `localDatetimeValueToUtc()`. Both helpers live in `date-helpers.ts`. Never append `Z` to a `datetime-local` value directly — that treats local time as UTC.
- **Season dates**: Stored as ISO 8601 UTC datetime (e.g. `2026-03-15T00:00:00Z`), **precision to minute**. Status derived at read time via `deriveSeasonStatus()`, never stored.
- **Date comparison**: Always use epoch ms (`new Date(x).getTime()`) for ordering/equality checks. Never use string comparison — ISO formats with/without seconds or milliseconds have unstable lexicographic order.

## CLI state and source data

- Original AI logs/SQLite are read-only. Sources remain independent; `ON CONFLICT` uploads replace identical snapshots idempotently, never sum duplicates.
- CLI state lives under `~/.config/pew/`: `config.json` (production credentials), `config.dev.json` (development credentials), `cursors.json` (shared cursors), `queue.jsonl` and `queue.state.json`. Tests use temporary directories and synthetic data, never this real state.
- `sync --no-upload` still updates the local queue. `init`/`uninstall` modify selected tool configuration and must be within the requested scope.
- Root build covers core and Web only. Build the CLI explicitly before publication: `bun run --filter '@nocoo/pew' build`.
- `@pew/core` is private, type-only, a devDependency, imported with `import type` and never published.
- Source identities, default paths and parser constraints live in `packages/cli/src/utils/paths.ts` and source documentation. Do not use real conversation bodies to construct fixtures.

## Release

- Authorized release entrypoint: `bun run release` (patch by default; accepts minor/major/version). Synchronize versions and lockfile, generate CHANGELOG and check stale versions. Never move tags.
- Publish only `packages/cli` as `@nocoo/pew`. Build, test, verify package/dist versions and run `npm publish --dry-run` in the CLI directory before authorized publication and OTP verification.
- Git/CI drives Railway deployment; never use `railway up`. Preserve pinned Bun, standalone public/static assets and the complete `@swc/helpers` packaging fix.
- Deploy ingest/read Workers separately. Apply dependent migrations first, then deploy the corresponding Worker and verify its runtime version and behavior. A Web deployment does not update Workers.
- Check CI for the exact pushed commit. The existing pre-push hook requires remote E2E resources; the local replacement remains planned. Never bypass the hook to publish.

## Specialized audit

Use `.agents/skills/ponytail-audit/SKILL.md` and `sh scripts/ponytail-audit.sh` for Pew's audit. Inspect parser → cursor → spool → upload → UPSERT → API/UI correctness, privacy, time and compatibility. Output only to stdout; do not write reports or touch real logs, state, queues or services. Full tests and independent reviews are separate checks.
