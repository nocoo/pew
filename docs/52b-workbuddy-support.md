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

`<slug>` is the workspace `cwd` with `/` replaced by `-`; the session id is the
file stem and also the `sessionId` field on nearly every record.

| `type` | carries usage | notes |
| --- | --- | --- |
| `function_call` | **yes** | usually one usage row per request; a request may repeat its `messageId` across sibling rows, only one of which carries usage |
| `message` | **yes** (assistant rows only) | user rows carry no usage |
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
   0 % cache-hit rate.
2. **Inclusive counters.** `prompt_tokens == prompt_cache_hit_tokens +
   prompt_cache_miss_tokens`, and `completion_tokens` includes
   `completion_thinking_tokens` / `completion_tokens_details.reasoning_tokens`.
   Both must be split before they reach the disjoint buckets.

### Dedup key

`providerData.messageId` — exactly one usage row per request on a live install,
and ids do not repeat across files. `conversationRequestId` and `traceId` are
**turn-scoped** (29 requests shared 3 of them) and must never be counted as
requests. Records repeating a `messageId` are dropped per parse, which is a
no-op on today's builds but guards reported repeats in other versions.

### Model and time

- Pricing key: `providerData.model` (e.g. `hy4-preview`); `requestModelName`
  is the human label and `requestModelId` mirrors `model`.
- `timestamp` is an **integer epoch in milliseconds**; a non-numeric timestamp
  means the row is not placeable and is skipped.
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

**Golden verification** (live install, 2 sessions): 29 requests;
prompt total 1 688 562 = cache read 1 417 984 + uncached 270 578;
completion 50 934 = visible output 19 098 + reasoning 31 836. The parser
reproduces all of these exactly.

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
  role.
- Bounds from min/max epoch-ms timestamps; `projectRef` = `hashProjectRef(cwd)`;
  `model` = last seen `providerData.model`.

## 4. Accepted limitations

- **Subagent transcripts are excluded.** `projects/<slug>/subagents/agent-*.jsonl`
  are not read; discovery stops at depth 2 by design. Community trackers
  disagree on attribution (some roll them into the parent session) and no
  subagent sample was available to verify against.
- **No cross-file dedup.** A forked/copied session that replays a parent's
  history into a new file would be counted once per copy. `messageId` is
  per-file; a fingerprint-based cross-file dedup is the fix if this is ever
  observed.
- **No cost from logs** (see `credit` above); pricing uses model-id matching
  plus the `workbuddy` source fallback in the web pricing table.
- **No notifier hook** — like Grok and ZCode, WorkBuddy syncs on `pew sync`.
- **No usage-evidence records** — the per-request objects are complete, and
  the evidence ledger is currently gated to `pi`/`hermes`.

## 5. Changes in this support

| Area | Files |
| --- | --- |
| Core | `packages/core/src/types.ts`, `constants.ts` |
| Parser | `packages/cli/src/parsers/workbuddy.ts`, `workbuddy-session.ts` |
| Discovery | `packages/cli/src/discovery/sources.ts` (`discoverWorkbuddyFilesFromRoots`) |
| Drivers | `drivers/token/workbuddy-token-driver.ts`, `drivers/session/workbuddy-session-driver.ts`, `registry.ts` |
| CLI wiring | `commands/sync.ts`, `session-sync.ts`, `session-sync-helpers.ts`, `status.ts`, `notify.ts`, `enrich.ts`, `cli.ts`, `drivers/types.ts`, `utils/paths.ts`, `utils/continuity-anchor.ts`, `storage/accounting-queue.ts` |
| Web | `lib/palette.ts` (+ `chart-15`), `app/globals.css`, `lib/usage-transforms.ts`, `lib/pricing.ts`, four `?source=` allowlists, landing + harness agent lists |
| Docs | `README.md`, `docs/README.en.md`, `AGENTS.md`, `PRIVACY.md`, this doc |

## 6. Test coverage

- `__tests__/workbuddy-parser.test.ts` — normalization (both traps, cache-write
  folding, reasoning saturation, invalid input), dedup, record filtering,
  epoch-ms timestamps, incremental offset, partial-line round-trip, accounting.
- `__tests__/workbuddy-session.test.ts` — counts, bounds, hashed project ref,
  multi-session grouping.
- `__tests__/discovery.test.ts` — depth-2 discovery, subagent/tool-output exclusion.
- `__tests__/drivers/{token,session}/workbuddy-*-driver.test.ts` — discover,
  fast-skip, incremental append, cursor build, inode reset.
- `drivers/registry.test.ts` — registration counts (12 token / 11 session file drivers).
- CLI wiring: `status.test.ts` (cursor classification, domestic + international
  roots), `session-sync-helpers.test.ts` (`sourceKey` mapping),
  `continuity-anchor.test.ts` (`usesJsonlOffsetResume`), `paths.test.ts`
  (dual data roots), `discovery.test.ts` (multi-root merge + inode dedup).
- Core: `constants.test.ts` (15 sources, sorted), `types.test.ts`,
  `validation.test.ts` (both source validators accept the new slug).
- Web: `palette.test.ts`, `source-label.test.ts`, `leaderboard.test.ts`,
  `e2e/api-e2e.test.ts` (every `?source=` entry point).

## 7. References

- Community parsers that corroborate the format: `fuyi-git/token-dashboard`,
  `majiabin2020/workbuddy-token-dashboard`, `selennac/workbuddy-token-dashboard`,
  `Jimmy-ai-studio/workbuddy-usage-stats`, `changexbc/workbuddy-switch`.
- Sibling support docs: [42-grok-support.md](42-grok-support.md),
  [43-zcode-support.md](43-zcode-support.md), [46-omp-support.md](46-omp-support.md).
