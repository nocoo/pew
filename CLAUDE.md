## Project

Zebra is a monorepo (Bun workspaces) for tracking token usage from local AI coding tools.

- `packages/core` — shared TypeScript types (`@zebra/core`, private, zero runtime deps)
- `packages/cli` — CLI tool (`@nocoo/zebra`, published to npm, citty + consola + picocolors)
- `packages/web` — SaaS dashboard (`@zebra/web`, private, Next.js 16 + App Router)
- `packages/worker` — Cloudflare Worker for D1 ingest writes (`@zebra/worker`, private)

### Supported AI Tools

Claude Code, Gemini CLI, OpenCode, OpenClaw

### Key Conventions

- **Runtime**: Bun (package manager + runtime)
- **TypeScript**: Strict mode, composite project references
- **Port**: dev=7030, API E2E=17030, BDD E2E=27030
- **Testing**: Four-layer architecture (see docs/01-plan.md)
- **TDD**: Always write tests first, then implement
- **Commits**: Conventional Commits, atomic, auto-commit after changes
- **`@zebra/core` is NOT published**: Pure types, `import type` only, `devDependencies`

## npm Publish Procedure

CLI package `@nocoo/zebra` is published to npm. Steps:

1. **Bump version** — ALL `package.json` files + `packages/cli/src/cli.ts` (`meta.version`)
2. **Build** — `bun install && bun run build`
3. **Test** — `bun run test`
4. **Dry-run** — `npm publish --dry-run` in `packages/cli/`
5. **Publish** — `npm publish` in `packages/cli/`
6. **Verify** — `npx @nocoo/zebra@latest --help`
7. **Commit & push** — Triggers Railway auto-deploy for web
8. **Tag & release** — `git tag vX.Y.Z && git push origin vX.Y.Z`

## Retrospective

- **D1 REST API has no batch endpoint**: The `/query` endpoint only accepts a single `{ sql, params }` object. Sending an array (like the Workers Binding `db.batch()`) returns "Expected object, received array". Unit tests with mocked fetch won't catch this — only E2E tests against real D1 reveal it. Fix: send statements individually in a loop.
- **Next.js dev server modifies `next-env.d.ts` and `tsconfig.json`**: Running `next dev` with `NEXT_DIST_DIR=.next-e2e` overwrites these files to reference `.next-e2e`. Always `git checkout` these after E2E runs to avoid committing noise.
- **D1 SQLite param limit is 999, not 3400**: Multi-row INSERT with 300 rows × 9 cols = 2700 params triggers `SQLITE_ERROR: too many SQL variables`. The safe maximum is ~100 rows (900 params). We use CHUNK_SIZE=20 (180 params) for comfortable headroom. Only production D1 reveals this — L1 mocks and local SQLite may have different limits.
- **Worker migration eliminated REST API bottleneck**: The D1 REST API had no batch endpoint and rejected multi-row INSERTs beyond ~5 rows, requiring 60 sequential HTTP calls for 300 records. Migrating to a Cloudflare Worker with native D1 bindings (`env.DB.batch()`) reduced this to a single HTTP call with implicit transactional semantics. D1 Free plan limits 50 queries per Worker invocation, so batch size was reduced from 300 to 50. The Worker handles writes only; reads still use the REST API from Next.js.
