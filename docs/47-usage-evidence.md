# Supplementary usage accounting

Pi compaction and Hermes background/auxiliary usage are separate from the existing main-usage buckets. The CLI retains an `evidence-queue.jsonl` ledger of absolute records. `pew reset` removes parsing cursors and legacy queues but preserves this ledger and its pending upload state. It contains only counters, safe labels, UTC times and hashed identities. It never contains request/response bodies, source session IDs or billing URLs.

| Evidence | Identity and count | Time semantics |
| --- | --- | --- |
| Pi top-level compaction | Hash of source kind, immutable entry ID and canonical entry timestamp; one operation may include several requests | Exact operation completion time, not a fabricated individual request time |
| Hermes background review | Cumulative auxiliary ledger is authoritative; logs must uniquely match numbered calls and completion counters within the ledger's remaining budget | Verified API completion times are exact; unmatched historical counters remain at session start or unattributed |
| Hermes other auxiliary/ACP | Nonempty `session_model_usage.task` rows only; source PK fields are hashed into a group; ACP main totals are already counted by the legacy parser | First observation is cumulative and coarse even if `first_seen == last_seen`; later increases can use adjacent source-ledger observation bounds |

The existing four-counter normalization remains unchanged. Cache read/creation are not redesigned. Logs that omit reasoning cannot supply per-call reasoning; authoritative residual counters remain coarse. Unknown task labels become `auxiliary`; unsafe model/provider labels become `unknown`. Raven proxy traffic is not a second ingestion source or a source of inferred model mappings.

Hermes log times have no timezone suffix. Exact attribution assumes the log was produced in the current host's timezone and uses that timezone's rules at the historical date, including DST. Logs copied from another timezone without provenance cannot establish exact UTC times; they need an explicit known offset or ledger-only attribution. Already retained evidence keeps its original UTC allocation. Pi metadata-prefix replay and reading retained Hermes numeric log entries have a cost proportional to the retained source size; adding durable metadata/log cursors is deferred until measured size requires it.

An interval ends at the later source-ledger write time and is bucketed there. It describes the ledger observation interval, not a claim that every API request occurred exactly at that instant. When bounds are absent or regress, the historical allocation stays coarse. If no session time exists, precision is `unattributed`; any first-seen fallback is only a storage anchor. A fully missing time uses the epoch anchor and is excluded from contemporary date ranges by normal filtering.

For Hermes, `snapshotSeq` is one plus the sum of cumulative source counters and any known call count. It is a source revision, not a wall clock or a sync counter. Component decreases are ignored, including restored older databases. Exact and interval allocations are immutable; a cumulative baseline retains the residual and last observed source watermark. Late logs cannot redistribute already-accounted history. Fresh intervals use hashes of the group and adjacent retained source revisions. The durable ledger is therefore part of accounting state: manual deletion of it is not equivalent to a supported cursor reset and may lose unreconstructible timing evidence.

The upload route `/api/ingest/evidence` replaces records by `(user_id, device_id, event_id)` only for newer source revisions with the same ownership, model, provenance and time. The legacy `/api/ingest` contract and `usage_records` table remain unchanged. Evidence never passes through legacy SUM preprocessing. Failed or unsupported evidence uploads retain pending records for retry; the main queue remains independent. Outbox dirty intent and atomic ledger replacement precede cursor persistence.

## Migration and activation

1. Review migration `022-usage-evidence.sql`; it creates `usage_evidence`, an index and the `usage_totals` view, with no historical data update.
2. When deployment is separately authorized, apply the additive migration before activating either ingest or read code. Deploy the ingest worker, read worker and web routes together before distributing/activating the CLI collector. The new read code requires the view; there is no silent fallback that hides missing supplementary usage.
3. Old clients continue to write the original table. Combined reads group both stores into the original bucket dimensions. Zero ledger checkpoints do not create activity. Optional evidence/approximate counters are additive API fields; old records and responses remain readable.
4. Activation does not need a global reset or timestamp migration. Pi resumes its existing cursor. A first Hermes supplementary scan can see retained cumulative history and labels it coarsely; inspect that scope before any production upload. No backfill, reset, sync, test upload or deployment is performed as part of development or this audit.
5. Rollback can revert code while leaving the additive table/view and local evidence ledger intact. Do not drop them or replay history to make an old client understand supplementary records.

## Readonly audit and validation

Run `sh scripts/ponytail-audit.sh`. It scans allowed repository source roots without following symlinks, parses TypeScript ASTs, and executes actual migration/UPSERT SQL only in memory. JSON stdout includes content hashes, checks and fixed error messages. No production sources, credentials, test caches, reports or network access are involved. The same source contents produce the same result; exit codes are 0 (pass), 1 (failed rule), 2 (incomplete audit). Source-suite digests are an inventory, not a claim that tests ran.

Run the full synthetic test suite and static gates separately during development; those commands create normal test/build caches and are not readonly audits. Regression coverage includes parser success/error/aborted/partial records, compaction fork/replay/rotation, ledger-only ACP accounting, coarse historical times, future intervals, clock regressions, offline replay, stale UPSERTs, unchanged legacy main buckets, local-day aggregation, privacy rejection and timing disclosure. Production HTTP/BDD tests and automatic uploads are not required to inspect this change and must not be run without separate authorization.
