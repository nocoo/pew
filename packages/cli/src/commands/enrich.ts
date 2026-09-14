import { createHash } from "node:crypto";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AccountingRecord, Source } from "@pew/core";
import { AccountingQueue, ACCOUNTING_PARSER_REVISION, accountingJson, accountingKey, planAccountingUpdates, sameBasis } from "../storage/accounting-queue.js";
import { EvidenceQueue } from "../storage/evidence-queue.js";
import { LocalQueue } from "../storage/local-queue.js";
import { withStateLock } from "../storage/state-lock.js";
import { readGrokAccountingSnapshots } from "../parsers/grok-session-usage.js";
import { aggregateRecords } from "./upload.js";
import { executeSync, type SyncOptions } from "./sync.js";

export interface EnrichOptions extends SyncOptions {
  source: Source | "all";
  from: string;
  to: string;
  apply?: boolean;
}

const sourceOptions: Record<Source, Array<keyof SyncOptions>> = {
  "claude-code": ["claudeDir"], codex: ["codexSessionsDir", "multicaCodexDirs"], "gemini-cli": ["geminiDir"],
  "copilot-cli": ["copilotCliLogsDir", "copilotCliOtelPaths"], grok: ["grokLogsPath", "grokSessionsDir"],
  hermes: ["hermesDbPath", "hermesProfileDbPaths", "openHermesDb"], kosmos: ["kosmosDataDir"], omp: ["ompSessionsDir"],
  opencode: ["openCodeMessageDir", "openCodeDbPath", "openMessageDb"], openclaw: ["openclawDir"], pi: ["piSessionsDir"],
  pmstudio: ["pmstudioDataDir"], "vscode-copilot": ["vscodeCopilotDirs"], zcode: ["zcodeDbPath", "openZcodeDb"],
};

async function requireSettledState(stateDir: string): Promise<void> {
  try { await access(join(stateDir, "sync-commit.json")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw new Error("Cannot read Pew state"); }
  throw new Error("Recover the pending sync before enriching details; no state was changed");
}

/** Readonly by default. Replay in scratch state; apply changes annotations/outbox only and never uploads. */
export async function executeEnrich(opts: EnrichOptions) {
  const parseBound = (v: string) => {
    if (!/^\d{4}-\d\d-\d\d(?:T\d\d:(?:00|30):00(?:\.000)?Z)?$/.test(v)) return NaN;
    const expected = v.length === 10 ? `${v}T00:00:00.000Z` : v.replace(/:00Z$/, ":00.000Z");
    const time = Date.parse(v);
    return Number.isFinite(time) && new Date(time).toISOString() === expected ? time : NaN;
  };
  const from = parseBound(opts.from); const to = parseBound(opts.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || to > Math.floor(Date.now() / 1_800_000) * 1_800_000) throw new Error("Choose a closed UTC half-hour window: --from inclusive, --to exclusive");
  if (opts.source !== "all" && !Object.hasOwn(sourceOptions, opts.source)) throw new Error("Invalid accounting source");
  if (!/^[\w.-]{1,128}$/.test(opts.deviceId)) throw new Error("An existing Pew device ID is required");
  await requireSettledState(opts.stateDir);
  const scratch = await mkdtemp(join(tmpdir(), "pew-enrich-preview-"));
  try {
    const keys = new Set(opts.source === "all" ? Object.values(sourceOptions).flat() : sourceOptions[opts.source]);
    const selected = Object.fromEntries(Object.entries(opts).filter(([key]) => keys.has(key as keyof SyncOptions)));
    // Preserve prior evidence allocations in scratch; resetting real evidence
    // would move historical calls between time buckets.
    await new EvidenceQueue(scratch).merge((await new EvidenceQueue(opts.stateDir).readFromOffset(0)).records);
    await new AccountingQueue(scratch).merge((await new AccountingQueue(opts.stateDir).readFromOffset(0)).records);
    const replay = await executeSync({ ...selected, stateDir: scratch, deviceId: opts.deviceId, onProgress: opts.onProgress });
    const verified = new Set(replay.accountingKeys);
    const candidates = (await new AccountingQueue(scratch).readFromOffset(0)).records.filter((r) => verified.has(accountingKey(r)));
    const grokSnapshots = (opts.source === "all" || opts.source === "grok") && opts.grokSessionsDir ? await readGrokAccountingSnapshots(opts.grokSessionsDir) : [];
    const reconcile = async () => {
      await requireSettledState(opts.stateDir);
      const legacy = aggregateRecords((await new LocalQueue(opts.stateDir, () => { throw new Error("Invalid original usage queue"); }).readFromOffset(0)).records);
      const evidence = (await new EvidenceQueue(opts.stateDir).readFromOffset(0)).records;
      const bases = [...legacy.map((r) => ({ ...r, event_id: null, evidence_snapshot_seq: null })),
        ...evidence.map((r) => ({ ...r, event_id: r.evidence.eventId, evidence_snapshot_seq: r.evidence.snapshotSeq }))].filter((r) =>
          r.device_id === opts.deviceId && (opts.source === "all" || r.source === opts.source) &&
          Date.parse(r.hour_start) >= from && Date.parse(r.hour_start) < to);
      const originals = new Map(bases.map((r) => [accountingKey(r), r]));
      const queue = new AccountingQueue(opts.stateDir);
      const previous = new Map((await queue.readFromOffset(0)).records.map((r) => [accountingKey(r), r]));
      const allCandidates = new Map(candidates.map((r) => [accountingKey(r), r]));
      for (const record of planAccountingUpdates({ previous: [], before: [], after: legacy, deltas: grokSnapshots,
        replay: true, deviceId: opts.deviceId })) allCandidates.set(accountingKey(record), record);
      const updates: AccountingRecord[] = [];
      let matched = 0; let cacheWriteTokens = 0; let writeCoveredInputTokens = 0;
      for (const [key, candidate] of allCandidates) {
        const base = originals.get(key);
        if (!base || !sameBasis(base, candidate.basis) || base.evidence_snapshot_seq !== candidate.evidence_snapshot_seq) continue;
        matched++;
        for (const g of candidate.groups) if (g.counts?.cache_write_input_tokens !== null && g.counts) {
          cacheWriteTokens += g.counts.cache_write_input_tokens;
          writeCoveredInputTokens += g.counts.input_total_tokens;
        }
        const prev = previous.get(key);
        if (prev && (prev.parser_revision > ACCOUNTING_PARSER_REVISION ||
          (sameBasis(prev.basis, candidate.basis) && prev.evidence_snapshot_seq === candidate.evidence_snapshot_seq &&
            accountingJson(prev.groups) === accountingJson(candidate.groups) && prev.parser_revision === ACCOUNTING_PARSER_REVISION))) continue;
        const sameSource = prev && sameBasis(prev.basis, candidate.basis) && prev.evidence_snapshot_seq === candidate.evidence_snapshot_seq;
        updates.push({ ...candidate, parser_revision: ACCOUNTING_PARSER_REVISION,
          source_revision: prev ? prev.source_revision + (sameSource ? 0 : 1) : 1,
          detail_revision: sameSource ? prev.detail_revision + 1 : 1 });
      }
      updates.sort((a, b) => accountingKey(a).localeCompare(accountingKey(b)));
      const planId = createHash("sha256").update(accountingJson(updates)).digest("hex");
      if (opts.apply && updates.length) await queue.merge(updates);
      return { mode: opts.apply ? "apply" : "preview", source: opts.source, from: new Date(from).toISOString(), to: new Date(to).toISOString(),
        eligible: originals.size, matched, changed: updates.length, unverified: originals.size - matched,
        cacheWriteTokens, writeCoveredInputTokens, applied: opts.apply ? updates.length : 0, planId };
    };
    return opts.apply ? await withStateLock(opts.stateDir, reconcile) : await reconcile();
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
