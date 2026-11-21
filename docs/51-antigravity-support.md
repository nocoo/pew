# Antigravity Accounting

## Scope

Source identity: `antigravity` (Antigravity CLI, `agy`, and Antigravity app/IDE).
The collector discovers `<conversation-id>.db` files across both default roots:
`~/.gemini/antigravity-cli/conversations/*.db` and
`~/.gemini/antigravity/conversations/*.db` (overridable via `PEW_ANTIGRAVITY_DIRS`,
separated by the OS path delimiter). Missing individual roots are skipped while
duplicate conversation IDs across roots fail closed. Quota APIs, credentials,
generated transcripts and conversation bodies are not collection sources. The
former Gemini CLI collector has been retired; its historical records remain
separate from Antigravity data.

Token and session data use the existing aggregation, queue,
upload and typed dashboard pipelines. Automatic session-end synchronization is
not supported; run `pew sync`. Native SQLite requires a supported Bun runtime
or a recent Node.js version; Node.js 24 or newer is recommended.

## Verified Wire Contract

The field names were verified against the installed CLI's embedded Protobuf
descriptors, not inferred from integer sizes or upstream comments. Tests use
synthetic messages and databases only.

| Message | Field | Meaning |
| --- | --- | --- |
| `CortexStepMetadata` | 1 | `created_at`, Protobuf UTC Timestamp |
| `CortexStepMetadata` | 9 | `ModelUsageStats` |
| `CortexStepMetadata` | 12 | `turn_id`, UTF-8 string |
| `CortexStepGeneratorMetadata` | 2 | Repeated `step_indices`, packed or unpacked |
| `CortexStepGeneratorMetadata` | 1 | `ChatModelMetadata` |
| `ChatModelMetadata` | 4 | `ModelUsageStats` |
| `ChatModelMetadata` | 19 | Actual `response_model` string |
| `ModelUsageStats` | 1 | Model enum, **not system-prompt tokens** |
| `ModelUsageStats` | 2 | Non-cache-read input tokens |
| `ModelUsageStats` | 3 | Total output, including reasoning |
| `ModelUsageStats` | 4 | Cache-write tokens |
| `ModelUsageStats` | 5 | Cache-read tokens |
| `ModelUsageStats` | 9 | Thinking output tokens |
| `ModelUsageStats` | 10 | Visible response output tokens |

Generation indices and step indices are different namespaces. Attribute actual
model names by the generation's `step_indices`; do not join on equal table
indices or use today's selected model. Placeholder model enums are not pricing
identities and are never hardcoded to model names. Steps that omit a
`gen_metadata` mapping (such as `step_type = 23` context checkpoints) fall back
strictly to an unambiguous same-database correlation against `gen_metadata`-attributed
steps: first by `(turn_id, model_enum)`, then by database-wide `model_enum`.
Missing or ambiguous attributions fail closed. Unknown fields are skipped
without inspecting their opaque bytes. Invalid, unsafe or contradictory counters
must not be guessed or silently clamped into valid usage.

The installed `codeium_common.proto` descriptor declares `proto3`. Usage fields
2/3/4/5/9/10 are ordinary `uint64` scalars without `proto3_optional` or a oneof:
they have implicit presence and omitted values mean zero, not unavailable data.
Cache-read, cache-write and thinking accounting therefore preserve known zeros
for every valid completed usage. Visible output is derived from the authoritative
total-output minus thinking partition when redundant field 10 is not serialized;
when field 10 is present it must agree with that partition.

## Token Partitions And Cache Rate

`input_tokens` is already separate from cache reads: never subtract cache reads
from it. Raw `output_tokens` includes thinking: never add thinking to it again.
Visible output and reasoning are mutually exclusive pew counters.

Canonical accounting records preserve inclusive input/output totals and the
reported cache-read subset. Cache-write field presence is not evidence that a
previously unobserved nonzero write has a known input inclusion convention; do
not manufacture a write interpretation from an upstream guess.

The dashboard's existing accounting summary computes:

```text
cache hit rate = sum(cache reads) / sum(input with known cache-read accounting)
```

The denominator includes reported zero-hit calls; rates are weighted by token
counts, not averaged per call or divided by output/total tokens. Coverage marks
unknown cache accounting separately. Antigravity's verified implicit scalar
defaults give complete cache-read accounting coverage for all emitted usage,
including calls whose zero-hit field was omitted from the serialized message.

## Safety And Recovery

Ordinary SQLite read-only connections can update the original WAL shared-memory
index. Read a private temporary snapshot including WAL, not a writable source
connection. Direct `immutable=1` against a live source is insufficient because
it ignores WAL. Preserve source bytes and sidecars, clean temporary copies in
`finally`, and reject unstable copies rather than reporting partial data.
The SQLite connection may write only to this private copy, allowing Bun to
create a temporary shared-memory index and recover copied WAL transactions.

Main database mtime/size alone cannot detect WAL-only changes. Each database's
stat identity (`dev:ino:size:mtimeNs:ctimeNs` for both `.db` and `-wal`) and its
collapsed per-bucket snapshot are cached under `cursors.antigravity.dbs`
(guarded by `cacheVersion`). Unchanged databases skip copying, SHA-256 hashing
and SQLite opening; changed or uncached databases undergo single-DB SHA-256
stability checks before copying, after copying, and after SQLite queries. No
body or opaque blob is hashed.
Absolute snapshots replace only Antigravity's current
device partition; they never enter other sources' incremental SUM path. Changed
model/time keys and deleted steps produce zero-valued tombstones, including
matching accounting annotations. The existing durable commit journal joins
usage, details, pending-upload intent and the source status marker.

Transient write instability (`UnstableAntigravityError`) is isolated per
database while preserving the No-False-Tombstones invariant:
- A busy database with a valid per-DB cache retains its cached snapshot with a
  warning so unaffected sibling databases still sync.
- An uncached busy database is skipped with a warning only when a valid per-DB
  cache exists or no prior Antigravity baseline exists (and at least one other
  database succeeds). After `pew reset` with a retained baseline (no per-DB cache),
  any unstable database fails the whole Antigravity snapshot closed and preserves
  the previous partition.
- Structural, decoding, accounting, or session validation errors always fail the
  whole Antigravity snapshot closed before generic cursor-recovery logic runs,
  preserving the previous Antigravity partition and its pending detail/usage
  uploads even when unrelated cursors restart. Missing roots are not valid
  empty snapshots. Nonzero cache writes currently fail closed because their
  input inclusion semantics remain unverified; reported zero writes are
  preserved as known zero.

Full-source snapshots are O(total local database size), an intentional initial
tradeoff for correction and WAL correctness. Tombstones require retained local
keys; scanning alone cannot discover stale remote keys after complete loss of
Pew's own local queues. No automatic reset, upstream hook or quota API is added.

Session statistics derive user/assistant counts and UTC times from typed steps.
Candidates enforce the existing session-ingest date, duration, count and label
bounds before either token or session state can be changed.
Workspace references use the existing project hash boundary. Neither payloads,
prompts, reasoning text nor raw local paths belong in uploads or test fixtures.

## Recent Upstream Research

Verified on 2026-10-09. All listed projects are MIT-licensed and were updated
within the preceding month. Star counts are observations, not correctness proof.

| Project | Stars | Latest inspected commit date | Pinned revision |
| --- | ---: | --- | --- |
| [tokscale](https://github.com/junhoyeo/tokscale) | 5,643 | 2026-10-05 | `d4d1c751856e25913bce97bfbd7b254308863239` |
| [openusage](https://github.com/robinebers/openusage) | 4,334 | 2026-10-06 | `cb21465e3d88d8b2075ca48d38c936b82177fb78` |
| [token-monitor](https://github.com/Javis603/token-monitor) | 2,681 | 2026-10-08 | `c62544e7ffae8dfa863c92a4e81571ad381110f0` |
| [TokenTracker](https://github.com/xiufengsun/TokenTracker) | 1,999 | 2026-10-08 | `4e225c312744cdbfb9266ace4002b5a54875635c` |
| [tokentelemetry](https://github.com/VasiHemanth/tokentelemetry) | 377 | 2026-10-08 | `5eecfc4926a18f913df53ffb8ce65a355b85f20f` |
| [splitrail](https://github.com/Piebald-AI/splitrail) | 223 | 2026-10-07 | `d9cbe5058d5f5ac89cafe1ee47544aeed62bd13f` |

Relevant paths are `tokscale/crates/tokscale-core/src/sessions/antigravity_cli.rs`,
`openusage/Sources/OpenUsage/Providers/Antigravity/AntigravityProtoDecoder.swift`,
`token-monitor/docs/providers/antigravity.md`,
`tokentelemetry/backend/antigravity_usage.py`, and
`splitrail/src/analyzers/antigravity.rs`. TokenTracker's path discovery confirms
distinct app/IDE roots, but those surfaces are outside this CLI integration.

The inspected tokscale/tokentelemetry decoders add usage field 1 as system-prompt
tokens. The installed descriptor identifies it as the model enum. Tokscale's
inspected decoder also interprets fields 9/10 in the opposite order from the
installed schema. These accounting heuristics are not adopted. Token Monitor's
WAL shared-memory observation informs the strict source-read-only design.
