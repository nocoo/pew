---
name: ponytail-audit
description: Readonly Pew accounting and complexity audit, from source parsers through UI.
---

# Pew project override

In this repository, extend the global ponytail audit beyond complexity to accounting correctness, privacy and compatibility. Do not simplify away a correctness guard to reduce line count. This override changes only Pew's audit; it does not edit global skills.

Run `sh scripts/ponytail-audit.sh` from the repository root. The wrapper disables dotenv loading and Bun's transpiler disk cache. It prints one deterministic JSON object to stdout. Do not redirect it to a report file. The audit reads repository source files and runs synthetic SQL against an in-memory database; it never opens a source database, Pew state/queue, private log, credential file or remote endpoint. It does not run tests, sync, reset, upload, login, migration tools or cleanup commands. Do not follow symlinks or scan dependency, build, coverage or cache trees.

Read [the accounting contract](../../../docs/47-usage-evidence.md) and inspect every stage below, including callers and consumers. A green mechanical audit is not a completed human review.

| Stage | Review obligations |
| --- | --- |
| Parser | Pi compaction vs assistant usage; Hermes main vs background/aux/ACP ledger; failed, cancelled and incomplete calls; source/provider model labels; only whitelist metadata leaves a source |
| Cursor | Partial lines, rollover, fork copies, reset and source loss; evidence committed before cursor; replay cannot change previously allocated times |
| Spool | Stable device/event/group identities; absolute replacement; source revision ordering; atomic outbox intent; retained evidence across reset; generic errors |
| Upload | Separate evidence endpoint; no SUM of snapshots; retry and offline convergence; old server rejection retains pending evidence; auth errors never expose payloads |
| Worker/schema | Additive migration before code activation; unchanged legacy UPSERT; immutable event ownership/time/provenance; device/user isolation; old snapshots cannot overwrite; account deletion |
| API/UI | Every usage read includes the combined view; original bucket dimensions and UTC storage; local display; no zero-checkpoint activity; approximate timing is visible |
| Test evidence | Inspect synthetic regression assertions for each layer; check current full-suite and G1 results separately. Suite presence and cached passes do not establish a fresh full run |

The JSON includes an input content digest, stage checks, regression-suite digests, findings and thresholds. Exit **0** means zero mechanical errors, **1** means at least one failed rule, **2** means the audit could not complete. Do not force findings to zero or lower a threshold. Full tests and independent reviews remain separate completion requirements.

For manual findings, use the same fields: `id`, `severity`, `stage`, `path`, `message`. Keep messages to the concrete defect, impact and smallest viable fix. Add complexity tags (`delete`, `stdlib`, `native`, `yagni`, `shrink`) only when supported by a real simplification. Use repository paths, safe counts and hashes; never quote source payloads, secrets, prompts, responses or personal messages. Reply in the pane only. Audit and review apply no fixes.
