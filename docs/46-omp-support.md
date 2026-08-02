# 46 — Oh My Pi (omp) Support

**Status:** done
**Source slug:** `omp` · **Display name:** Oh My Pi

## 1. What omp is

[Oh My Pi](https://omp.sh) (`@oh-my-pi/pi-coding-agent`, binary `omp`) is a fork of
Pi (`pi-coding-agent`). It keeps pi's on-disk session format verbatim, which makes
support a wiring exercise rather than a new parser.

| | Pi | omp |
|---|---|---|
| Sessions root | `~/.pi/agent/sessions` | `~/.omp/agent/sessions` |
| Layout | `<encoded-cwd>/<ISO>_<uuidv7>.jsonl` | same |
| Session header | `{type:"session", version:3, id, timestamp, cwd}` | same |
| Assistant usage | `{input, output, cacheRead, cacheWrite, totalTokens, cost{…}}` | same |
| Extra usage keys | `reasoning`, `cacheWrite1h` | — |
| Extensions | `~/.pi/agent/extensions/*.ts` | `~/.omp/agent/extensions/*.ts` |
| Extension types pkg | `@mariozechner/pi-coding-agent` | `@oh-my-pi/pi-coding-agent` |

## 2. Token semantics (verified on real data)

The invariant below holds for **100 %** of assistant rows in both tools
(pi: 3276 rows, omp: 178 rows measured):

```
totalTokens === input + output + cacheRead + cacheWrite
```

So `input` **excludes** cache traffic. `normalizePiUsage()` maps this to pew's
`TokenDelta` without double counting:

| pi/omp field | pew field |
|---|---|
| `input + cacheWrite` | `inputTokens` |
| `cacheRead` | `cachedInputTokens` |
| `output` | `outputTokens` |
| — (hardcoded `0`) | `reasoningOutputTokens` |

`reasoning` is a **subset of `output`** (the identity above still holds on rows
where `reasoning > 0`), so folding it into `reasoningOutputTokens` would
double-count. It stays 0. omp does not emit the field at all.

**Cost is not imported.** omp records a per-message `cost` object from its own
provider pricing; pew recomputes cost from its own pricing map. The two can
disagree — e.g. omp prices `claude-opus-5` at `$5/M` in / `$25/M` out, while
pew's static table has no `claude-opus-5` entry and falls through to the `omp`
source default (`$3/$15`) unless dynamic pricing supplies one.

## 3. Implementation

Reuse, not duplication — `parsers/pi.ts` and `parsers/pi-session.ts` take a
`source` argument (default `"pi"`), and the omp drivers pass `"omp"`.

| Layer | File |
|---|---|
| Source enum | `packages/core/src/types.ts`, `constants.ts` |
| Path | `utils/paths.ts` → `ompSessionsDir` |
| Discovery | `discovery/sources.ts` → `discoverOmpFiles()` |
| Token driver | `drivers/token/omp-token-driver.ts` (byte-offset resume) |
| Session driver | `drivers/session/omp-session-driver.ts` (mtime+size full rescan) |
| Registry | `drivers/registry.ts` (gated on `ompSessionsDir`) |
| Orchestrators | `commands/sync.ts`, `session-sync.ts`, `status.ts`, `notify.ts` |
| Notifier hook | `notifier/omp-hook.ts` → `~/.omp/agent/extensions/pew-sync.ts` |
| Web | `lib/palette.ts` (chart-14 emerald), `usage-transforms.ts`, `pricing.ts`, 6 API allowlists, `leaderboard/agents`, landing roster |

No D1 migration: `source` is a plain `TEXT NOT NULL` column with no CHECK
constraint. Validation is centralised in `@pew/core`'s `VALID_SOURCES`.

## 4. `projectRef` does not collide with Pi

The two tools encode the cwd differently in the directory name:

```
pi   ~/.pi/agent/sessions/--Users-nocoo-workspace-personal-pew--/
omp  ~/.omp/agent/sessions/-workspace-personal-pew/
```

`extractProjectRef()` hashes `basename(dirname(path))`, so **the same repo
produces different `project_ref` values under `pi` and `omp`**. Grouping them
under one dashboard project requires a `project_aliases` entry per source.
This is intentional — project refs are privacy hashes, not paths, so they
cannot be normalised after the fact.

## 5. Notifier hook

omp's extension loader "walks native `.omp`/`.pi` extension capabilities, JS/TS
hook factories, the installed-plugin tree, and any configured paths", and
`ExtensionAPI.on()` declares `session_shutdown`. The installed extension is
byte-identical to pi's apart from the type-import package and `--source=omp`:

```ts
// PEW_OMP_HOOK — managed by pew, do not edit
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { spawn } from "node:child_process";

export default function (pi: ExtensionAPI) {
  pi.on("session_shutdown", async () => { /* spawn notify.cjs --source=omp */ });
}
```

`pew init` now installs 7 hooks (Claude Code, Codex, Gemini CLI, Oh My Pi,
OpenClaw, OpenCode, Pi).

## 6. Verification

`executeSync` run against a frozen copy of a real omp session file:

| | raw JSONL | pew |
|---|---|---|
| assistant rows | 178 | 178 deltas |
| `Σ totalTokens` | 30 633 341 | 30 633 341 |

Byte-exact, zero rows dropped. A second `executeSync` over the same state dir
yields 0 deltas (byte-offset cursor holds). `executeStatus` classifies the file
as `omp`; the session queue emits `session_key: "omp:<uuid>"`.
