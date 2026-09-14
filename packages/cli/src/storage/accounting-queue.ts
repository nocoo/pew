import { readFile } from "node:fs/promises";
import type { AccountingGroup, AccountingRecord, LegacyTokenCounts, QueueRecord } from "@pew/core";
import type { ParsedDelta } from "../parsers/claude.js";
import { legacyCounts, mergeAccountingGroups, optionalToken, unknownAccounting } from "../utils/accounting.js";
import { toUtcHalfHourStart } from "../utils/buckets.js";
import { usageLabel } from "../utils/usage-evidence.js";
import { BaseQueue } from "./base-queue.js";

export const ACCOUNTING_PARSER_REVISION = 1;
export const accountingKey = (r: Pick<AccountingRecord, "source" | "model" | "device_id" | "hour_start" | "event_id">): string =>
  JSON.stringify([r.device_id, r.source, r.model, r.hour_start, r.event_id]);
export const sameBasis = (a: LegacyTokenCounts, b: LegacyTokenCounts): boolean =>
  a.input_tokens === b.input_tokens && a.cached_input_tokens === b.cached_input_tokens && a.output_tokens === b.output_tokens &&
  a.reasoning_output_tokens === b.reasoning_output_tokens && a.total_tokens === b.total_tokens;

export function compareAccountingRevision(a: AccountingRecord, b: AccountingRecord): number {
  return a.source_revision - b.source_revision || a.detail_revision - b.detail_revision;
}

/** Canonical content comparison also tolerates JSON object key ordering after upgrades. */
export function accountingJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(accountingJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${accountingJson(v)}`).join(",")}}`;
  return JSON.stringify(value);
}

// Runtime-local privacy gate: @pew/core is not installed with the published CLI.
// Keep the semantic checks aligned with core/accounting.ts (covered by parity
// regression fixtures). The private core package cannot be a runtime import.
const NUMBER_FIELDS = new Set(("details_version evidence_snapshot_seq source_revision parser_revision detail_revision " +
  "input_tokens cached_input_tokens output_tokens reasoning_output_tokens total_tokens input_total_tokens cache_read_input_tokens " +
  "cache_write_input_tokens cache_write_5m_input_tokens cache_write_1h_input_tokens output_total_tokens " +
  "context_tokens_min context_tokens_max request_count scale raw_total_tokens").split(" "));
const LABEL_FIELDS = new Set("source model origin provider route service_tier quality currency kind status code".split(" "));
function safeTree(value: unknown, key = "record"): boolean {
  if (NUMBER_FIELDS.has(key)) return value === null || optionalToken(value) !== null;
  if (LABEL_FIELDS.has(key)) return value === null || (typeof value === "string" && usageLabel(value) === value);
  if (key === "device_id") return typeof value === "string" && /^[\w.-]{1,128}$/.test(value);
  if (key === "hour_start") return typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:(00|30):00\.000Z$/.test(value);
  if (key === "event_id") return value === null || (typeof value === "string" && /^[a-f0-9]{64}$/.test(value));
  if (key === "units") return typeof value === "string" && /^(0|[1-9]\d{0,59})$/.test(value);
  if (["groups", "reported_costs", "diagnostics"].includes(key)) return Array.isArray(value) && value.length <= 256 && value.every((v) => safeTree(v, "item"));
  if (!["record", "item", "basis", "counts"].includes(key)) return false;
  if (key === "counts" && value === null) return true;
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.entries(value).every(([k, v]) => safeTree(v, k));
}

function checkedRecord(value: AccountingRecord): AccountingRecord {
  const hasKeys = (v: object, names: string) => Object.keys(v).sort().join(" ") === names.split(" ").sort().join(" ");
  const validBasis = (v: LegacyTokenCounts) => hasKeys(v, "input_tokens cached_input_tokens output_tokens reasoning_output_tokens total_tokens") &&
    Object.values(v).every((n) => optionalToken(n) !== null) && v.total_tokens === v.input_tokens + v.cached_input_tokens + v.output_tokens + v.reasoning_output_tokens;
  const invalid = () => { throw new Error("Invalid accounting ledger"); };
  if (!safeTree(value) || value.details_version !== 1 || !value.basis || !Array.isArray(value.groups) || value.groups.length === 0 ||
    ![value.source_revision, value.parser_revision, value.detail_revision].every((n) => optionalToken(n) !== null && n > 0)) throw new Error("Invalid accounting ledger");
  if (!hasKeys(value, "details_version source model device_id hour_start event_id evidence_snapshot_seq source_revision parser_revision detail_revision basis groups") ||
    !validBasis(value.basis) || typeof value.model !== "string" ||
    !["claude-code", "codex", "copilot-cli", "gemini-cli", "grok", "hermes", "kosmos", "omp", "opencode", "openclaw", "pi", "pmstudio", "vscode-copilot", "zcode"].includes(value.source) ||
    !Number.isFinite(Date.parse(value.hour_start)) || new Date(value.hour_start).toISOString() !== value.hour_start ||
    (value.event_id === null ? value.evidence_snapshot_seq !== null : value.evidence_snapshot_seq === null || value.evidence_snapshot_seq < 1)) invalid();
  const sums = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 0 };
  for (const g of value.groups) {
    if (!g.basis || !Array.isArray(g.diagnostics) || !Array.isArray(g.reported_costs) ||
      !hasKeys(g, "basis counts origin model provider route service_tier context_tokens_min context_tokens_max request_count quality reported_costs diagnostics") ||
      !validBasis(g.basis) || typeof g.origin !== "string" || typeof g.model !== "string" ||
      !["reported", "derived", "legacy", "invalid"].includes(g.quality)) invalid();
    const c = g.counts;
    if (c) {
      if (!hasKeys(c, "input_total_tokens cache_read_input_tokens cache_write_input_tokens cache_write_5m_input_tokens cache_write_1h_input_tokens output_total_tokens reasoning_output_tokens") ||
        optionalToken(c.input_total_tokens) === null || optionalToken(c.output_total_tokens) === null || optionalToken(c.input_total_tokens + c.output_total_tokens) === null ||
        c.input_total_tokens !== g.basis.input_tokens + g.basis.cached_input_tokens ||
        c.output_total_tokens !== (value.source === "hermes" ? g.basis.output_tokens : g.basis.output_tokens + g.basis.reasoning_output_tokens) ||
        (c.cache_read_input_tokens ?? 0) + (c.cache_write_input_tokens ?? 0) > c.input_total_tokens ||
        (c.cache_write_5m_input_tokens !== null || c.cache_write_1h_input_tokens !== null) && c.cache_write_input_tokens === null ||
        (c.cache_write_5m_input_tokens ?? 0) + (c.cache_write_1h_input_tokens ?? 0) > (c.cache_write_input_tokens ?? 0) ||
        (c.reasoning_output_tokens ?? 0) > c.output_total_tokens || g.quality === "invalid" || g.quality === "legacy") invalid();
    } else if (c !== null || (g.quality !== "legacy" && g.quality !== "invalid")) invalid();
    if ((g.context_tokens_min === null) !== (g.context_tokens_max === null) ||
      g.context_tokens_min !== null && (g.context_tokens_min > Number(g.context_tokens_max) || !g.request_count)) invalid();
    if (g.reported_costs.length > 4 || g.reported_costs.some((c) =>
      !hasKeys(c, "units scale currency kind status source") || optionalToken(c.scale) === null || c.scale > 18 || c.currency !== "USD" ||
      !["actual", "estimate", "included", "unknown"].includes(c.kind) || !["complete", "partial", "unknown"].includes(c.status) || typeof c.source !== "string")) invalid();
    if (g.diagnostics.length > 3 || g.diagnostics.some((d) => !hasKeys(d, "code raw_total_tokens") ||
      !["total_mismatch", "invalid_counts", "aggregate_context"].includes(d.code))) invalid();
    for (const k of Object.keys(sums) as Array<keyof LegacyTokenCounts>) sums[k] += g.basis[k];
  }
  if (!Object.values(sums).every((n) => optionalToken(n) !== null) || !sameBasis(sums, value.basis)) throw new Error("Invalid accounting ledger");
  return value;
}

/** Absolute annotations and upload intent survive reset, failed uploads and source rotation. */
export class AccountingQueue extends BaseQueue<AccountingRecord> {
  constructor(stateDir: string) { super(stateDir, "accounting-queue.jsonl", "accounting-queue.state.json"); }

  override async readFromOffset(offset: number): Promise<{ records: AccountingRecord[]; newOffset: number }> {
    let raw: Buffer;
    try { raw = await readFile(this.queuePath); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { records: [], newOffset: 0 };
      throw new Error("Invalid accounting ledger");
    }
    try { return { records: raw.subarray(offset).toString("utf8").split("\n").filter(Boolean).map((line) => checkedRecord(JSON.parse(line))), newOffset: raw.byteLength }; }
    catch { throw new Error("Invalid accounting ledger"); }
  }

  async merge(incoming: AccountingRecord[], replay = false): Promise<void> {
    const { records } = await this.readFromOffset(0);
    const merged = new Map(records.map((r) => [accountingKey(r), r]));
    const dirty = new Set(await this.loadDirtyKeys());
    if (replay) for (const key of merged.keys()) dirty.add(key);
    let changed = false;
    for (const raw of incoming) {
      const r = checkedRecord(raw); const key = accountingKey(r); const prev = merged.get(key);
      if (prev) {
        if (compareAccountingRevision(r, prev) < 0 || r.parser_revision < prev.parser_revision) continue;
        if (accountingJson(r) === accountingJson(prev)) continue;
        if (compareAccountingRevision(r, prev) === 0 ||
          (r.source_revision === prev.source_revision && (!sameBasis(r.basis, prev.basis) || r.evidence_snapshot_seq !== prev.evidence_snapshot_seq))) {
          throw new Error("Conflicting accounting snapshot");
        }
      }
      merged.set(key, r); dirty.add(key); changed = true;
    }
    if (changed || (replay && records.length > 0)) {
      await this.saveDirtyKeys([...dirty].sort());
      if (changed) await this.overwrite([...merged.values()].sort((a, b) => accountingKey(a).localeCompare(accountingKey(b))));
    }
  }
}

/** A replay replaces only annotations. An incremental merge needs an exact BEFORE basis. */
export function planAccountingUpdates(opts: {
  previous: AccountingRecord[]; before: QueueRecord[]; after: QueueRecord[];
  deltas: ParsedDelta[]; replay: boolean; deviceId: string;
  onWarning?: (source: string) => void;
  /** Exact replays can verify a previously saved annotation without changing it. */
  onVerified?: (key: string) => void;
}): AccountingRecord[] {
  // Old programmatic callers can omit a device ID at runtime. Their legacy
  // queue contract still works; annotations require explicit ownership.
  if (typeof opts.deviceId !== "string" || !/^[\w.-]{1,128}$/.test(opts.deviceId)) return [];
  const previous = new Map(opts.previous.map((r) => [accountingKey(r), r]));
  const before = new Map(opts.before.map((r) => [accountingKey({ ...r, event_id: null }), r]));
  const after = new Map(opts.after.map((r) => [accountingKey({ ...r, event_id: null }), r]));
  const incoming = new Map<string, { ref: Omit<AccountingRecord, "groups" | "basis" | "source_revision" | "parser_revision" | "detail_revision">; groups: AccountingGroup[]; hasDetails: boolean }>();
  for (const d of opts.deltas) {
    const hour = toUtcHalfHourStart(d.timestamp); if (!hour) continue;
    const ref = { details_version: 1 as const, source: d.source, model: d.evidence ? usageLabel(d.model) : d.model, device_id: opts.deviceId,
      hour_start: hour, event_id: d.evidence?.eventId ?? null, evidence_snapshot_seq: d.evidence?.snapshotSeq ?? null };
    const key = accountingKey(ref); const old = incoming.get(key);
    const g = d.accounting ?? unknownAccounting(legacyCounts(d.tokens), d.model);
    if (d.evidence) {
      // Absolute evidence can be seen in several fork files. Never SUM it.
      if (!old || Number(old.ref.evidence_snapshot_seq) < Number(ref.evidence_snapshot_seq)) incoming.set(key, { ref, groups: [g], hasDetails: !!d.accounting });
    } else if (old) { old.groups.push(g); old.hasDetails ||= !!d.accounting; }
    else incoming.set(key, { ref, groups: [g], hasDetails: !!d.accounting });
  }
  const updates: AccountingRecord[] = [];
  for (const [key, entry] of incoming) {
    try {
    const prev = previous.get(key);
    if (!entry.hasDetails && !prev) continue;
    const priorBase = before.get(key);
    let groups = entry.groups;
    if (!entry.ref.event_id && !opts.replay && priorBase) {
      // A different bucket snapshot is not a superset. Retain old details as
      // pending; only an exact replay can reconcile this history.
      if (prev && !sameBasis(prev.basis, priorBase)) continue;
      groups = [...(prev?.groups ?? [unknownAccounting(priorBase, entry.ref.model)]), ...groups];
    }
    groups = mergeAccountingGroups(groups);
    const basis = entry.ref.event_id ? groups[0].basis : after.get(key);
    if (!basis) continue;
    const snapshotBasis = { input_tokens: basis.input_tokens, cached_input_tokens: basis.cached_input_tokens, output_tokens: basis.output_tokens,
      reasoning_output_tokens: basis.reasoning_output_tokens, total_tokens: basis.total_tokens };
    const groupedBasis = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 0 };
    for (const group of groups) for (const k of Object.keys(groupedBasis) as Array<keyof LegacyTokenCounts>) groupedBasis[k] += group.basis[k];
    // Full snapshot enrichment may encounter retained remote-only or rotated
    // history. A mismatch is not permission to alter that history.
    if (!sameBasis(groupedBasis, snapshotBasis)) continue;
    const sameSource = prev && sameBasis(prev.basis, snapshotBasis) && prev.evidence_snapshot_seq === entry.ref.evidence_snapshot_seq;
    const candidate = checkedRecord({ ...entry.ref, basis: snapshotBasis, groups,
      source_revision: prev ? prev.source_revision + (sameSource ? 0 : 1) : 1,
      parser_revision: ACCOUNTING_PARSER_REVISION, detail_revision: sameSource ? prev.detail_revision + 1 : 1 });
    opts.onVerified?.(key);
    if (sameSource && accountingJson(groups) === accountingJson(prev.groups) && prev.parser_revision === ACCOUNTING_PARSER_REVISION) continue;
    updates.push(candidate);
    } catch { opts.onWarning?.(entry.ref.source); }
  }
  return updates;
}
