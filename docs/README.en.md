<p align="center">
  <img src="../assets/brand/icon-rounded.png" width="128" height="128" alt="pew" />
</p>

<h1 align="center">pew</h1>

<p align="center">Track usage, sessions, and trends across AI coding tools.</p>

<p align="center">
  <a href="https://pew.md">Website</a> ·
  <a href="../README.md">简体中文</a>
</p>

## What it does

pew combines a local CLI with a web dashboard. The CLI reads logs and local databases from AI coding tools, extracts token usage and session statistics, and uploads them for analysis by time, tool, model, and device.

Source logs remain read-only. Token uploads are aggregated into half-hour buckets. Session records include timestamps, message counts, and hashed project references, without conversation bodies. Completeness depends on what each tool records. Costs are estimates based on model prices and may differ from provider invoices.

## Features

- Collect input, cached-input, output, and reasoning tokens with incremental scanning, an offline upload queue, and upload deduplication.
- Explore contribution heatmaps, hourly and daily trends, model and tool breakdowns, and device analytics.
- Inspect session times, duration, message counts, and human or automated session classification.
- Manage device names, explore team, organization, and season totals, and browse public leaderboards.
- Estimate usage costs with dynamic model prices and fallback tables, including price sources and update times.
- Configure automatic synchronization after sessions for supported tools, and use `pew sync` for other sources.

The 10 supported token sources are Antigravity CLI, Claude Code, Codex, GitHub Copilot CLI, Grok, Hermes, OpenClaw, OpenCode, Pi, and WorkBuddy. Session statistics currently exclude Hermes.

## Usage

Node.js 24 or newer is recommended. The npm package declares Node.js 18 support, but SQLite sources for Antigravity CLI, OpenCode, and Hermes require built-in SQLite support and cannot be read on older Node.js versions.

```bash
npm install -g @nocoo/pew
pew login
pew sync
pew status
```

`pew login` connects to [pew.md](https://pew.md) through your browser. The web application uses Google sign-in. New accounts require an invite code by default, depending on site settings. For a machine without a browser, generate a one-time code on the web Devices management page and run `pew login --code XXXX-XXXX`.

| Command | Purpose |
| --- | --- |
| `pew sync` | Scan local data and upload when signed in |
| `pew sync --no-upload` | Parse into the local queue without uploading |
| `pew status` | Inspect scanning, queue, and automatic-sync status |
| `pew init` | Configure supported automatic-sync integrations |
| `pew uninstall` | Remove automatic-sync integrations |
| `pew logout` | Clear current login credentials |
| `pew update` | Update the installed CLI |

Automatic synchronization supports Claude Code, Codex, OpenClaw, OpenCode, and Pi. Setup changes the corresponding tool configuration. pew stores its own credentials, cursors, queues, and run records under `~/.config/pew/`.

Set `COPILOT_OTEL_FILE_EXPORTER_PATH` for a Copilot CLI OTel file. Use `PEW_COPILOT_OTEL_PATHS` for multiple files or directories separated by the operating system's path delimiter. Default source paths are defined in [paths.ts](../packages/cli/src/utils/paths.ts).

Antigravity CLI usage and sessions come from `~/.gemini/antigravity-cli/conversations/*.db`, without upstream login or running `agy`. It has no automatic sync integration; use `pew sync`. Uncached input and cache reads are disjoint. Visible output and reasoning are split without double-counting. Cache hit rate is cache reads / total input, including reported zero-hit calls. See [Antigravity accounting](51-antigravity-support.md).

## Development

The repository uses Bun workspaces. Use Bun 1.4.0 to match the current CI and Dockerfile, with Node.js 24 or newer.

```bash
git clone https://github.com/nocoo/pew.git
cd pew
bun install --frozen-lockfile
cp packages/web/.env.example packages/web/.env.local
```

Fill in `packages/web/.env.local`, then run `bun run dev`. The web address is `http://localhost:7020`; the Google OAuth callback is `http://localhost:7020/api/auth/callback/google`.

| Configuration | Purpose |
| --- | --- |
| `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Sessions and Google sign-in |
| `CF_ACCOUNT_ID`, `CF_D1_DATABASE_ID`, `CF_D1_API_TOKEN` | D1 REST writes and database access |
| `WORKER_INGEST_URL`, `WORKER_SECRET` | Batched usage and session ingestion |
| `WORKER_READ_URL`, `WORKER_READ_SECRET` | Required runtime database queries |
| `ADMIN_EMAILS` | Administrator email list |

The application requires an initialized D1 database and both Workers. Migrations live in [scripts/migrations/](../scripts/migrations/); each Worker's `wrangler.toml` defines bindings and its test environment. Team and organization logo uploads also need `CF_R2_ENDPOINT`, `CF_R2_ACCESS_KEY_ID`, `CF_R2_SECRET_ACCESS_KEY`, and `CF_R2_BUCKET`. The public asset domain is currently configured in [r2.ts](../packages/web/src/lib/r2.ts).

```bash
bun run typecheck
bun run lint
bun run build
bun run --filter '@nocoo/pew' build
```

The root `build` command builds core and web only; build the CLI separately. The web application uses Next.js standalone output, with a container entry point in [Dockerfile](../Dockerfile). The CLI's production and development hosts are currently fixed in [login.ts](../packages/cli/src/commands/login.ts); adjust them for a self-hosted installation.

| Directory | Contents |
| --- | --- |
| `packages/core` | Shared TypeScript types |
| `packages/cli` | npm CLI, parsers, queues, and automatic synchronization |
| `packages/web` | Dashboard, accounts, and application APIs |
| `packages/worker` | D1 batch-ingestion Worker |
| `packages/worker-read` | Queries, caching, and model-price synchronization |
| `scripts` | Migrations, tests, and maintenance scripts |

## Tests

| Layer | Command | Prerequisites |
| --- | --- | --- |
| Unit and component logic | `bun run test` | Installed dependencies |
| CLI collection-pipeline integration | `bun run test:e2e:cli` | Temporary test data and directories; no login |
| API end-to-end | `bun run test:e2e` | Local isolated D1/KV runtime and Worker bridge; port 17020 |
| Browser end-to-end | `bun run test:e2e:ui` | Local isolated runtime, Chromium; port 27020 |

Run `bunx playwright install chromium` before browser tests. Use `bun run test:watch` for unit tests during development or `bun run test:coverage` for a report.

### E2E isolation

E2E tests run in a fully isolated local sandbox (see [Local E2E isolation](32-local-e2e-isolation.md)). The runner provisions a temporary D1/KV SQLite directory per invocation, applies local migrations, starts a local loopback bridge, and cleans up upon completion.

No cloud credentials or test environment files are required (in fact, local `.env` files trigger fail-fast rejection to prevent accidental leaks). API tests seed and clean synthetic test-user data. Browser tests use development test authentication without Google OAuth. Ensure test ports are free before running.

## Stack

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-14151A?logo=bun&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-000000?logo=nextdotjs&logoColor=white)
![Cloudflare](https://img.shields.io/badge/Cloudflare-F38020?logo=cloudflare&logoColor=white)

| Area | Implementation |
| --- | --- |
| CLI | Node.js / Bun, TypeScript, @nocoo/base-cli, built-in SQLite |
| Web | Next.js, React, Basalt, Tailwind CSS, Recharts, SWR |
| Authentication | Auth.js, Google OAuth |
| Data and storage | Cloudflare Workers, D1, KV, R2 |
| Development and tests | Bun workspaces, Biome, Vitest, Playwright |

## Documentation

- [Documentation index](README.md)
- [Data pipeline](03-data-pipeline.md)
- [Privacy policy](../PRIVACY.md)
- [Changelog](../CHANGELOG.md)

## License

[MIT](../LICENSE) © 2026 Zheng Li
