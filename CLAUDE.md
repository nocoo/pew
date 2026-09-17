# pew

Local AI-tool usage collector and web dashboard, with separate Cloudflare ingest/read Workers.
Profile: ts-worker-web plus cli-library.
Direction: [data pipeline](docs/03-data-pipeline.md), [CLI/time/release contracts](docs/49-agent-operations.md).

## Sources of Truth

This file is the contract; hooks, CI and config enforce it. Raise weaker/obsolete enforcement to match; never lower the contract. Frameworks must not rewrite this file.

| Fact | Where |
| --- | --- |
| Human docs | [README.md](README.md), [docs/README.md](docs/README.md), [PRIVACY.md](PRIVACY.md) |
| Version | Root/package versions synchronized by `scripts/release.ts` |
| Enforcement | `.husky/`, CI, root Vitest, gate scripts |
| Environment | Ignored `packages/web/.env.local` and legacy `.env.test`; tracked `.env.example` |
| Accidents | [Retrospective.md](Retrospective.md) |

## Project Invariants

- Raw tool logs/SQLite are read-only. Sources are independent; a parser failure must not corrupt other sources. Only pew-owned state may change during explicitly requested CLI use.
- Uploads are idempotent `ON CONFLICT` snapshots, never duplicated sums. Preserve incremental rewind/cursor-loss recovery and source-specific token accounting; raw conversation bodies are not uploaded by this product.
- UTC storage/computation, local-only presentation, epoch-ms comparisons and precise season/form conversions follow [time contracts](docs/49-agent-operations.md). Never append Z to local datetime input or change stored ISO syntax.
- `@pew/core` is private, type-only, imported with `import type` and never published. Root build excludes the CLI; publish requires its explicit build.
- Preserve Google login, invitation/device flows, bearer handling and MCP-independent package boundaries. Keep secrets server-side and data/query access authorized.
- Web deploys via Git/CI to Railway, ingest/read Workers independently. Preserve standalone assets/SWC helper packaging and pin Bun across local/CI/container versions.
- Keep MVVM and thin routes. Use the Pew-specific readonly ponytail audit entry documented in [operations](docs/49-agent-operations.md); never audit by mutating real logs/state/queues.

## Stack / Layout

| Component | Choice |
| --- | --- |
| Tooling | Bun workspaces 1.4.0, TypeScript strict/composite, Biome + oxc gates |
| CLI | `packages/cli` (`@nocoo/pew`); Node 24+ recommended for native SQLite sources |
| Web/core | `packages/web` Next.js/React; `packages/core` shared types |
| Edge | `packages/worker` ingest, `packages/worker-read` queries; D1/KV/R2 |

Supported source identities and default paths are in CLI `src/utils/paths.ts`; source/session support differs. Keep raw logs and `~/.config/pew/` out of tests.

## Commands

Run from root. Normal dev requires the server-side variables listed in README; safe unit/CLI fixture tests need no production credentials.

```sh
bun install --frozen-lockfile
bun run dev
bun run typecheck
bun run lint
bun run build
bun run --filter '@nocoo/pew' build
bun run test:coverage
bun run test:e2e:cli
bun run test:security
```

`test:e2e` (17020) and `test:e2e:ui` (27020) exist, but currently require remote test D1/Workers from `.env.local`/`.env.test`. They are not approved local-isolation entrypoints; do not run them against production or provision remote tests. A local replacement is planned. CLI sync/init/reset are actual state-changing operations, not documentation checks.

## Verification

6DQ = L1/L2/L3 + G1/G2 + D1. Status: `enforced`, `planned`, `manual`, `N/A`. L1 statements/branches/functions/lines each ≥95%; no `.skip`/`.only`.

| Piece | Requirement and current reality | Status | Evidence |
| --- | --- | --- | --- |
| L1 | Four metrics ≥95% within configured non-View logic | enforced | Root Vitest, cached L1 hook and CI; legacy hook comments saying 90% are stale |
| L2 | Every endpoint/method over real local HTTP/SQLite | planned | Existing pre-push/CI HTTP suites target remote test infrastructure |
| L3 | Browser journeys and real CLI process workflows on isolated fixtures | planned | CLI fixture suite exists; browser pre-push/CI still needs remote resources |
| G1 | Five type lanes, zero warnings/errors, AST and skipped/focused-test checks | planned | Gates exist; lint-staged currently mutates concurrently with worktree tests/types |
| G2 | Required OSV + gitleaks on pushed revisions; missing scanner fails | planned | `run-security.ts` is hard by default but offers soft mode and uses upstream range |
| D1 | Per-run local SQLite/cache, guards and marker | planned | `d1-test-guard.ts` validates distinct remote IDs/URLs; remote separation does not satisfy current contract |
| Build | Core/Web, plus CLI when shipped | enforced | CI prepares root build; release requires separate CLI build |
| Docs | Parser/time/release contracts and honest evidence | manual | Numbered document review |

Pre-commit skips code gates for docs. For code it runs cached coverage/types with lint-staged; only AST gates use an index snapshot. Pre-push requires both env files and runs remote L2/L3 plus G2 in parallel. Target: check-only full index L1/G1 <30s, stdin pushed-ref local L2/G2 <3min. Never use hook bypass, soft-security mode or disabled tests to push.

## Resources / Isolation

| Purpose | Existing resource | Policy |
| --- | --- | --- |
| Dev | Next 7020, real configured cloud connections | Operational dev, never test fixtures |
| Legacy L2 / L3 | 17020 / 27020 and remote `-test` resources | Nonconforming; local replacement required |
| CLI integration | Temporary directories/synthetic source data | Independent of real source files/cursors/queue |

The September local standard supersedes remote-test instructions in README/document 31: local Wrangler/Miniflare, per-run SQLite, loopback/binding/context checks and `_test_marker` before seed/reset/cleanup. Do not create/deploy remote `-test` resources or use production/daily-dev stores. Missing local setup is an implementation blocker, never permission to skip a gate.

## Operations / Release

Authorized release entry: `bun run release`; details in [operations](docs/49-agent-operations.md). Do not deploy through `railway up`. Apply schema before dependent Worker code, verify separate runtime versions and monitor the exact pushed commit's CI. npm dry-run/build is not a completed publication.

## Retrospective

Full domain-grouped incidents moved to [Retrospective.md](Retrospective.md). Recurring rules stay brief; global lessons belong in nmem/rules and deterministic checks in tests/hooks.

- Migrate every affected mock when inserting a data abstraction; retain provider boundaries and safe incremental replay.
- Preserve framework-generated declarations around E2E, without staging incidental build output.
