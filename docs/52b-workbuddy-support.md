# 52 — WorkBuddy Support

**Status:** done — token + session sync shipped together.
**Source slug:** `workbuddy` · **Display name:** WorkBuddy
**Data root:** `~/.workbuddy` (domestic) and `~/.workbuddy-ai` (international) —
sessions at `projects/<slug>/<sessionId>.jsonl` under either root

WorkBuddy is Tencent's desktop AI agent (CodeBuddy engine). It writes one
append-only JSONL file per session, with per-request usage on the
`providerData` of `function_call` and `message` records.

Verified against both editions on 5.7.6 (domestic `~/.workbuddy` /
`www.workbuddy.cn`, international `~/.workbuddy-ai` / `www.workbuddy.ai`,
same build): identical on-disk layout and usage shapes. Newly created sessions
on the 5.7.6 installs carry a `session-meta` row and a top-level `_meta`
tracing block; sessions carried over from the earlier (5.5.x) installs do not,
so their presence tracks session creation rather than the build alone. Observed
models differ by edition — `hy4-preview` / `space-bunny` domestically,
`deepseek-v4.1-flash` internationally — and none of these ids are in the
OpenRouter/models.dev price baseline, so pricing uses the `workbuddy` source
fallback.

## 1. Data model (verified against a live install)

```
~/.workbuddy/projects/<slug>/<sessionId>.jsonl              ← the session transcript
~/.workbuddy/projects/<slug>/<sessionId>.meta.json          ← ACP connection metadata, no usage
~/.workbuddy/projects/<slug>/<sessionId>.file-rollback.ndjson
~/.workbuddy/projects/<slug>/subagents/agent-*.jsonl        ← subagent transcripts (excluded; community-reported, absent on the verified install)
~/.workbuddy/projects/<slug>/<sessionId>/tool-results/*.txt ← tool output (excluded)
~/.workbuddy/workbuddy.db                                   ← sessions/session_usage sidecar (not read)
```

`<slug>` is the workspace `cwd` with the leading `/` dropped and the remaining
`/` replaced by `-` (spaces are kept); the session id is the file stem and also
the `sessionId` field on nearly every record.

| `type` | carries usage | notes |
| --- | --- | --- |
| `function_call` | **yes** | usually one usage row per request; a request may repeat its `messageId` across sibling rows, only one of which carries usage |
| `message` | **yes** (assistant rows only) | user rows carry no usage; 5.7.6 tags the user-prompt row with `providerData.startsNewUserRequest: true` |
| `reasoning` | no | |
| `function_call_result` | no | links to its call via `callId` |
| `file-history-snapshot` | no | no `sessionId` — must not be counted as a message |
| `ai-title` | no | session title, may appear mid-file; carries a `sessionId`, excluded from session counts by type |
| `session-meta` | no | 5.7.6+ status row (e.g. `codebuddy.ai/hostKind`); carries a `sessionId` and its own timestamp, excluded from session counts and bounds by type |

### The three usage shapes are the same numbers

A usage row carries `providerData.rawUsage` (OpenAI-shaped, richest),
`providerData.usage` (camelCase summary) and `message.usage`. On a live install
all three agree field-for-field on every record; the parser reads `rawUsage`
first and falls back to the others.

### Two traps

1. **Cache-read decoys.** `rawUsage.cache_read_input_tokens` and top-level
   `rawUsage.cached_tokens` are stale zeros. The live value is
   `prompt_cache_hit_tokens` (equivalently `prompt_tokens_details.cached_tokens`
   / `usage.inputTokensDetails[0].cached_tokens`). Reading the decoy reports a
   0 % cache-hit rate. The two decoy fields stay at the end of the read chain
   as a last resort for a build that fills no live alias; they are only
   consulted when every live alias reads 0, and a future build populating a
   decoy with a stale **nonzero** value while also filling a live alias cannot
   mislead — `firstPositive` takes the first alias in chain order.
2. **Inclusive counters.** `prompt_tokens == prompt_cache_hit_tokens +
   prompt_cache_miss_tokens`, and `completion_tokens` includes
   `completion_thinking_tokens` / `completion_tokens_details.reasoning_tokens`.
   Both must be split before they reach the disjoint buckets. When
   `prompt_cache_miss_tokens` is absent, the miss is derived as
   `prompt − read`; this assumes the cache-write counter (when present) is
   already part of the miss total and not an add-on, matching how the golden
   install reports `write = 0`.

### Dedup key

`providerData.messageId` — exactly one usage row per request on a live install,
and ids do not repeat across files. `conversationRequestId` and `traceId` are
**turn-scoped** (each takes only 6 distinct values across the 68 requests, and
they differ on 29 of the rows) and must never be counted as requests. Records
repeating a `messageId` are dropped per parse, which is a no-op on today's
builds but guards reported repeats in other versions.

The same key dedups **across files and across syncs**. Within one sync every
id counts once across both roots: `preload()` lifts each cursor's persisted
ring into a shared set on the `SyncContext` (`seenWorkbuddyMessageIds`) before
any file is parsed, and the last 2000 emitted ids per file are written back
onto the cursor (`WorkbuddyCursor.seenMessageIds`) so a session copied between
`~/.workbuddy` and `~/.workbuddy-ai` — or duplicated into a sibling file — is
not counted a second time. The ring is bounded at 2000 ids, so cross-sync dedup
is exact only while a session stays within that window: an id older than the
last 2000 that reappears in a *later* sync (a copy of a >2000-request session
appearing after the original was synced) is counted again. When the two roots
carry the *same* id with *different* values (e.g. one copy was edited), the
first file in discovery order wins and the other is deduped; discovery sorts
all paths lexicographically, and `~/.workbuddy-ai` (hyphen) sorts before
`~/.workbuddy` (slash), so the international copy wins — but only when both
copies are new in the *same* sync. If the domestic copy was already counted in
an earlier sync, its persisted ring suppresses the international copy instead,
and the domestic value is the one that stays. Moving or renaming a project
slug directory gives the file a new cursor path, so ids outside the 2000-id
ring are summed once more; a root that temporarily disappears (unmounted
volume, paused sync tool) loses its cursors to the alias pruner and is
re-summed from scratch when it returns — the accounting layer's idempotent
bucket merge keeps the queue values stable in that case. A cursor written
before the ring existed has no `seenMessageIds` field; `needsReplay()` flags it
so the orchestrator restarts that sync as a full scan (an incremental re-parse
would double the file's historical buckets in the append queue).

### Model and time

- Pricing key: `providerData.model` (e.g. `hy4-preview`); `requestModelName`
  is the human label and `requestModelId` mirrors `model`.
- `timestamp` is an **integer epoch in milliseconds**; a non-numeric timestamp
  means the row is not placeable and is skipped. The session parser is looser:
  it accepts an ISO string too (`Date.parse`), and drops a session entirely
  when no record yields a usable timestamp. Both parsers additionally require
  the resulting ISO string to satisfy the server's date rule (4-digit year),
  so a representable-but-far-future epoch cannot produce a record the server
  rejects with a 400.
- `rawUsage.credit` is an account-level resource, **0 for free/preview models**
  and not proportional to tokens — it is deliberately not mapped to cost.

## 2. Token plan

```
inputTokens            =  prompt_cache_miss_tokens + cache_creation_input_tokens
cachedInputTokens      =  prompt_cache_hit_tokens
outputTokens           =  completion_tokens − reasoning_tokens   (floored at 0)
reasoningOutputTokens  =  reasoning_tokens
```

Cache-creation tokens fold into the input bucket, matching the Claude
normalizer; they are 0 on the observed install. `prompt_cache_write_tokens` is
accepted as a `cache_creation_input_tokens` alias, and a missing
`prompt_cache_miss_tokens` falls back to `prompt_tokens − cache read`. When
`includeAccounting` is set, the delta carries an `inclusiveAccounting` group
with `origin: "workbuddy:usage"` and `request_count: 1`, plus a `counts` group
carrying `cache_read_input_tokens` / `cache_write_input_tokens`; the raw
`total_tokens` is passed in as the `rawTotal` diagnostic input, and is emitted
only as `diagnostics[].raw_total_tokens` when the counts do not reconcile.

**Golden verification** (live install, both roots, 5 files): 68 requests;
prompt total 4 267 488 = cache read 3 814 535 + uncached 452 953;
completion 122 069 = visible output 53 211 + reasoning 68 858. The parser
reproduces all of these exactly, and the per-bucket sum reconciles with the
raw `total_tokens` (4 389 557).

## 3. Session plan

One JSONL file → one snapshot (records still group by their own `sessionId` if
a file carries more than one).

- `sessionKey`: `workbuddy:<sessionId>` (prefixed, unlike Grok's bare id, to
  keep the global `session_key` dedup collision-free).
- `kind`: `human`.
- `totalMessages`: every message-bearing row (tool calls, reasoning and
  results included); `ai-title`, `file-history-snapshot` and `session-meta`
  rows are excluded by type — the title and session-meta rows carry a
  `sessionId` on live installs, so filtering on session id alone would count
  them. `userMessages` / `assistantMessages` count `type: "message"` rows by
  role; on 5.7.6 the user prompt is a `role: "user"` row tagged
  `providerData.startsNewUserRequest: true` and carrying no usage, so it
  counts as a user message like any other.
- Bounds from min/max epoch-ms timestamps; `projectRef` = `hashProjectRef(cwd)`;
  `model` = last seen `providerData.model`.

## 4. Accepted limitations

- **Subagent transcripts are excluded.** `projects/<slug>/subagents/agent-*.jsonl`
  are not read; discovery stops at depth 2 by design. Community trackers
  disagree on attribution (some roll them into the parent session) and no
  subagent sample was available to verify against.
- **No cost from logs** (see `credit` above); pricing uses model-id matching
  plus the `workbuddy` source fallback in the web pricing table.
- **No notifier hook** — like Grok and ZCode, WorkBuddy syncs on `pew sync`.
- **No usage-evidence records** — the per-request objects are complete, and
  the evidence ledger is currently gated to `pi`/`hermes`.
- **Dedup needs a `messageId`.** Cross-file/cross-sync dedup keys on
  `providerData.messageId`; a usage row that lacks a usable id is counted
  unconditionally, so a session duplicated into another file or root would
  double-count those rows. On the verified installs every usage row carries an
  id, so this is a guard for other builds, not an observed gap.
- **Prune drops the ring with the cursor.** If a session file (and every
  copy of it across both roots) is deleted for long enough for the alias
  pruner to drop its cursor, the ring dies with it: any copy reappearing
  later is summed from scratch. This is the upstream pruner's documented
  one-cycle trade-off; WorkBuddy only widens the surface, because copies
  moving between the two roots are expected.
- **Continuity handling is the shared JSONL one.** WorkBuddy opts into the
  common same-inode continuity path (`usesJsonlOffsetResume`); a tail-trim or
  in-place rewrite is rebased through the shared anchors, not WorkBuddy-specific
  logic. Whatever that path does for Claude/Codex applies here unchanged.
- **Retiring WorkBuddy takes two coordinated changes.** The slug-based
  mechanisms (server-side `isRetiredSourceRecord` exemption, reset's
  session-queue retention, notify's early return) all activate from
  `RETIRED_SOURCES` alone, but cursor cleanup does not: cursor retirement
  also needs a `\.workbuddy` branch in the `isRetiredCursorPath` regex
  (`utils/retired-sources.ts`), and that branch only ever matches once
  `workbuddyDirs` is removed from `utils/paths.ts` — while `paths.ts` still
  exposes the roots, they count as active paths and the regex is exempted.
  The six retired v3.3.0 sources went through exactly this pairing; a future
  WorkBuddy retirement must repeat it, and any future cursor migration must
  not "normalize" an empty-epoch cursor by filling in `seenMessageIds: []` —
  the absence of the field is load-bearing (see the sync driver's
  `isLegacyCursor` and the empty-epoch note in `commands/sync.ts`).

## 5. Changes in this support

| Area | Files |
| --- | --- |
| Core | `packages/core/src/types.ts`, `constants.ts` |
| Parser | `packages/cli/src/parsers/workbuddy.ts`, `workbuddy-session.ts` |
| Discovery | `packages/cli/src/discovery/sources.ts` (`discoverWorkbuddyFilesFromRoots`) |
| Drivers | `drivers/token/workbuddy-token-driver.ts`, `drivers/session/workbuddy-session-driver.ts`, `registry.ts` |
| CLI wiring | `commands/sync.ts`, `session-sync.ts`, `session-sync-helpers.ts`, `status.ts`, `notify.ts`, `enrich.ts`, `cli.ts`, `drivers/types.ts`, `utils/paths.ts`, `utils/continuity-anchor.ts`, `utils/jsonl-shared-state.ts`, `utils/time.ts`, `storage/accounting-queue.ts` |
| Web | `lib/palette.ts` (+ `chart-16`), `app/globals.css`, `lib/usage-transforms.ts`, `lib/pricing.ts`, `__tests__/source-filter-parity.test.ts`; the four `?source=` routes (`api/{usage,sessions,leaderboard,users/[slug]}`) gate on core's `VALID_SOURCES` (they already did upstream — the new parity test pins that so a route can't drop to a hardcoded list); the landing agent list derives from core's `SOURCES` and the harness list from `VALID_SOURCES`, while `usage-transforms.ts`/`palette.ts` are hand-written maps that `Record<Source, …>` keeps in sync at compile time; `api/admin/usage/compare` also reads `?source=` but passes it straight into SQL with no allowlist |
| Docs | `README.md`, `docs/README.en.md`, `docs/README.md`, `AGENTS.md`, `PRIVACY.md`, `CHANGELOG.md`, this doc |

## 6. Test coverage

- `__tests__/workbuddy-parser.test.ts` — normalization (both traps, cache-write
  folding, reasoning saturation, invalid input), dedup, record filtering,
  epoch-ms timestamps, incremental offset, trailing partial-line round-trip,
  accounting.
- `__tests__/workbuddy-session.test.ts` — counts, bounds, hashed project ref,
  multi-session grouping.
- `__tests__/discovery.test.ts` — depth-2 discovery, subagent/tool-output exclusion.
- `__tests__/drivers/{token,session}/workbuddy-*-driver.test.ts` — discover and
  fast-skip in both; the token driver additionally covers incremental append,
  cursor build, the dedup ring and inode reset (the session driver is a
  full-scan driver with no `resumeState`).
- `drivers/registry.test.ts` — registration counts (8 token / 8 session file drivers).
- CLI wiring: `status.test.ts` (cursor classification, domestic + international
  roots), `session-sync-helpers.test.ts` (`sourceKey` mapping),
  `continuity-anchor.test.ts` (`usesJsonlOffsetResume`), `paths.test.ts`
  (dual data roots), `discovery.test.ts` (multi-root merge + inode dedup),
  `sync.test.ts` (the empty-epoch cursor is not double-counted on truncate +
  refill; a persistently-empty or mtime-touched empty file keeps a stable
  cursor instead of oscillating into a full rescan; `preload()` runs before
  the per-file loop so a fast-skipped file still suppresses cross-file
  duplicates), `codex-shared-state.test.ts` (`seenWorkbuddyMessageIds` rollback),
  `cli.test.ts`/`cli-entry.test.ts`/`session-sync.test.ts` (source lists),
  `accounting-queue.test.ts` (a workbuddy-sourced record is accepted).
- Core: `constants.test.ts` (10 active sources, sorted; 16 with retired
  identities in `VALID_SOURCES`), `types.test.ts`,
  `validation.test.ts` (both `validateIngestRecord` and
  `validateSessionIngestRecord` accept all 16 sources, workbuddy included).
- Web: `palette.test.ts`, `source-label.test.ts`, `source-filter-parity.test.ts`
  (every `?source=` route accepts all of core's sources and rejects others),
  `leaderboard.test.ts`,
  `pricing.test.ts`, `usage.test.ts`, `sessions.test.ts` (source filters incl.
  `workbuddy`), `e2e/api-e2e.test.ts` (every `?source=` entry point).
- Parser hardening: `__tests__/workbuddy-length-caps.test.ts` — over-long
  `model` rows and sessions whose `workbuddy:<id>` key exceeds
  `MAX_STRING_LENGTH` are dropped locally instead of queueing a record the
  server would 400 (the upload engine does not retry or skip a 4xx), and
  timestamps outside the server's 4-digit-year ISO window are dropped the
  same way. `__tests__/workbuddy-timestamp-gate.test.ts` pins the two gaps
  that window left open: the session parser's ISO-string timestamps are
  gated on the same 4-digit-year rule (Date.parse accepts extended years
  like `+275760-…`), and a row dropped by the gate does not claim its
  `messageId` slot, so a corrected rewrite of the same request — appended
  in the same parse or in a later sync — still counts.
  `__tests__/workbuddy-record-caps.test.ts` — over-cap token buckets and
  over-cap session durations are dropped locally (with the exact-at-cap
  boundaries kept), matching the server's ingest limits and antigravity's
  parser-level precedent. Should a WorkBuddy record ever be rejected
  server-side anyway (a server older than this support, or a future
  stricter check), the 4xx stalls that upload batch — moving `~/.workbuddy*`
  aside restores uploads for every other source on the next sync.
- L3 (browser): `packages/web/e2e/bdd/leaderboard.spec.ts` — the harness
  source dropdown count is derived from `VALID_SOURCES.size` (not a
  hardcoded number), and the landing page must not surface retired
  sources.

## 7. References

- Community parsers that corroborate the format: `fuyi-git/token-dashboard`,
  `majiabin2020/workbuddy-token-dashboard`, `selennac/workbuddy-token-dashboard`,
  `Jimmy-ai-studio/workbuddy-usage-stats`, `changexbc/workbuddy-switch`.
- Sibling support docs: [42-grok-support.md](42-grok-support.md),
  [43-zcode-support.md](43-zcode-support.md), [46-omp-support.md](46-omp-support.md).
