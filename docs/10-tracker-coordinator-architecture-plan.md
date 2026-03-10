# 10. Phase 1: Tracker / Coordinator Architecture (COMPLETED)

> **Status**: Phase 1 completed (2026-03-10). Run Log deferred to Phase 2 (docs/11).
> **Implementation**: docs/10b (notifier hooks, all 12 steps complete).

## Background

pew's CLI started as a manual `pew sync` tool. As the project matured, we identified the need for a thin coordinator layer to support automatic, hook-driven sync from AI tools without the coupling and debugging problems seen in vibeusage.

This document was the original architecture plan. Phase 1 has been implemented; remaining phases are tracked in docs/11.

## Design Goals

- **Modular**: trigger, coordination, discovery, collection, queue, upload — clearly separated
- **Testable**: every layer unit-testable without real hooks / watchers / network
- **Idempotent**: repeated triggers don't cause duplicate accounting
- **Debuggable**: every sync run should produce a structured log explaining what happened
- **Thin coordinator**: coordinator only handles scheduling and concurrency, not business parsing
- **Registry-driven**: source capabilities declared in one place (future phase)

## Six-Layer Target Architecture

The plan converges on six layers:

1. **Trigger Layer** — receives CLI / hook / scheduled signals, emits `SyncTrigger`
2. **Coordinator Layer** — scheduling, throttle, file-lock mutex, run lifecycle
3. **Discovery / Plan Layer** — generates `ScanPlan` for the current run (future)
4. **Collector Layer** — executes source tasks, produces token/session changes (future)
5. **Queue / State Layer** — durable state, cursors, dedup keys (future: staged commit)
6. **Upload Layer** — consumes queue, reports to SaaS

## Phase 1 Implementation Status

### Trigger Layer — DONE

Unified `SyncTrigger` type in `@pew/core`:

```ts
type SyncTrigger =
  | { kind: "manual"; command: string }
  | { kind: "notify"; source: Source; fileHint?: string | null }
  | { kind: "startup" }
  | { kind: "scheduled" };
```

Triggers do not call parsers or write cursors directly. They only submit events to the coordinator.

**Files**: `packages/core/src/types.ts`

### Coordinator Layer — DONE (except Run Log)

| Capability | Status | Details |
|-----------|--------|---------|
| File-lock mutex (`sync.lock`) | DONE | `flock(LOCK_EX)` via `FileHandle.lock()`, non-blocking attempt first, then blocking with timeout |
| Signal-based debounce (`notify.signal`) | DONE | Waiters append to signal file; holder truncates before each cycle |
| Dirty follow-up | DONE | After sync, check signal size; if > 0, run another cycle (up to `maxFollowUps=3`) |
| runId generation | DONE | `ISO-timestamp-randomSuffix` format |
| Graceful degradation | DONE | Falls back to unlocked sync when `FileHandle.lock()` unavailable |
| Lock timeout | DONE | Configurable (default 60s), returns `skippedSync: true` on timeout |
| **Run Log** | **DEFERRED** | Moved to Phase 2 (docs/11) |

**Files**: `packages/cli/src/notifier/coordinator.ts`
**Tests**: `packages/cli/src/__tests__/coordinator.test.ts` (16 tests)

### Notifier Hooks — DONE (all 5 sources)

| Source | Mechanism | Driver |
|--------|-----------|--------|
| Claude Code | `settings.json` SessionEnd hook | `claude-hook.ts` |
| Gemini CLI | `settings.json` SessionEnd hook + `enableHooks` | `gemini-hook.ts` |
| OpenCode | JS plugin (`pew-tracker.js`) listening to `session.updated` | `opencode-plugin.ts` |
| OpenClaw | Full plugin scaffold + `openclaw plugins install --link` | `openclaw-hook.ts` |
| Codex CLI | TOML `config.toml` notify field, with original-notify backup/chain | `codex-notifier.ts` |

Supporting infrastructure:
- `notify-handler.ts` — generates shared `notify.cjs` CJS script invoked by all hooks
- `registry.ts` — driver registry with `installAll`, `uninstallAll`, `statusAll`
- `paths.ts` — resolves all notifier paths with env var overrides

**CLI commands**: `pew init`, `pew uninstall`, `pew notify`
**Tests**: 9 test files covering all drivers, registry, handler, paths, init, uninstall, notify

Full implementation details: docs/11.

### CLI Commands — DONE

| Command | Description | Status |
|---------|-------------|--------|
| `pew sync` | Full token + session sync, optional auto-upload | DONE |
| `pew status` | Show tracked files, last sync, pending uploads, hook status | DONE |
| `pew login` | Browser-based OAuth, saves API key | DONE |
| `pew notify` | Coordinated sync from AI tool hooks | DONE (session sync gap — see docs/11) |
| `pew init` | Install notifier hooks for all/specific sources | DONE |
| `pew uninstall` | Remove notifier hooks | DONE |

### Parsers — DONE (all 5 sources, tokens + sessions)

Token parsers: `claude.ts`, `codex.ts`, `gemini.ts`, `opencode.ts`, `opencode-sqlite.ts`, `openclaw.ts`
Session parsers: `claude-session.ts`, `codex-session.ts`, `gemini-session.ts`, `opencode-session.ts`, `opencode-sqlite-session.ts`, `openclaw-session.ts`

### Discovery — DONE

Shared discovery functions in `discovery/sources.ts` used by both token and session sync.

### Storage — DONE (at-most-once semantics)

- `CursorStore` / `SessionCursorStore` — per-file byte-offset / mtime cursors
- `LocalQueue` / `SessionQueue` — append-only JSONL with byte-offset upload tracking
- Cursor saved before queue write (at-most-once: crash = lost data, never duplicated)

### Upload — DONE

- `upload-engine.ts` — generic engine with batching (50/req), retry, rate-limit handling
- `upload.ts` — token upload with aggregation preprocessing
- `session-upload.ts` — session upload with dedup preprocessing

### Web Dashboard & Worker — DONE

- Next.js 16 dashboard with all pages (overview, apps, models, details, sessions, leaderboard, settings, admin)
- Cloudflare Worker with D1 bindings for token + session ingest with upsert semantics

## Known Gaps Carried to Phase 2

These issues were identified during Phase 1 and are addressed in docs/11:

1. **No persistent Run Log** — `CoordinatorRunResult` is returned to caller but never written to disk. Cannot debug "why did this notify produce nothing?"

2. **`pew notify` skips session sync** — `executeNotify` only calls `executeSync` (tokens), missing `executeSessionSync`. Hook-driven sync only produces token data.

3. **`executeSyncFn` discards results** — Coordinator's `executeSyncFn: (triggers) => Promise<void>` signature means `SyncResult` / `SessionSyncResult` are lost. Run log needs these.

## Future Architecture Phases (Summary)

Detailed plans will be written when each phase begins.

| Phase | Focus | Status |
|-------|-------|--------|
| **Phase 2** | Run Log + notify session sync fix | **Next** (docs/11) |
| **Phase 3** | Shared Discovery / Plan Builder | Planned |
| **Phase 4** | Unified Source Registry (`SourceDriver`) | Planned |
| **Phase 5** | Staged Queue + at-least-once semantics | Planned |
| **Phase 6** | Tracker-driven default + diagnostic commands (`pew runs`, `pew doctor`) | Planned |

### Phase 3: Discovery / Plan Layer

Extract a shared `ScanPlan` builder so token and session sync share a single discovery pass instead of each doing independent file enumeration.

### Phase 4: Source Registry

Unify all source capabilities (paths, discovery, token parser, session parser, notifier, status display) into a single `SourceDriver` interface. Currently only notifier capabilities are in a registry.

### Phase 5: Staged Queue + Idempotent Runs

Switch from at-most-once (cursor-before-queue) to at-least-once (staged run → commit → cursor advance). Requires idempotency keys and server-side upsert (already done).

### Phase 6: Tracker-Driven Default

Daily operation driven by hooks; `pew sync` becomes manual catch-up only. Add `pew runs` (browse run logs) and `pew doctor` (health diagnostics) commands.
