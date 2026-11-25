# pew

Bun-workspaces monorepo tracking token usage and sessions from local AI coding tools across a published CLI, Next.js 16 dashboard, and two Cloudflare Workers.
Docs: [README.md](README.md) · [Operations & Release](docs/49-agent-operations.md) · [Local E2E Isolation](docs/32-local-e2e-isolation.md) · [jp2 Migration](docs/52-jp2-migration.md) · [Retrospective](Retrospective.md)

- `packages/core` (`@pew/core`, private): pure shared TS types, zero runtime deps, `import type` only, `devDependencies`.
- `packages/cli` (`@nocoo/pew`, public npm): local source parsers, cursors, queues, and upload CLI.
- `packages/web` (`@pew/web`, private): Next.js 16 App Router dashboard (`@nocoo/basalt`); also follow [packages/web/AGENTS.md](packages/web/AGENTS.md).
- `packages/worker` (`@pew/worker`, private) & `packages/worker-read` (`@pew/worker-read`, private): Cloudflare Workers for D1 ingest writes and typed read RPC.

## Commands

Run from repo root with pinned Bun `1.4.0` and Node `26.13.1` (CI/Docker parity). Local web env variable names live in `packages/web/.env.example`.

```sh
bun install --frozen-lockfile
bun run dev                       # @pew/web -> http://localhost:7020
bun run build                     # @pew/core + @pew/web only (B1)
bun run --cwd packages/cli build  # explicit CLI build before npm publish
bun run typecheck                 # S1: all 5 packages + tsconfig.e2e.json
bun run lint                      # S2: Biome (0 warnings)
bun run test                      # L1: Vitest unit suite (sole test runner)
bun run test:coverage             # L1: v8 >=80% statements/branches/functions/lines
bun run test:e2e                  # L3: API E2E on :17020 (isolated local D1/KV)
bun run test:e2e:ui               # L4: Playwright E2E on :27020 (isolated D1/KV)
bun run test:e2e:cli              # CLI pipeline E2E (synthetic temp dirs)
bun run test:security             # G1/G2: osv-scanner + gitleaks
bun run test:l1-gate              # L1 pre-commit negative-probe self-test
bun run sync-prices               # model pricing table sync
sh scripts/ponytail-audit.sh      # read-only accounting/complexity JSON audit
```

## Invariants

- **Active & retired sources**: 9 active tools (`SOURCES`: Antigravity, Claude Code, Codex, Copilot CLI, Grok, Hermes, OpenCode, OpenClaw, Pi); `VALID_SOURCES` keeps historical identities readable for rankings.
- **Retired ingest**: exact retired identities are acknowledged and ignored (no new token/session/evidence/accounting writes) so mixed-source batches never block active uploads.
- **Read-only raw data**: never modify, delete, or move original AI-tool logs/SQLite; pew writes only under `~/.config/pew/`.
- **Source isolation & idempotency**: each parser is independent and must never corrupt other sources; `pew reset && pew sync` is always safe, deduplicating via `ON CONFLICT` upserts (never summed).
- **Privacy & recovery**: preserve incremental rewind, cursor-loss recovery, and Antigravity tombstone baselines; never upload raw conversation bodies or put raw logs/real CLI state in fixtures.
- **Auth & typed RPC**: preserve Google login, invite/device flows, bearer auth, server-only secrets, thin routes, and MVVM. Web reads use `DbRead` RPC via `worker-read` `/api/rpc`; never add generic SQL.
- **DateTime (UTC-in, local-out)**: D1, Workers, and CLI store/compute strictly in UTC (`datetime('now')`, `toISOString()`, `Date.UTC()`, `getUTC*`/`setUTCDate`); derive season status via `deriveSeasonStatus()`.
- **DateTime UI & ordering**: convert to local time in web UI (`tzOffset`, `toLocaleString()`); use `utcToLocalDatetimeValue()`/`localDatetimeValueToUtc()` for `datetime-local` (never append `Z`); compare by epoch ms.
- **Build & strictness**: TS strict composite refs across all 5 packages; preserve standalone assets (`public/`, `.next/static`) and `scripts/fix-standalone-swc-helpers.ts`; ban `.skip`/`.only` (Biome error).
- **Scoped releases**: root and `packages/web` share Web version; CLI/core/Workers version independently. Never use `bun run release` for scoped releases (it bumps every package/Worker and pushes without prompt).
- **Production deploy**: `main` push triggers Docker CD (`.github/workflows/release.yml`) to `/opt/pew` on jp2; never use `railway up` or manual rebuilds. Worker/schema changes need `wrangler deploy` + live check.
- **jp2 & Railway safety**: retain stopped Railway project/vars/rollback image; shared Caddy uses `SIGUSR1` hot reload (never restart). Full SOP: [agent operations](docs/49-agent-operations.md).
- **Ponytail audit**: read `.agents/skills/ponytail-audit/SKILL.md` and run `sh scripts/ponytail-audit.sh` (deterministic stdout JSON only; never write reports or touch real logs, state, queues, or services).

## Quality & Local Gates

Follows `system1-quality`; CI slot definitions and pinned `base-ci` revision live in `.github/workflows/quality-slots.yml` (`quality / Z1: Gate` required on `main` and by `release.yml`). Status vocabulary: `enforced`, `planned`, `manual`, `N/A`.

- **Exceptions / gaps**: `L2 Runtime` is `N/A` (API/Worker HTTP runs in `L3 Integration`, CLI pipeline in `test:e2e:cli`); `@nocoo/pew` npm publish check is `manual` (`P1: Package` runs Linux container smoke in CI).
- **CI build reuse & L4 scope**: `B1: Build` uploads `core-dist` (`packages/core/dist`), downloaded by `L3: Integration` and `L4: E2E` (`needs: [b1-build]`). `L4: E2E` runs 5 core Desktop Chromium smoke specs in `packages/web/e2e/bdd/` (`workers: 4` in CI).
- **Coverage boundary**: `L1` enforces >=80% x4; `vitest.config.ts` excludes `.tsx` views, client hooks, thin auth/proxy/R2/RPC adapters, and CLI orchestrators.
- **Extra CI checks**: `P1: Package` runs inside `quality-slots.yml` gated by `Z1: Gate`; `admission-primitive.yml` tests cross-OS `wx` lock atomicity.
- **Pre-commit hook**: installed via `bun run prepare` (`.husky/`). Checks staged index snapshot (`L1`/`S1`/`S2`); `G1` runs in `pre-push` and CI; cold full hook exceeds the 30s target.
- **Pre-push hook**: rejects local `.env*` files, then runs `L3` API E2E (`:17020`), `L4` Playwright E2E (`:27020`), and `G1`/`G2` (`test:security`) in parallel; runs on tag pushes too (never bypass).

## Resources & Isolation

| Lane        | Endpoint / State                                              | Boundary                                                                                                       |
| ----------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Dev         | `127.0.0.1:7020`, `packages/web/.env.local`, `~/.config/pew/` | Daily local data; CLI `sync`/`init`/`reset` mutate state; preserve running server                              |
| API E2E     | `127.0.0.1:17020`, per-run temp D1/KV + source Workers        | Clean env-free clone only; build `@pew/core` first; `_test_marker` (`env`+`run`); fails on port conflict       |
| Browser E2E | `127.0.0.1:27020`, per-run seeded D1/KV + source Workers      | Isolated Playwright lane separate from API E2E; loopback bridge only, no cloud secrets                         |
| Prod        | `https://pew.md` (jp2 `/opt/pew`), Cloudflare Workers/D1      | Read-only checks unless deploy/publish is authorized; see [docs/52-jp2-migration.md](docs/52-jp2-migration.md) |

## Retrospective

Record incident narratives in [Retrospective.md](Retrospective.md); promote recurring project constraints to `Invariants` above and enforceable safeguards to tests/hooks.
