## Project

Pew is a monorepo (Bun workspaces) for tracking token usage from local AI coding tools.

- `packages/core` — shared TypeScript types (`@pew/core`, private, zero runtime deps)
- `packages/cli` — CLI tool (`@nocoo/pew`, published to npm, citty + consola + picocolors)
- `packages/web` — SaaS dashboard (`@pew/web`, private, Next.js 16 + App Router)
- `packages/worker` — Cloudflare Worker for D1 ingest writes (`@pew/worker`, private)

### Supported AI Tools

Claude Code, Gemini CLI, OpenCode, OpenClaw

### Key Conventions

- **Runtime**: Bun (package manager + runtime)
- **TypeScript**: Strict mode, composite project references
- **Port**: dev=7030, API E2E=17030, BDD E2E=27030
- **Testing**: Four-layer architecture (see docs/01-plan.md)
- **TDD**: Always write tests first, then implement
- **Commits**: Conventional Commits, atomic, auto-commit after changes
- **`@pew/core` is NOT published**: Pure types, `import type` only, `devDependencies`
- **Raw data is READ-ONLY**: Never modify, delete, or move user's local AI tool log files (`~/.claude/`, `~/.gemini/`, `~/.local/share/opencode/`, `~/.openclaw/`). Pew only reads these files. Write operations are limited to Pew's own state files under `~/.config/pew/`.

## CLI Dev Workflow

```bash
# Build all packages (core types → CLI → web → worker)
bun run build

# Start dev server (port 7030)
bun run --filter '@pew/web' dev

# Run sync against dev server
NODE_TLS_REJECT_UNAUTHORIZED=0 bun packages/cli/dist/bin.js sync --dev

# Full reset sync (delete cursors + queue, then sync)
rm -f ~/.config/pew/cursors.json ~/.config/pew/queue.jsonl ~/.config/pew/queue.state.json
NODE_TLS_REJECT_UNAUTHORIZED=0 bun packages/cli/dist/bin.js sync --dev
```

### State Files

- `~/.config/pew/config.json` — prod API key (`pk_...`)
- `~/.config/pew/config.dev.json` — dev API key
- `~/.config/pew/cursors.json` — per-file byte offsets + dir mtimes (shared across dev/prod)
- `~/.config/pew/queue.jsonl` — pending upload records
- `~/.config/pew/queue.state.json` — upload queue metadata

## npm Publish Procedure

CLI package `@nocoo/pew` is published to npm. Steps:

1. **Bump version** — ALL `package.json` files + `packages/cli/src/cli.ts` (`meta.version`)
2. **Build** — `bun install && bun run build`
3. **Test** — `bun run test`
4. **Dry-run** — `npm publish --dry-run` in `packages/cli/`
5. **Publish** — `npm publish` in `packages/cli/`
6. **Verify** — `npx @nocoo/pew@latest --help`
7. **Commit & push** — Triggers Railway auto-deploy for web
8. **Tag & release** — `git tag vX.Y.Z && git push origin vX.Y.Z`

## Retrospective

- **D1 REST API has no batch endpoint**: The `/query` endpoint only accepts a single `{ sql, params }` object. Sending an array (like the Workers Binding `db.batch()`) returns "Expected object, received array". Unit tests with mocked fetch won't catch this — only E2E tests against real D1 reveal it. Fix: send statements individually in a loop.
- **Next.js dev server modifies `next-env.d.ts` and `tsconfig.json`**: Running `next dev` with `NEXT_DIST_DIR=.next-e2e` overwrites these files to reference `.next-e2e`. Always `git checkout` these after E2E runs to avoid committing noise.
- **D1 SQLite param limit is 999, not 3400**: Multi-row INSERT with 300 rows × 9 cols = 2700 params triggers `SQLITE_ERROR: too many SQL variables`. The safe maximum is ~100 rows (900 params). We use CHUNK_SIZE=20 (180 params) for comfortable headroom. Only production D1 reveals this — L1 mocks and local SQLite may have different limits.
- **Worker migration eliminated REST API bottleneck**: The D1 REST API had no batch endpoint and rejected multi-row INSERTs beyond ~5 rows, requiring 60 sequential HTTP calls for 300 records. Migrating to a Cloudflare Worker with native D1 bindings (`env.DB.batch()`) reduced this to a single HTTP call with implicit transactional semantics. D1 Free plan limits 50 queries per Worker invocation, so batch size was reduced from 300 to 50. The Worker handles writes only; reads still use the REST API from Next.js.
- **Railpack cannot use `bun install` for Bun workspaces**: Even with `bun.lock` tracked in git and "Bun runtime detected" in Railpack output, the install step still uses `npm install`, which fails on `workspace:*` protocol. Fix: use a custom Dockerfile with `oven/bun:1` base image and `bun install --frozen-lockfile`.
- **Railway watch patterns block `railway up` deploys**: When watch patterns are set (e.g. `packages/web/**`), `railway up` compares against the previous deploy's files and skips the build if no matching files changed — even on the first successful deploy. Fix: clear watch patterns when using `railway up` or Dockerfile builder.
- **Next.js `next build` evaluates server modules at build time**: During "Collecting page data", Next.js imports API route modules and evaluates top-level code. If `getD1Client()` is called at module scope (e.g. in `auth.ts` adapter config), it throws when env vars are missing. Fix: use Docker `ARG` directives to pass Railway env vars into the build stage. Railway automatically injects service variables as Docker build args.
- **Railway `startCommand` overrides Dockerfile `CMD`**: Even after switching builder to DOCKERFILE, the previously-set `startCommand` persists and overrides the Dockerfile's `CMD`. This caused "executable `bun` could not be found" because the runner image was `node:22-slim`. Fix: explicitly clear `startCommand` to empty string via `railway environment edit`.
- **Next.js 16 `proxy.ts` matcher must exclude API routes**: The `proxy.ts` convention (replaces `middleware.ts`) runs on all matched routes. If the matcher doesn't exclude `/api/*`, Auth.js's `auth()` wrapper redirects unauthenticated GET requests to `/login` before the route handler can check Bearer tokens via `resolveUser()`. POST requests to routes with explicit handlers may still work, making the bug intermittent. Fix: add `api/(?!auth)` to the matcher's negative lookahead so API routes bypass the proxy and handle auth themselves.
- **npm publish requires fresh build**: v0.6.0 was published with stale `dist/` artifacts (version string showed v0.5.0) because `bun run build` was not re-run after bumping the version. The publish procedure step 2 (`bun install && bun run build`) must never be skipped — always verify `dist/cli.js` contains the correct version string before `npm publish`.
- **Next.js standalone output excludes `public/` directory**: When using `output: "standalone"`, Next.js does NOT include the `public/` folder in the standalone output (by design — intended for CDN serving). In a Dockerfile, you must manually `COPY --from=builder /app/packages/web/public ./packages/web/public` alongside the `.next/standalone` and `.next/static` copies. Without this, `<Image src="/logo.png">` triggers `/_next/image?url=%2Flogo.png` which returns 400 because the optimization API can't find the source file on disk. This bug is invisible in `next dev` (reads `public/` from source tree) and only manifests in production Docker containers. The same applies to any static assets in `public/` — favicons served via file-based metadata (`icon.png`, `apple-icon.png`) in `src/app/` are fine since they're compiled into `.next/`, but anything referenced by `<Image>` with a string `src` prop needs the `public/` copy.
- **NextAuth lazy-init `auth()` wrapper must not be called at module scope in proxy.ts**: With the `NextAuth((req) => config)` lazy-init pattern, calling `auth((req) => {...})` at module top level and storing the result in a `const` can produce a non-function value in Turbopack production builds (the minified error is `sZ is not a function`). This works fine in dev mode because Turbopack evaluates modules differently. Fix: move the `auth(callback)` call inside the `proxy()` function body so it executes at request time, not module evaluation time. The per-request overhead is negligible since NextAuth caches the resolved config after the first call.
- **NextAuth lazy-init `auth(callback)` returns a Promise, not a Function**: When using `NextAuth((req) => config)` (lazy-init pattern), the `initAuth()` function in `next-auth/lib/index.js` returns an `async` function (line 42). When `auth` is called with a callback like `auth((req) => {...})`, the `isReqWrapper` branch (line 60-69) returns a new function — but because the outer function is async, the actual return value is `Promise<Function>`, not `Function`. Calling it without `await` gives `TypeError: authHandler is not a function`. Fix: `const authHandler = await auth((req) => {...})`. This only affects the lazy-init pattern; the static config pattern (`NextAuth({...})`) returns a sync function where `auth(callback)` works without await.
- **`request.url` in Docker containers uses internal hostname, not public domain**: In API route handlers, `new URL(request.url)` resolves to the container's internal URL (e.g. `http://0.0.0.0:8080`) when behind a reverse proxy (Railway). Using `url.origin` for redirects sends users to the internal address. Fix: read `x-forwarded-host` / `x-forwarded-proto` headers first, fall back to `NEXTAUTH_URL`, then finally `request.url`. This pattern is already used in `proxy.ts` (`buildRedirectUrl`) but must also be applied in any API route that constructs redirect URLs (e.g. `/api/auth/cli`). The `getPublicOrigin(request)` helper encapsulates this logic.
- **VSCode Copilot research: verify raw data before writing conclusions**: The initial doc/17 research spike made two errors that required correction: (1) Token counts were wrong (reported 30/25/5 but actual data was 31/25/3/2/1) because the audit script conflated "empty result" with "result without tokens" and missed the "no result line" category entirely. The causal claim that missing-token requests were "non-billable incomplete turns" was false — 3 of them had 40+ tool-call results and 10+ minutes of elapsed time. (2) The "no full CRDT replay needed" optimization advice was unsafe for incremental sync — `kind=1` result lines only carry a request index, not `modelId`/`timestamp`, so resuming from a byte offset without persisting the index→metadata mapping makes correlation impossible. Lesson: always run the actual audit queries against real data and verify every number before committing; design advice must account for the full read lifecycle (first parse + incremental resume), not just the happy path.
