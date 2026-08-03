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
| Extra usage keys | `reasoning`, `cacheWrite1h` | `reasoningTokens`, `cttl`, `orchestration` |
| Extensions | `~/.pi/agent/extensions/*.ts` | `~/.omp/agent/extensions/*.ts` |
| Extension types pkg | `@mariozechner/pi-coding-agent` | `@oh-my-pi/pi-coding-agent` |

## 2. Token semantics (verified on real data)

The invariant below holds for **100 %** of assistant rows measured in both
tools (pi: 3276 rows, omp: 178 rows):

```
totalTokens === input + output + cacheRead + cacheWrite
```

So `input` **excludes** cache traffic. Per omp's `Usage` declaration
(`@oh-my-pi/pi-catalog`), `totalTokens` additionally absorbs a provider-side
`orchestration` bucket when one is reported — no observed row carries it, and
pew does not import it.

`normalizePiUsage()` maps this to pew's `TokenDelta`:

| pi/omp field | pew field |
|---|---|
| `input + cacheWrite` | `inputTokens` |
| `cacheRead` | `cachedInputTokens` |
| `output - reasoning` | `outputTokens` |
| `reasoningTokens` (omp) / `reasoning` (pi) | `reasoningOutputTokens` |

Reasoning tokens are a **subset of `output`**, not an additional bucket — omp's
own type says *"Always a subset of `output` — non-reasoning output is
`output - reasoningTokens`"*. They are therefore **carved out of** `output`,
never added on top, so `total_tokens` (which sums all four pew fields) is
unchanged. The value is clamped to `output` so a malformed row cannot drive
`outputTokens` negative.

An absent field means *unknown*, not zero — providers that don't report
reasoning simply leave `outputTokens` whole. Anthropic is one of them, which
is why the initial `claude-opus-5` capture showed no reasoning at all; OpenAI
(`output_tokens_details.reasoning_tokens`) and Google (`thoughtsTokenCount`)
do populate it.

**Cost is not imported.** omp records a per-message `cost` object from its own
provider pricing; pew recomputes cost from its own pricing map. The two can
disagree — e.g. omp prices `claude-opus-5` at `$5/M` in / `$25/M` out, while
pew's static table has no `claude-opus-5` entry and falls through to the `omp`
source default (`$3/$15`) unless dynamic pricing supplies one.

## 3. Incremental cursor

`parsePiFile` streams raw bytes and advances the cursor **only past complete
`\n`-terminated lines**, with the read pinned to the `stat()` snapshot
(`end: size - 1`). Two failure modes this defends against:

- **Half-written trailing line.** A writer that has flushed only part of a
  line must not push the cursor past it — otherwise the completed line is
  never re-read and its usage is lost permanently.
- **Append during parse.** Bytes written after the `stat()` are outside this
  round's window, so they cannot be parsed under a cursor that predates them
  and then re-parsed next round (double counting).

Same shape as `parsers/grok.ts`. Regression tests for both live in
`__tests__/pi-parser.test.ts`.

## 4. Implementation

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

## 5. Sessions: nested agent transcripts

omp persists task-subagent and advisor turns as **nested** JSONL beside the
root session, each with its own `type: "session"` header:

```
<encoded-cwd>/<stem>.jsonl              root session          → kind "human"
<encoded-cwd>/<stem>/<AgentId>.jsonl    task subagent         → kind "automated"
<encoded-cwd>/<stem>/__advisor.jsonl    advisor (per omp docs)→ kind "automated"
```

- **Token discovery stays recursive.** omp's own `omp stats` "scans the session
  dir recursively", so subagent usage is real billed usage and must be counted.
- **Session discovery must not treat them as human sessions.** `locateSession()`
  detects a parent directory matching the root-session stem
  (`<ISO>Z_<uuid>`), marks the snapshot `kind: "automated"`, and hops one level
  up so `projectRef` hashes the `<encoded-cwd>` dir instead of the session
  stem. Without the hop every subagent would invent its own bogus project.
- **Agent-attributed prompts are not human turns.** omp persists advisor /
  subagent prompts as `user` messages tagged `attribution: "agent"`; they count
  toward `totalMessages` but not `userMessages`.

## 6. `projectRef` does not collide with Pi

The two tools encode the cwd differently in the directory name:

```
pi   ~/.pi/agent/sessions/--Users-nocoo-workspace-personal-pew--/
omp  ~/.omp/agent/sessions/-workspace-personal-pew/
```

So **the same repo produces different `project_ref` values under `pi` and
`omp`**. Grouping them under one dashboard project requires a
`project_aliases` entry per source. This is intentional — project refs are
privacy hashes, not paths, so they cannot be normalised after the fact.

## 7. Notifier hook

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

## 8. Verification

`executeSync` run against a frozen copy of a real omp session file:

| | raw JSONL | pew |
|---|---|---|
| assistant rows | 178 | 178 deltas |
| `Σ totalTokens` | 30 633 341 | 30 633 341 |

Byte-exact, zero rows dropped. A second `executeSync` over the same state dir
yields 0 deltas (byte-offset cursor holds). `executeStatus` classifies the file
as `omp`.

`executeSessionSync` against a live session that had spawned one subagent:

```
human     user=5 asst=233 project=f8d27980a2178454 key=omp:019fc4c0-…
automated user=0 asst=  3 project=f8d27980a2178454 key=omp:019fc4f2-…
```

Same `project_ref` for both, subagent flagged `automated`, its
`attribution: "agent"` prompt excluded from `user_messages`, and token
discovery still scanning both files.
