# Changelog

## v2.2.1

### Added
- Add hourly usage chart split by weekday/weekend

## v2.2.0

### Added
- Add salary trend chart to Salary Estimator
- Add Salary Estimator card to dashboard Insights
- Migrate to cli-base 0.2.0 with mandatory CSRF

### Changed
- Sync all package versions to 2.0.5
- Use readVersion for dynamic version assertion

### Fixed
- Correct salary trend upper/lower bound calculation
- Salary estimator use primary theme color, prevent layout shift
- Read version from package.json via cli-base readVersion

### Removed
- Remove CLI version targets from release script

## v2.1.0

### Added
- Add salary trend chart to Salary Estimator
- Add Salary Estimator card to dashboard Insights
- Migrate to cli-base 0.2.0 with mandatory CSRF

### Changed
- Sync all package versions to 2.0.5
- Use readVersion for dynamic version assertion

### Fixed
- Correct salary trend upper/lower bound calculation
- Salary estimator use primary theme color, prevent layout shift
- Read version from package.json via cli-base readVersion

### Removed
- Remove CLI version targets from release script

## v2.0.2

### Changed
- Add unit tests for admin, auth, and teams endpoints
- Add from/to date filter test to reach 90% branch coverage
- Migrate to @nocoo/cli-base for shared dependencies

### Fixed
- Add .next-e2e-ui to eslint ignores

## v2.0.1

### Changed
- Add unit tests for admin, auth, and teams endpoints
- Add from/to date filter test to reach 90% branch coverage
- Migrate to @nocoo/cli-base for shared dependencies

### Fixed
- Add .next-e2e-ui to eslint ignores

## v2.0.0

### Added
- Add achievements section to public profile page
- Integrate UserProfileDialog for member clicks
- Add expandable card with member leaderboard
- Raise thresholds for heavy users (1B+/week baseline)
- Expand earnedBy to cover big-day, chatterbox, cache-master
- Integrate server-side achievements into dashboard
- Add Achievements page with category grid UI
- Add GET /api/achievements/[id]/members route
- Add GET /api/achievements route with tests
- Expand achievement definitions to 25 with new fields
- Add accent bar to all 4 core metric cards
- Integrate achievements into HeatmapHero sidebar
- Add StatCard variant prop for visual hierarchy
- Add EmptyState component for onboarding guidance
- Add HeatmapHero as dashboard primary visual

### Changed
- Widen layout from max-w-4xl to max-w-6xl
- Mark Achievement System Overhaul Phase 1-4 as completed
- Unify day-based achievements to UTC, document members 404
- Clarify tzOffset affects all day-based achievements
- Document tzOffset param and fix Phase 2 social exclusion
- Fix Decision 4 conclusion to include weekend-warrior
- Include weekend-warrior in timezone-dependent achievements
- Add Decision 5 for time-of-day achievement social limitations
- Fix inconsistencies in achievement system overhaul
- Add Data Model Decisions to achievement system overhaul
- Add achievement system overhaul plan (doc/33)
- Replace DM Sans with Space Grotesk for display font
- Replace teal/cyan palette with electric violet + acid lime
- Add osv-scanner config to ignore false positive

### Fixed
- Exclude test files from stale version check
- Resolve syntax and type errors
- Address spending source + earnedAt precision issues
- Address 5 review issues
- Remove orphaned computeCurrentMonthTokens tests
- Change achievements to 2-column grid, max 6 items
- Change Hero layout from fixed width to 6:4 ratio
- Improve Hero layout and move period selector
- Boost light mode color contrast for accessibility
- Align dark mode input background with B-5 spec

### Removed
- Remove unused AchievementShelf component
- Remove monthly budget feature

## v1.15.1

### Added
- Add same-period month comparison to dashboard stat cards (#23)

### Fixed
- Use cost field for cost growth comparison condition

## v1.15.0

### Added
- Improve profile page layout and leaderboard UX
- Add invite code toggle, improve profile pages and leaderboard
- Default is_public to ON and hide 0-token users from leaderboard

### Changed
- Update leaderboard slogan
- Align Dockerfile port to 7020
- Migrate dev port 7030 → 7020

## v1.14.11

### Fixed
- Remove card layer anti-patterns and add aria-sort to sortable headers

## v1.14.10

### Fixed
- Remove card layer anti-patterns and add aria-sort to sortable headers

## v1.14.9

### Fixed
- Override brace-expansion to fix GHSA-f886-m6hf-6m8v
- Align web package version with monorepo root (1.14.7)
- Harden callbackUrl validation and fix logo upscale blur
- Remove ghost logo assets per basalt B-3 spec
- Align dashboard framework with basalt B-2 spec
- Validate callbackUrl to prevent open redirect

## v1.14.8

### Fixed
- Override brace-expansion to fix GHSA-f886-m6hf-6m8v
- Align web package version with monorepo root (1.14.7)
- Harden callbackUrl validation and fix logo upscale blur
- Remove ghost logo assets per basalt B-3 spec
- Align dashboard framework with basalt B-2 spec
- Validate callbackUrl to prevent open redirect

## v1.14.7

### Added
- Add automated release script replacing bump-version.ts
- Show earliest data date in admin profile dialog
- Enlarge profile dialog and stabilize tab transitions
- Bypass is_public for admin/teammate/season peers
- Add user profile popup dialog with charts

### Changed
- Add dev server run command to superset config
- Sanitize real paths and domains in test fixtures
- Add doc 32 proxy token gap investigation
- Sanitize real IDs, paths, and domains with placeholders
- Re-enable no-non-null-assertion ESLint rule and fix all violations
- Rewrite README following personal project specification
- Update publish procedure for new release script
- Make G2 security gate hard-fail when tools missing
- Add lint-staged for incremental eslint on pre-commit
- Unify profile dialog tab system across all entry points
- Add bump-version script for batch version updates

### Fixed
- Resolve picomatch and yaml vulnerabilities via overrides
- Allow profile dialog for users without slug

## v1.14.6

### Added
- Add automated release script replacing bump-version.ts
- Show earliest data date in admin profile dialog
- Enlarge profile dialog and stabilize tab transitions
- Bypass is_public for admin/teammate/season peers
- Add user profile popup dialog with charts

### Changed
- Add dev server run command to superset config
- Sanitize real paths and domains in test fixtures
- Add doc 32 proxy token gap investigation
- Sanitize real IDs, paths, and domains with placeholders
- Re-enable no-non-null-assertion ESLint rule and fix all violations
- Rewrite README following personal project specification
- Update publish procedure for new release script
- Make G2 security gate hard-fail when tools missing
- Add lint-staged for incremental eslint on pre-commit
- Unify profile dialog tab system across all entry points
- Add bump-version script for batch version updates

### Fixed
- Resolve picomatch and yaml vulnerabilities via overrides
- Allow profile dialog for users without slug

## v1.14.5

### Quality

- **D1 test isolation (Dimension D1)** — Created dedicated test Cloudflare resources (pew-db-test D1 database, pew-ingest-test and pew-test Workers) with a four-layer guard (existence, DB non-equality, Worker URL non-equality, `_test_marker` table). E2E runners automatically validate isolation before starting, preventing accidental writes to production D1. Completes the six-dimension quality system (L1+L2+L3+G1+G2+D1 = Tier S).

### UI

- **Landing page redesign** — Rewritten landing page to clarify that `pew init` installs auto-sync hooks. Added usage examples for `sync`, `reset`, and `update` commands. Fresher, more concise copy.
- **Loading skeleton alignment** — Fixed skeleton loading states on 5 pages (Models, Devices, Projects, Sessions, Profile) that no longer matched their actual rendered layouts. Each skeleton now mirrors the real grid structure (stat cards, chart grids, tables) to eliminate layout shift.

## v1.14.4

### UI

- **Team button consistency** — Unified all team management buttons to icon+text format. Replaced the `Trash2` (trash can) icon on the member "leave team" button with `LogOut` — leaving a team is a departure, not a deletion. Added text labels to previously icon-only buttons (Leave/Delete/Remove/Details) and icons to previously text-only buttons (form Create/Join, season Register/Withdraw).

## v1.14.3

### UI

- **Heatmap empty cell visibility** — Added a subtle border outline to zero-value and future-date cells in the Activity heatmap calendar. Previously these cells blended into the background in both light and dark themes.

### CLI

- **Aligned CLI output** — Replaced consola with a custom logger that uses a consistent 2-character icon column (icon + space). All message text now starts at the same column. Removed right-aligned timestamps that added visual noise. Dropped `consola` dependency.

## v1.14.2

### Quality System Upgrade

- **Upgrade to new quality system** — Migrated from legacy "four-layer test architecture" (L1 UT / L2 Lint / L3 API E2E / L4 BDD) to "quality system" (L1 Unit / L2 Integration / L3 System / G1 Static Analysis / G2 Security). See [docs/30-quality-system-upgrade.md](docs/30-quality-system-upgrade.md).
- **G1 ESLint strict enforcement** — Added `--max-warnings=0` to lint script. Added `no-restricted-syntax` rule banning `.skip` and `.only` in test files.
- **G2 security gate** — New `scripts/run-security.ts` runs osv-scanner (dependency CVE scan) + gitleaks (secret leak scan) on pre-push. Dynamic upstream branch detection via `@{u}`.
- **L3 Playwright E2E** — Installed `@playwright/test`, created `packages/web/e2e/playwright.config.ts`, and added 10 specs across 4 files (smoke, auth bypass, dashboard, navigation).
- **Shared `loadEnvLocal`** — Extracted from `run-e2e.ts` to `e2e-utils.ts`; both API and UI runners now load `.env.local` for D1 credentials.

### Fixes

- **15 dependency CVEs resolved** — Direct upgrades: next 16.1.6→16.2.1, undici 7.18.2→7.24.5. Transitive overrides: cookie 0.6.0→1.1.1, flatted 3.4.1→3.4.2, fast-xml-parser 5.4.1→5.5.8.

## v1.14.1

### Fixes

- **Season date range query format mismatch** — Leaderboard and snapshot queries used space-separated date format (`2026-03-21 16:00:00`) to compare against `hour_start` values stored as ISO 8601 (`2026-03-21T16:00:00.000Z`). SQLite lexicographic comparison treats `T` (ASCII 84) > ` ` (ASCII 32), causing all records on the boundary date to match regardless of time. This leaked entire days of pre-season data into rankings — S01 frozen snapshot had wrong totals and swapped 2nd/3rd place.
- **Admin breadcrumb 404** — The `admin` segment in breadcrumbs was lowercase and clickable, leading to a 404 page. Now displays as "Admin" (capitalized) and is non-clickable. Also added proper labels for all admin sub-pages (Token Pricing, Invite Codes, Seasons, Storage).

### UI

- **Season status column redesign** — Replaced cryptic `+reg`/`+roster`/`+wd` tags with polished UI: pulsing green dot for active seasons, clock icon for upcoming, check-circle for ended. Rules shown as bordered pills with descriptive icons. Active seasons show a progress bar with elapsed percentage and days remaining.

### Refactoring

- **Shared test utilities** — Extracted `createMockClient`, `createMockDbRead`, `createMockDbWrite`, and shared request builders into `test-utils.ts`. Migrated 41 test files to use shared mock factories, eliminating ~800 lines of duplicated mock setup.
- **Pre-commit lint** — Moved ESLint from pre-push to pre-commit hook for faster feedback. Resolved 2 lint warnings for zero-warning policy. Removed dead lint-staged config.

## v1.14.0

### Refactoring

- **Remove D1 REST API read fallback** — Worker is now the sole read path. Removed the `WORKER_READ_URL` feature flag branch from `getDbRead()`, deleted `createRestDbRead()` from `db-rest.ts`, and migrated 4 test files from transitive `@/lib/d1` mock to direct `@/lib/db` mock. Net removal of ~115 lines of dead code.
- **Unify worker health check routes** — Ingest worker health check changed from `/health` to `/api/live` for consistency with read worker.
- **Ingest worker custom domain** — Added `pew-ingest.worker.hexly.ai` custom domain to ingest worker.

## v1.13.0

### Features

- **Worker Read Migration** — Migrated all D1 database reads from the Cloudflare REST API (`api.cloudflare.com`) to a dedicated `pew` Worker with native D1 bindings. Reduces read latency from ~50-150ms to ~15-30ms per query, eliminates REST API rate limit risk, and achieves a uniform Worker-based data layer.
- **DbRead/DbWrite abstraction** — Extracted `DbRead` and `DbWrite` interfaces from the monolithic `D1Client`, enabling the read path to be swapped between REST API and Worker adapter via a single environment variable (`WORKER_READ_URL`).
- **WorkerDbRead adapter** — HTTP adapter that sends read queries to the `pew` Worker. Auto-switches based on `WORKER_READ_URL` env var; absent → REST fallback (zero-downtime rollback).
- **pew read Worker** — Cloudflare Worker (`packages/worker-read`) with native D1 binding, shared secret auth, SQL write-statement guard, and health check at `/api/live`. Custom domain: `pew.worker.hexly.ai`.

### Fixes

- **Typecheck for worker-read** — Fixed `CfProperties` vs `IncomingRequestCfProperties` type mismatch in worker tests; added `worker-read` to root `lint` and `lint:typecheck` scripts.
- **Health check "ok" sanitization** — Read worker `/api/live` now strips "ok" from error messages (`.replace(/\bok\b/gi, "***")`), aligning with the existing monitoring convention.

### Refactoring

- **37 production files migrated** — All `getD1Client()` call sites replaced with `getDbRead()` / `getDbWrite()` pattern.
- **25+ test files migrated** — All `vi.mock("@/lib/d1")` replaced with `vi.mock("@/lib/db")` using `mockResolvedValue` for async singleton.
- **Worker routes standardized** — Changed `/live` → `/api/live` and `/query` → `/api/query` for consistency.

### UI

- **Season countdown** — Show countdown for active/upcoming seasons, static dates for ended.
- **Shared SiteFooter** — Extracted common footer with GitHub link, fixed dead URLs.
- **Header polish** — Reduced header title size, increased spacing, unified pill styles.

### Docs

- **Doc 29: Worker read migration plan** — Full migration design with 4 phases, route contracts, test matrix, security analysis, and architecture diagrams.

## v1.12.1

### Features

- **Admin snapshot alert dialog** — Dashboard now shows a dismissible dialog to admin users when ended seasons haven't been snapshotted. Prevents forgotten snapshots from leaving leaderboard results in live aggregation mode indefinitely. Self-contained component with conditional data fetching (no API calls for non-admin users).

## v1.12.0

### Features

- **O_EXCL lockfile for notify coordination (Phase 1)** — Replaced the non-functional `FileHandle.lock()` with a portable `O_EXCL` lockfile (`sync.lock`) with PID-based stale detection. 100% of `pew notify` runs now achieve mutual exclusion instead of silently degrading to `runUnlocked()`. Fail-closed: if the lock cannot be acquired, sync is skipped — never runs unlocked.
- **5-minute cooldown for notify (Phase 3)** — After a successful sync, subsequent `pew notify` calls within 5 minutes are skipped (returning in ~5ms). Reduces ~130 redundant sync cycles per 4-hour window to ~48 sequential runs. Configurable via `CoordinatorOptions.cooldownMs`.
- **Trailing-edge sync guarantee** — When cooldown fires, a single background process sleeps until cooldown expires and runs a final sync to ensure no data is lost if no further hooks arrive. Uses a separate `trailing.lock` with PID-based stale detection to ensure only one trailer sleeps at a time.
- **`cooldownRemainingMs` in coordinator result** — `CoordinatorRunResult` and `RunLogEntry.coordination` now include `skippedReason` and `cooldownRemainingMs` for observability.

### Fixes

- **Cooldown reads `last-success.json` instead of `last-run.json`** — The original design used `last-run.json` which is written on every run (including cooldown-skipped runs). A skipped run would overwrite the success timestamp, causing subsequent runs to bypass cooldown. Now uses a dedicated `last-success.json` written only on `status === "success"`.
- **Trailing lock PID stale detection** — A crashed trailing sync process no longer permanently blocks future trailing syncs. Dead PIDs are detected via `process.kill(pid, 0)` and stale locks are removed.
- **Node.js engine requirement** — Lowered from >=20 to >=18.0.0 for broader compatibility.
- **Token tier badge digit cap** — Removed artificial cap and rotated colors through 24 hues.
- **Season register/withdraw buttons** — Show buttons for active seasons with late registration flags.

### Docs

- **Doc 28: Notify concurrency dirty-key loss** — Full investigation, root cause analysis, and three-phase fix design. Phase 1 (lock) and Phase 3 (cooldown + trailing-edge) are complete; Phase 2 (idempotent queue) is deferred.

### Tests

- **O_EXCL lockfile** — 17 unit tests covering acquire, release, stale PID detection, and concurrent contention.
- **Coordinator cooldown** — 10 unit tests + 4 integration tests covering skip, expiry, disabled, corrupted state, and `last-success.json` write semantics.
- **Trailing-edge** — 6 tests covering schedule/no-schedule, single-waiter, stale recovery, and live-PID respect.

## v1.11.1

### Features

- **GitHub Copilot CLI support** — Added `copilot-cli` as the 7th supported AI tool with full token sync pipeline: telemetry log parser, multi-file discovery, file driver, CLI status/sync display, and dashboard source enumerations

### Fixes

- **Copilot CLI parser endOffset rewind** — Fixed state machine bug where `lastCompletedOffset` advanced past the telemetry marker line, causing incomplete trailing JSON blocks to be permanently skipped on resume instead of retried
- **CRLF line ending offset drift** — Added `detectEolSize()` to probe the first 4 KB of log files for `\r\n` vs `\n`, replacing the hardcoded `+1` byte assumption that caused cumulative offset drift on Windows-generated logs
- **Phantom session sync keys** — Removed `vscodeCopilot` and `copilotCli` keys from `SessionSyncResult` interface since no session drivers exist for these sources; `sourceKey()` now returns `null` to skip them cleanly
- **Copilot CLI parser stream cleanup** — Added `try/finally` with `rl.close()` and `stream.destroy()` for consistent resource cleanup on parse errors
- **isSource() guard** — Added `copilot-cli` to the `isSource()` type guard so copilot-cli records pass validation
- **Palette fallback** — Removed dead `copilot-vscode` palette key, updated fallback to `chart-8`
- **Peak hours bar overflow** — Fixed mini bar chart overflowing container on right side by removing `w-full` from a container with `ml-6` offset

### Refactor

- **Rename Recent → Hourly Usage** — Renamed the "Recent" page to "Hourly Usage" with updated route path `/hourly-usage`, navigation label, and tests

### Docs

- **7 supported tools** — Updated all references from 6 to 7 supported AI tools across CLAUDE.md, README, and docs
- **Retrospective** — Added copilot-cli parser endOffset rewind lesson to CLAUDE.md

### Tests

- **Copilot CLI L1 coverage** — Added 13 new tests: discovery (4), parser edge cases (model fallback, timestamp fallback, malformed JSON, no-telemetry, bad metrics, CRLF single/resume), and status fixtures (copilot-cli/vscode-copilot classification)

## v1.11.0

### Features

- **Asset-notation tier badges** — Replaced K/M/B token badges with asset-style notation (e.g. A8.3 = 30M–39M tokens). Each digit-count magnitude has a distinct color from the project chart palette, making it easy to compare users at a glance. Badges now appear on season member rows too.
- **Team logo on season leaderboard** — Season leaderboard team rows now display the uploaded team logo. When no logo is available, falls back to a Users icon with a deterministic color hashed from the team name (supports CJK/Unicode).

### Improvements

- **Season leaderboard alignment** — Member rows now use the same column structure as team rows (rank spacer, 8×8 avatar, fixed-width Sessions/Duration/Tokens columns, chevron spacer). Values use consistent font sizes for easy vertical comparison.
- **Table header alignment** — Season table header now uses `gap-3` matching the data rows' flex gap, fixing misaligned Sessions/Duration/Tokens column headers.
- **Hidden profile badge** — Simplified from "icon + hidden" pill to icon-only on the leaderboard, saving horizontal space.

### Visual

- **Heatmap percentile bucketing** — Switched heatmap color assignment from fixed thresholds to percentile-based bucketing for better visual distribution.
- **WeekdayWeekend chart** — Replaced dual Y-axis line chart with comparison bar chart for clearer weekday vs weekend patterns.
- **Chart polish** — Unified cached color to `chartMuted`, normalized WeekdayWeekend header/legend/tooltip, prefixed SVG gradient IDs to avoid collisions, capped leaderboard row animation stagger, replaced RankBadge raw colors with design tokens.

## v1.10.7

### Fixes

- **CLI login fails on some Macs** — The local callback server was bound to IPv4 `127.0.0.1`, but on Macs where `localhost` resolves to IPv6 `::1` the browser redirect would hit the wrong address family, causing "connection refused". Now binds to `localhost` so Node picks the correct address family automatically.

## v1.10.6

### Features

- **Season roster backfill** — Added `syncAllRostersForSeason()` for bulk roster sync. When `allow_roster_changes` is toggled from off to on for an active season, all registered teams' rosters are automatically backfilled. Also added a manual "Sync Rosters" button (RefreshCw icon) on the admin seasons page and a `POST /api/admin/seasons/[seasonId]/sync-rosters` endpoint.

### Fixes

- **CLI login broken since v1.8.2** — The `/api/auth/cli` endpoint silently discarded the `state` nonce parameter, causing every `pew login` to fail with "Invalid or missing state parameter". The state is now read from the incoming request and forwarded in the callback redirect.
- **Project chart line breaks** — Filled dates had `projects: {}`, making all project keys `undefined` in Recharts (line breaks, collapsed stacked areas). Now all known project names are backfilled to 0 across every date point.
- **Roster backfill skipped on upcoming→active transition** — The auto-backfill check used pre-update dates to derive season status. A single PATCH that changed dates (upcoming→active) and enabled roster changes would skip the backfill. Now uses post-update dates.

## v1.10.5

### Fixes

- **Trend chart date gaps** — All time-series charts (dashboard, models, devices, projects, sessions) now fill missing dates with zero values and always extend to the user's local "today". Previously charts ended abruptly at the last day with data, making recent idle days invisible. Added `fillDateRange()` and `fillTimelineGaps()` utilities in `date-helpers.ts`.

## v1.10.4

### Features

- **Leaderboard session columns** — Replaced input/output token breakdown (In/Out) with session count and total duration on both individual and season leaderboards. APIs now query `session_records` and return `session_count` + `total_duration_seconds` alongside token totals.

## v1.10.3

### Features

- **Season datetime precision** — Upgraded season `start_date`/`end_date` from `YYYY-MM-DD` to ISO 8601 UTC datetime with minute precision (e.g. `2026-03-15T00:00:00Z`). Resolves timezone ambiguity where UTC+8 users saw "upcoming" on the actual start day.

### Fixes

- **Migration end_date semantics** — End dates now migrate to `T23:59:00Z` (not `T00:00:00Z`) to preserve inclusive whole-day semantics
- **SQL datetime format mismatch** — Wrapped season date comparisons in `datetime()` to normalize ISO `T` format vs SQLite space-separated format in roster sync queries
- **Admin datetime-local inputs** — Inputs now display local timezone and convert to UTC on submit via `utcToLocalDatetimeValue()`/`localDatetimeValueToUtc()`, matching the project's UTC-in/local-out strategy
- **API date comparison** — Switched `end_date < start_date` validation from string comparison to epoch ms, fixing unstable ordering with mixed `HH:mmZ` / `HH:mm:ssZ` formats

### Refactor

- **DateTime helpers** — Moved `utcToLocalDatetimeValue()`/`localDatetimeValueToUtc()` to `date-helpers.ts` as project-wide utilities

### Docs

- **DateTime Strategy** — Updated CLAUDE.md with form input conversion rules, date comparison rules, and removed stale "interpreted as UTC" claim

## v1.10.2

### Features

- **Season toggle switches** — Added three per-season configurable flags: `allow_late_registration`, `allow_roster_changes`, `allow_late_withdrawal`. All default to off, preserving existing behavior. Admin can toggle from the season management page regardless of season status.
- **Season roster sync** — New `syncSeasonRosters` helper automatically syncs team member changes to frozen season rosters for active seasons with roster changes enabled. Integrated into team join, kick, and leave endpoints.
- **Admin UI for season toggles** — Checkbox controls in create/edit season forms, with `+reg`/`+roster`/`+wd` status badges in the season table.

### Docs

- **Docs index** — Renumbered conflicting doc files and created docs index README

## v1.10.1

### Fixes

- **Chart focus outline** — Removed blue highlight border on chart click via global CSS reset
- **Chart tooltip animation** — Disabled recharts tooltip slide-in animation across all 16 dashboard charts so tooltips appear instantly at cursor position
- **Leaderboard responsive overflow** — Fixed token columns overflowing on narrow screens with responsive column hiding and compact number formatting
- **Leaderboard design alignment** — Unified spacing, badge sizing, and rank medal alignment across leaderboard pages

## v1.10.0

### Features

- **Projects analytics page** — New dedicated Projects page with stat grid, share chart, trend chart, summary table with inline tag editing, and tag filtering
- **Project tags** — CRUD support for project tags via API with D1 migration (`011-project-tags.sql`)
- **Projects timeline API** — New `/api/projects/timeline` endpoint for project trend data with date range filtering
- **Dirty-keys upload optimization** — Track which token buckets changed during sync and upload only dirty records, reducing redundant uploads by ~99.9%

### Fixes

- **Token queue full re-upload** — Fixed bug where every incremental sync re-uploaded all records by introducing `dirtyKeys` tracking in `queue.state.json`
- **Projects page ESLint** — Resolved `react-hooks/set-state-in-effect` warning in projects page
- **Sidebar ordering** — Moved Projects below Sessions in analytics sidebar navigation
- **Tag rollback and period filtering** — Fixed tag rollback logic and period date range filtering in projects API

### Refactor

- **Management page relocation** — Moved project management to `/manage-projects`, keeping `/projects` for analytics

### Docs

- **Vitest sole test runner** — Clarified in CLAUDE.md that vitest is the only supported test runner; `bun test` causes false failures
- **Design docs** — Added doc 23 (By Project analytics) and doc 24 (Token queue full re-upload plan)

## v1.9.0

### Features

- **Leaderboard armory refactor** — Extracted shared layout and reusable components (`LeaderboardTable`, `LeaderboardTabs`, `PageHeader`) for all leaderboard pages
- **Underline-style tabs** — Replaced pill-style nav with underline tabs for a cleaner leaderboard navigation
- **Teal gradient header** — Added subtle teal gradient glow to leaderboard page header
- **Token tier badges** — Display token counts with K/M/B tier badges on leaderboard rows
- **Table polish** — Compact density, input/output color coding, and improved header styling across individual and season leaderboard pages

### Tests

- **UUID vs slug coverage** — Added branch coverage for UUID vs slug season parameter in leaderboard API

## v1.8.2

### Features

- **Health check endpoint** — Added `/api/live` endpoint to both web and worker, returning version and uptime for monitoring

### Fixes

- **TOML escape sequences** — Added missing `\b`, `\f`, `\uXXXX`, `\UXXXXXXXX` escape handling in `parseTomlStringArray` and codex-notifier parser
- **Corrupt queue infinite loop** — Advance upload offset past all-corrupt queue lines to prevent sync from looping forever
- **Token tooltip order** — Unified tooltip ordering in dashboard charts (#18)
- **Corrupt line warnings** — Added `onCorruptLine` callback to `BaseQueue` and wired it to `consola.warn` in all CLI commands
- **Login callback security** — Hardened login callback with nonce verification, loopback binding (`127.0.0.1`), and HTML escaping
- **Crash-safety ordering** — Write session queue before cursor update to prevent data loss on crash

### Refactor

- **Sync progress callbacks** — Extracted sync progress callbacks into reusable functions

## v1.8.1

### Features

- **Admin storage columns** — Replaced input/output token columns with total, 7-day, and 30-day token columns for more actionable usage visibility

### Fixes

- **ISO8601 datetime normalization** — Wrapped `hour_start` in `datetime()` for 7d/30d SQL queries to prevent over-counting caused by string comparison mismatch between `T`-separated and space-separated ISO formats
- **Recent page time window** — Changed from bare-date params (which expanded to ~96 hours via API +1 day logic) to full ISO timestamps for a true 72-hour rolling window
- **Leaderboard period labels** — Changed "This Week"/"This Month" to "Last 7 Days"/"Last 30 Days" to accurately reflect the rolling-window backend semantics
- **Dashboard weekday/weekend date** — Replaced `new Date().toISOString().slice(0, 10)` (UTC date) with `getLocalToday(tzOffset)` for correct local-date comparison in weekday vs weekend analysis
- **Devices active cutoff** — Changed 7-day active device cutoff from bare date string to full ISO timestamp for precise comparison against `last_seen`

## v1.8.0

### Features

- **Recent page overhaul** — Replaced simple list with half-hour granularity stacked bar chart (`RecentBarChart`) and expandable per-day detail table with model breakdown; changed nav icon to Clock
- **Admin Storage page** — New admin page showing per-user D1 database usage with record counts, date ranges, team count, and device count; sortable columns
- **D1 index optimization** — Migration to add targeted indexes and drop redundant ones based on query analysis (doc 22)
- **Sessions API improvements** — Separate summary query for accurate totals independent of row LIMIT; protective LIMIT 5000 on list query (later reverted in favor of summary-only approach)
- **Device management** — Show alias-only devices and allow deleting zero-record devices

### Fixes

- **Date range off-by-one** — Bare-date `to` params in usage, sessions, and by-device APIs now correctly include the entire `to` date (was excluding it because `new Date("2026-03-13")` resolves to midnight UTC)
- **Timezone double-shift** — `toLocalDateStr()` no longer applies timezone offset to bare date strings from day-granularity queries (was shifting to wrong day)
- **Leaderboard spacing** — Increased ranking item spacing from 8px to 12px; added `display:block` to Link wrapper for proper `space-y` gap
- **Storage table alignment** — Sort header buttons aligned to match right-aligned cell values
- **Sessions layout** — Equalized working/peak hours column width; show 5 peak slots
- **Windows compatibility** — Use `where.exe` instead of `which` for pew binary resolution on Windows

### Infrastructure

- **Leaderboard caching** — HTTP cache headers on leaderboard API (60s TTL)
- **Documentation** — D1 query optimization analysis (doc 22) with 7 slow-query recommendations

## v1.7.1

### Fixes

- **Timezone: daily aggregation** — Apply timezone offset to 7 daily aggregation functions (`toDailyPoints`, `toDailyCostPoints`, `toDailyCacheRates`, `groupByDate`, `toSourceTrendPoints`, `toDominantSourceTimeline`, `toModelEvolutionPoints`) with shared `toLocalDateStr()` helper
- **Timezone: current month tokens** — Apply timezone offset to `computeCurrentMonthTokens` month boundary filtering
- **Timezone: east-of-UTC date range** — Pad `periodToDateRange` `from`-boundary for east-of-UTC timezones to prevent missing edge-day data
- **Timezone: working hours label** — Remove stale "UTC" label from working hours heatmap (data is already local)
- **Timezone: month-over-month growth** — Apply timezone offset to `computeMoMGrowth` month assignment (was using UTC year/month)
- **Timezone: session daily stats** — Apply timezone offset to `toMessageDailyStats` day bucketing

### Infrastructure

- **Timezone helper** — Centralized `toLocalDateStr(hourStart, tzOffset)` utility in `usage-helpers.ts` for consistent UTC→local date conversion
- **Test suite** — 26 new timezone-aware tests across 6 test files

## v1.7.0

### Features

- **`pew update` command** — Self-update via `npm install -g @nocoo/pew@latest` with version comparison and restart guidance
- **`pew reset` command** — Clear all sync/upload state files for a clean full rescan
- **Version gate** — Server rejects uploads from CLI versions below `MIN_CLIENT_VERSION` (1.6.0) via `X-Pew-Client-Version` header
- **Atomic queue overwrite** — `BaseQueue.overwrite()` method for crash-safe full-scan writes (write-tmp-rename pattern)

### Fixes

- **Token inflation on inode change** — Full rescan now triggered when file inode changes (e.g. log rotation), preventing SUM-on-overwrite double-counting
- **Token inflation on no-op sync** — No-op sync no longer re-marks already-uploaded records as pending
- **Token inflation on file cursor loss** — `knownFilePaths` tracking distinguishes "new file" from "cursor entry lost", triggering full rescan on the latter
- **Token inflation on SQLite cursor loss** — `knownDbSources` tracking detects OpenCode SQLite cursor loss and triggers full rescan
- **Cursor backfill edge case** — `knownDbSources` backfill triggers full rescan when SQLite cursor is already lost (not silently initialized to empty)
- **Shared device ID** — `deviceId` migrated from per-env config to shared `~/.config/pew/device.json` (dev/prod use same device ID)
- **Reset command cleanup** — Removed unused `--dev` argument from reset command
- **Full-scan/incremental dual-branch** — Queue uses full-scan (overwrite) vs incremental (append) branches to prevent SUM inflation from replayed data

### Docs

- **Token inflation audit** — `docs/19-token-inflation-audit.md` with root cause analysis, fix plan, and implementation details
- **E2E validation record** — `docs/20-e2e-validation-record.md` documenting full pipeline verification against live D1
- **Session queue growth analysis** — `docs/21-session-queue-growth.md` analyzing unbounded append-only queue growth

### Infrastructure

- **E2E verified** — Token pipeline (5 sources × 6 fields = 30 values) and session pipeline (4 sources × 5 fields = 20 values) exact match between local and D1, idempotent across 4 syncs
- **Test suite** — 115 test files, 1862 tests passing

## v1.5.1

### Fixes

- **ESM/require SQLite bug** — Fixed `pew sync` failing to open OpenCode's SQLite database when running under Node.js ESM context; `require()` is undefined in ESM modules, causing silent fallback to null

### Refactoring

- **Zero native deps** — Replaced `better-sqlite3` with `node:sqlite` (Node.js >= 22.5) for SQLite access, eliminating ~20 transitive native dependencies and the `prebuild-install` deprecation warning during `npm install -g @nocoo/pew`
- **Engine requirement** — Added `"engines": { "node": ">=22.5.0" }` to CLI package

## v1.5.0

### Features

- **By Device analytics** — New "By Device" page with device usage aggregation, trend charts, and share charts; GET `/api/usage/by-device` endpoint
- **Devices management** — Manage page for device aliases with inline editing, relative time display, and per-device stats; GET/PUT `/api/devices` endpoint
- **Device chart components** — Device trend chart and device share chart with zero-fill and largest-remainder rounding
- **Daily messages** — Renamed User/Assistant labels to Human/Agent across daily message views
- **ESLint L2 pipeline** — ESLint 10 with typescript-eslint strict, React hooks, and Next.js plugins integrated into lint and pre-commit hooks
- **lint-staged** — Incremental ESLint on staged files via lint-staged for faster pre-commit feedback

### Fixes

- **Dockerfile build** — Added `--ignore-scripts` to `bun install` to skip `better-sqlite3` native compilation in Bun Docker image
- **DeviceTrendPoint unused import** — Removed unused type import that broke Next.js production build
- **React purity** — Suppressed `react-hooks/purity` for intentional `Date.now()` in relative time display
- **Coverage enforcement** — Pre-commit hook now runs `test:coverage` instead of `test` to enforce 90% threshold
- **Coverage exclusions** — Excluded UI hooks, auth config, R2 client, and proxy from UT coverage (covered by E2E)
- **Node.js SQLite** — Restored try/catch guard for native SQLite import with updated warning messages
- **Device pricing** — Use merged DB pricing overrides for by-device estimated cost
- **Device trend zero-fill** — Zero-fill missing devices in trend and share chart helpers

### Refactoring

- **Git hooks restructured** — pre-commit runs UT only (fast); pre-push runs UT + lint + E2E (full gate to catch remote merge issues)
- **Unified UI components** — Shared FilterDropdown component, unified agent pill colors across By Model and Projects pages, unified season/leaderboard page styles
- **Invite codes** — Status filter and copy-available button on invite codes page

### Infrastructure

- **D1 migration** — `device_aliases` table for per-device custom names
- **Husky v9** — Migrated from legacy `.husky/_` to modern v9 hook format
- **Test suite** — 113 test files, 1817 tests passing, 95%+ coverage
- **README** — Added Testing & Git Hooks documentation section

## v1.4.0

### Features

- **Privacy policy page** — New `/privacy` page with Privacy icon (ShieldCheck) linked from landing, leaderboard, and dashboard
- **Enhanced project stats** — Projects API now returns `total_messages`, `total_duration`, and `models` arrays; responsive columns on projects table
- **hashProjectRef** — SHA-256 truncated hash utility applied to all parsers for consistent 16-char hex project references
- **formatDuration helper** — Human-readable duration formatting for session/project display

### Fixes

- **CLI no-subcommand usage** — Running `pew` without a subcommand now shows usage instead of citty's "No command specified" error

### UI

- **Unified public page styling** — Privacy ShieldCheck icon and `© {year} pew.md · Privacy` footer consistent across landing, leaderboard, and dashboard header

### Infrastructure

- **D1 migration 008** — Null out legacy unhashed `project_ref` values; re-sync repopulates with valid 16-char hex hashes

## v1.3.0

### Features

- **VS Code Copilot support** — Full end-to-end integration as the 6th supported AI tool: CRDT JSONL parser, multi-directory file discovery, token driver, session driver, CLI sync/notify/status wiring, and dashboard source enumerations
- **Team owner controls** — Member list view, kick members, rename team, leave guard for owners
- **Team logo upload** — R2-backed logo upload with unique keys, compensating R2 delete on DB failure, cache busting, and error state reset

### Fixes

- **Worker ON CONFLICT mismatch** — Redeployed Worker after migration 006 added `device_id` to UNIQUE constraint (was causing all token ingests to silently fail with 500)

### Infrastructure

- **npm keywords** — Added `openclaw`, `copilot`, `vscode-copilot` for discoverability
- **Documentation** — All tool lists updated to reflect 6 supported AI tools across CLAUDE.md, docs, and test assertions
- **Retrospective** — Documented Worker deploy-after-migration lesson in CLAUDE.md

## v1.2.0

### Features

- **Projects page** — Two-layer project model (projects + aliases) with session-based project stats, project breakdown chart, and project filter on sessions page
- **Multi-device sync** — Added `device_id` column to usage records for per-device deduplication
- **Team member limit** — `app_settings` table with configurable `max_team_members` (default 5)

### Fixes

- **Team join race condition** — Atomic INSERT...SELECT prevents duplicate team memberships
- **Project alias deduplication** — PATCH projects deduplicates `add_aliases` to prevent UNIQUE constraint errors
- **Project rollback safety** — Rollback logic in projects API prevents partial updates; pre-existing aliases preserved during rollback
- **Admin settings validation** — `max_team_members` validated as positive integer
- **UI polish** — Unified lowercase "pew" brand with handwriting font, leaderboard z-index and font sizing fixes

### Infrastructure

- **D1 migration 006** — `device_id TEXT NOT NULL DEFAULT 'default'` on `usage_records` with updated UNIQUE constraint (5 columns)
- **Squashed schema sync** — `001-init.sql` updated with projects, device index, and renumbered migrations

## v1.1.1

### Fixes

- **Landing install command** — Changed from `bun add -g` to `npm install -g` for broader compatibility (CLI is pure Node.js, no Bun dependency required)
- **CLI login redirect** — Use `x-forwarded-host`/`x-forwarded-proto` headers for public origin instead of container-internal `request.url` (`0.0.0.0:8080` → `pew.md`)

### Infrastructure

- **D1 database ID** — Fixed Railway env var pointing to deleted D1 database
- **Retrospective** — Documented `request.url` internal hostname pitfall in CLAUDE.md

## v1.1.0

### Features

- **Public leaderboard overhaul** — Leaderboard moved out of dashboard layout into standalone public page with landing-page-style design (logo, GitHub link, theme toggle, fade-up animations)
- **Privacy toggle** — `is_public` column on users table; settings page toggle controls leaderboard visibility; public profiles gated by opt-in
- **Admin leaderboard mode** — Admin users see all users regardless of `is_public` status via scope dropdown (Global / Teams / All Users)
- **Sidebar external links** — Navigation items support `external?: boolean` flag, rendering as `<a target="_blank">` with ArrowUpRight icon
- **Leaderboard UI polish** — Period tabs (This Week / This Month / All Time), scope dropdown with Lucide icons (Globe / Users / ShieldCheck), check-style ruling on rows, handwriting font (`text-3xl`) for token numbers with full comma formatting

### Fixes

- **Login card clipping** — Auto-height fix prevents footer from clipping the login button
- **Admin fallback** — Admin bare endpoint returns `is_public: false` instead of `null`
- **Migration backfill** — Settings and leaderboard fallback for existing users without `is_public`
- **Smooth dashboard resize** — Dashboard resize and sidebar logo rendering improvements
- **Handwriting vertical alignment** — `leading-none` on `text-3xl` token numbers fixes baseline shift
- **Leaderboard skeleton flash** — `use-leaderboard` hook keeps stale data visible during refetch (`refreshing` state)

### Refactoring

- **Leaderboard layout** — Extracted from dashboard into `app/leaderboard/page.tsx` as standalone route
- **Default leaderboard limit** — Changed from 50 to 10

### Infrastructure

- **D1 migration** — `005-is-public.sql` adds `is_public INTEGER NOT NULL DEFAULT 0` to users table
- **Squashed schema** — `001-init.sql` updated with `is_public` column
- **Test suite** — 1545 tests passing, proxy tests updated for `/leaderboard`, L1 tests for `is_public` settings and admin leaderboard

## v1.0.0

### Features

- **Achievement badge system** — 6 gamified badges (On Fire, Big Day, Power User, Big Spender, Veteran, Cache Master) with bronze/silver/gold/diamond tiers, progress rings, and pill card UI on the dashboard
- **Dashboard segments** — Dashboard restructured into 4 named sections (Achievements, Overview, Trends, Insights) with `DashboardSegment` dividers for clear visual hierarchy
- **Budget tracking** — Full budget lifecycle: set monthly token budgets via dialog, progress bar with threshold alerts, budget status API (GET/PUT/DELETE), and Clear Budget button
- **Time analysis** — Streak tracker (local timezone), peak hours detection, weekday vs weekend comparison chart with dual Y-axes, month-over-month growth metrics
- **Cost analytics** — Cost trend chart, cache savings estimation, monthly cost forecast, cost-per-token breakdown, and forecast stat card on dashboard
- **Cache & I/O visualization** — Cache rate chart showing daily hit rates, I/O ratio donut chart for input/output token balance
- **Tool comparison** — Source trend chart (agent usage over time), model evolution chart (model adoption timeline) on Models page
- **Landing page redesign** — Single-viewport layout with motion animations, streamlined CTA hierarchy, usage steps, theme toggle, and 512px logo

### Refactoring

- **Dashboard layout** — Two-column chart layout (trends left, donut/ratio right) with By Agent chart flex-stretching to fill container height; side-by-side bottom row (heatmap + weekday/weekend)
- **Stat card grid** — Consolidated into clean 4+4 (lg) or 4+2 (md) responsive grid layout
- **Achievement UI** — Redesigned from vertical cards to horizontal pill cards with tier-colored icons and compact progress rings; replaced InsightCards and StreakBadge
- **Apps → Agents** — Renamed "By App" to "By Agent" across navigation, routes, and UI labels
- **Landing page** — Stripped card grid, condensed feature descriptions, rebranded slogan to "show your tokens"

### Fixes

- **Budget scope** — Budget status now uses current-month tokens instead of period-scoped total
- **Streak timezone** — Streak "today" comparison uses local timezone instead of UTC
- **Weekday/weekend scale** — Added separate cost Y-axis for proper dual-axis scaling
- **Login page encoding** — Added `<meta charset="utf-8">` and replaced em dash with hyphen to fix character display
- **Proxy matcher** — Leaderboard filter dropdown uses Lucide ChevronDown with proper padding

### Infrastructure

- **Database rename** — Renamed `zebra-db` to `pew-db` with new APAC-region D1 instance
- **Migration squash** — Consolidated 5 migration files into single `001-init.sql` (9 tables, 8 indexes)
- **Test suite** — 50+ test files, 1508 tests passing, 90% coverage thresholds enforced

## v0.6.2

### Features

- **Notifier automation** — Added installable notifier drivers for Claude Code, Gemini CLI, OpenCode, OpenClaw, and Codex, plus shared `notify.cjs`, coordinated `pew notify`, `pew init`, and `pew uninstall`
- **Notifier lifecycle visibility** — `pew status` now reports installed / not-installed / error notifier state per source

### Fixes

- **Coordinator runtime fallback** — `pew notify` now degrades safely when Bun runtime file handles do not expose `lock()`, avoiding crash-on-notify under Bun
- **OpenClaw trigger control** — Generated OpenClaw plugin now includes a 15s trigger throttle and better config/CLI error handling
- **Dry-run and uninstall safety** — `pew init --dry-run` no longer creates directories, and `pew uninstall` only removes generated `notify.cjs` files that match the pew marker

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
