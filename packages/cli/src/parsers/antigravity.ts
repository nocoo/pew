import { createHash } from "node:crypto";
import { chmod, copyFile, lstat, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { AccountingGroup, AntigravityCachedDelta, AntigravityDbCache, SessionSnapshot } from "@pew/core";
import { inclusiveAccounting, mergeAccountingGroups } from "../utils/accounting.js";
import { toUtcHalfHourStart } from "../utils/buckets.js";
import { hashProjectRef } from "../utils/hash-project-ref.js";
import { isAllZero } from "../utils/token-delta.js";
import { usageLabel } from "../utils/usage-evidence.js";
import type { ParsedDelta } from "./claude.js";

export const ANTIGRAVITY_CACHE_VERSION = 1;

export interface SqliteDb {
  prepare(sql: string): { all(): unknown[] };
  close(): void;
}

export interface ReadAntigravityOptions {
  opener?: (path: string) => SqliteDb;
  cache?: Record<string, AntigravityDbCache>;
  allowSkipUncachedUnstable?: boolean;
}

export interface AntigravitySourceSnapshot {
  deltas: ParsedDelta[];
  snapshots: SessionSnapshot[];
  dbCount: number;
  stepCount: number;
  dbs: Record<string, AntigravityDbCache>;
  warnings: string[];
}

export class UnstableAntigravityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnstableAntigravityError";
  }
}

type Field = { number: number; value: bigint | Uint8Array | null };
type Usage = { modelEnum: number | null; input: number; output: number; read: number; write: number; reasoning: number; visible: number };
type Step = { idx: number; step_type: number; status: number; metadata: Uint8Array | null };
const esmRequire = createRequire(import.meta.url);

function openSqlite(path: string): SqliteDb {
  if (typeof globalThis.Bun !== "undefined") {
    const { Database } = esmRequire("bun:sqlite");
    return new Database(path);
  }
  const { DatabaseSync } = esmRequire("node:sqlite");
  return new DatabaseSync(path);
}

function varint(data: Uint8Array, offset: number): [bigint, number] {
  let value = 0n;
  for (let i = 0; ; i++) {
    const byte = data[offset++];
    if (byte === undefined || (i === 9 && byte > 1)) throw new Error("Invalid Antigravity Protobuf varint");
    value |= BigInt(byte & 127) << BigInt(i * 7);
    if (byte < 128) return [value, offset];
  }
}

function fields(data: Uint8Array): Field[] {
  if (!(data instanceof Uint8Array)) throw new Error("Invalid Antigravity Protobuf blob");
  const result: Field[] = [];
  let offset = 0;
  while (offset < data.length) {
    const [tag, next] = varint(data, offset);
    offset = next;
    const number = Number(tag >> 3n);
    const wire = Number(tag & 7n);
    if (number < 1 || number > 536_870_911) throw new Error("Invalid Antigravity Protobuf field");
    if (wire === 0) {
      const [value, end] = varint(data, offset);
      offset = end;
      result.push({ number, value });
    } else if (wire === 2) {
      const [length, start] = varint(data, offset);
      if (length > BigInt(data.length - start)) throw new Error("Truncated Antigravity Protobuf bytes");
      offset = start + Number(length);
      result.push({ number, value: data.subarray(start, offset) });
    } else if (wire === 1 || wire === 5) {
      offset += wire === 1 ? 8 : 4;
      if (offset > data.length) throw new Error("Truncated Antigravity Protobuf fixed field");
      result.push({ number, value: null });
    } else {
      throw new Error("Unsupported Antigravity Protobuf wire type");
    }
  }
  return result;
}

function singular(data: Field[], number: number): Field["value"] | undefined {
  const matching = data.filter((field) => field.number === number);
  if (matching.length > 1) throw new Error("Duplicate Antigravity Protobuf field");
  return matching[0]?.value;
}

function message(value: Field["value"] | undefined): Field[] | null {
  if (value === undefined) return null;
  if (!(value instanceof Uint8Array)) throw new Error("Invalid Antigravity Protobuf message wire type");
  return fields(value);
}

function integer(value: Field["value"] | undefined, limit: bigint): number | null {
  if (value === undefined) return null;
  if (typeof value !== "bigint" || value < 0n || value > limit) throw new Error("Unsafe Antigravity Protobuf integer");
  return Number(value);
}

function timestamp(data: Field[] | null): string | null {
  if (!data) return null;
  const value = singular(data, 1);
  const rawSeconds = value === undefined ? 0n : value;
  if (typeof rawSeconds !== "bigint") throw new Error("Invalid Antigravity Timestamp seconds");
  const seconds = BigInt.asIntN(64, rawSeconds);
  if (seconds < -62_135_596_800n || seconds > 253_402_300_799n) throw new Error("Invalid Antigravity Timestamp range");
  const nanos = integer(singular(data, 2), 999_999_999n) ?? 0;
  return new Date(Number(seconds) * 1000 + Math.floor(nanos / 1_000_000)).toISOString();
}

export function decodeAntigravityMetadata(blob: Uint8Array): { timestamp: string | null; turnId: string | null; usage: Usage | null } {
  const data = fields(blob);
  const time = timestamp(message(singular(data, 1)));
  const rawTurn = singular(data, 12);
  let turnId: string | null = null;
  if (rawTurn !== undefined) {
    if (!(rawTurn instanceof Uint8Array)) throw new Error("Invalid Antigravity turn id wire type");
    const decodedTurn = new TextDecoder("utf-8", { fatal: true }).decode(rawTurn).trim();
    if (decodedTurn) turnId = decodedTurn;
  }
  const raw = message(singular(data, 9));
  if (!raw) return { timestamp: time, turnId, usage: null };
  const count = (number: number) => integer(singular(raw, number), 1_000_000_000n);
  const rawEnum = integer(singular(raw, 1), 2_147_483_647n);
  const modelEnum = rawEnum !== null && rawEnum > 0 ? rawEnum : null;
  const input = count(2) ?? 0;
  const output = count(3) ?? 0;
  const read = count(5) ?? 0;
  const write = count(4) ?? 0;
  const reasoning = count(9) ?? 0;
  const visible = count(10) ?? output - reasoning;
  if (write !== 0) throw new Error("Unknown Antigravity nonzero cache-write accounting");
  if (reasoning > output || visible !== output - reasoning) throw new Error("Contradictory Antigravity output counters");
  if (input + read + output > 1_000_000_000) throw new Error("Unsafe Antigravity combined token count");
  return { timestamp: time, turnId, usage: { modelEnum, input, output, read, write, reasoning, visible } };
}

function modelAssociations(rows: unknown[]): Map<number, string> {
  const models = new Map<number, string>();
  for (const row of rows as Array<{ data: Uint8Array }>) {
    const data = fields(row.data);
    const chat = message(singular(data, 1));
    const response = chat ? singular(chat, 19) : undefined;
    if (response !== undefined && !(response instanceof Uint8Array)) throw new Error("Invalid Antigravity response model wire type");
    const model = response === undefined ? null : new TextDecoder("utf-8", { fatal: true }).decode(response).trim();
    const indices: number[] = [];
    for (const field of data.filter((field) => field.number === 2)) {
      if (typeof field.value === "bigint") {
        indices.push(integer(field.value, 2_147_483_647n) as number);
      } else if (field.value instanceof Uint8Array) {
        let offset = 0;
        while (offset < field.value.length) {
          const [index, next] = varint(field.value, offset);
          indices.push(integer(index, 2_147_483_647n) as number);
          offset = next;
        }
      } else {
        throw new Error("Invalid Antigravity step indices wire type");
      }
    }
    if (!model) continue;
    if (usageLabel(model) !== model || model === "unknown") throw new Error("Invalid Antigravity response model");
    for (const index of indices) {
      if (models.has(index) && models.get(index) !== model) throw new Error("Conflicting Antigravity model attribution");
      models.set(index, model);
    }
  }
  return models;
}

function workspace(rows: unknown[]): string | null {
  const decode = (value: Field["value"]) => {
    if (!(value instanceof Uint8Array)) throw new Error("Invalid Antigravity workspace wire type");
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  };
  for (const row of rows as Array<{ data: Uint8Array }>) {
    const data = fields(row.data);
    for (const field of data.filter((field) => field.number === 7)) {
      const uri = decode(field.value);
      if (uri) return hashProjectRef(uri);
    }
    for (const field of data.filter((field) => field.number === 1)) {
      const nested = message(field.value);
      const uri = nested ? singular(nested, 1) : undefined;
      if (uri !== undefined && decode(uri)) return hashProjectRef(decode(uri));
    }
  }
  return null;
}

async function statIdentity(path: string): Promise<string | null> {
  const st = await lstat(path, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!st) return null;
  if (!st.isFile()) throw new Error("Antigravity source must be a regular file");
  return `${st.dev}:${st.ino}:${st.size}:${st.mtimeNs}:${st.ctimeNs}`;
}

async function fingerprint(path: string): Promise<{ stat: string | null; sig: string | null }> {
  const before = await statIdentity(path);
  if (!before) return { stat: null, sig: null };
  const digest = createHash("sha256").update(await readFile(path)).digest("hex");
  const after = await statIdentity(path);
  if (before !== after) throw new UnstableAntigravityError("Unstable Antigravity source snapshot");
  return { stat: after, sig: `${after}:${digest}` };
}

export function validateAntigravitySession(snapshot: SessionSnapshot): SessionSnapshot {
  const dates = [snapshot.startedAt, snapshot.lastMessageAt, snapshot.snapshotAt];
  const counters = [snapshot.userMessages, snapshot.assistantMessages, snapshot.totalMessages];
  if (typeof snapshot.sessionKey !== "string" || snapshot.sessionKey.length > 1024 || !snapshot.sessionKey.trim() ||
    (snapshot.model !== null && (typeof snapshot.model !== "string" || snapshot.model.length > 1024)) ||
    dates.some((date) => !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(date) || !Number.isFinite(Date.parse(date))) ||
    !Number.isSafeInteger(snapshot.durationSeconds) || snapshot.durationSeconds < 0 || snapshot.durationSeconds > 315_576_000 ||
    counters.some((n) => !Number.isSafeInteger(n) || n < 0 || n > 100_000_000) ||
    snapshot.totalMessages !== snapshot.userMessages + snapshot.assistantMessages ||
    Date.parse(snapshot.lastMessageAt) < Date.parse(snapshot.startedAt)) throw new Error("Invalid Antigravity session snapshot");
  return snapshot;
}

function collapseDbDeltas(
  items: Array<{ model: string; hourStart: string; accounting: AccountingGroup }>,
): AntigravityCachedDelta[] {
  const buckets = new Map<string, { model: string; hourStart: string; groups: AccountingGroup[] }>();
  for (const item of items) {
    const key = `${item.model}\0${item.hourStart}`;
    let entry = buckets.get(key);
    if (!entry) {
      entry = { model: item.model, hourStart: item.hourStart, groups: [] };
      buckets.set(key, entry);
    }
    entry.groups.push(item.accounting);
  }
  const collapsed: AntigravityCachedDelta[] = [];
  for (const entry of buckets.values()) {
    for (const group of mergeAccountingGroups(entry.groups)) {
      collapsed.push({
        model: entry.model,
        hourStart: entry.hourStart,
        tokens: {
          inputTokens: group.basis.input_tokens,
          cachedInputTokens: group.basis.cached_input_tokens,
          outputTokens: group.basis.output_tokens,
          reasoningOutputTokens: group.basis.reasoning_output_tokens,
        },
        accounting: group,
      });
    }
  }
  return collapsed;
}

function expandCachedDeltas(cached: AntigravityCachedDelta[]): ParsedDelta[] {
  return cached.map((delta) => ({
    source: "antigravity",
    model: delta.model,
    timestamp: delta.hourStart,
    tokens: { ...delta.tokens },
    accounting: structuredClone(delta.accounting),
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isTokenDelta(value: unknown): value is AntigravityCachedDelta["tokens"] {
  if (!isRecord(value)) return false;
  return ["inputTokens", "cachedInputTokens", "outputTokens", "reasoningOutputTokens"].every((key) => {
    const n = value[key];
    return typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
  });
}

function isValidDbCache(entry: unknown): entry is AntigravityDbCache {
  if (!isRecord(entry)) return false;
  if (
    typeof entry.dbStat !== "string" ||
    (entry.walStat !== null && typeof entry.walStat !== "string") ||
    typeof entry.stepCount !== "number" ||
    !Number.isSafeInteger(entry.stepCount) ||
    entry.stepCount < 0 ||
    !Array.isArray(entry.deltas)
  ) {
    return false;
  }
  for (const delta of entry.deltas) {
    if (
      !isRecord(delta) ||
      typeof delta.model !== "string" ||
      typeof delta.hourStart !== "string" ||
      !Number.isFinite(Date.parse(delta.hourStart)) ||
      !isTokenDelta(delta.tokens) ||
      !isRecord(delta.accounting) ||
      !isRecord(delta.accounting.basis)
    ) {
      return false;
    }
  }
  if (entry.snapshot === null) return true;
  if (!isRecord(entry.snapshot)) return false;
  try {
    validateAntigravitySession(entry.snapshot as unknown as SessionSnapshot);
    return true;
  } catch {
    return false;
  }
}

async function readDatabase(path: string, opener: (path: string) => SqliteDb, snapshotAt: string) {
  const [mainFp, walFp] = await Promise.all([fingerprint(path), fingerprint(`${path}-wal`)]);
  if (!mainFp.stat || !mainFp.sig) {
    throw new UnstableAntigravityError("Unstable Antigravity source snapshot: database disappeared");
  }
  const dir = await mkdtemp(join(tmpdir(), "pew-antigravity-"));
  let db: SqliteDb | undefined;
  const original = [mainFp.sig, walFp.sig];
  const verify = async () => {
    const current = await Promise.all([fingerprint(path), fingerprint(`${path}-wal`)]);
    if (current.some((item, i) => item.sig !== original[i])) {
      throw new UnstableAntigravityError("Unstable Antigravity source snapshot");
    }
  };
  try {
    const copy = join(dir, basename(path));
    await copyFile(path, copy);
    await chmod(copy, 0o600);
    if (walFp.sig) {
      await copyFile(`${path}-wal`, `${copy}-wal`);
      await chmod(`${copy}-wal`, 0o600);
    }
    await verify();
    db = opener(copy);
    const steps = db.prepare("SELECT idx, step_type, status, metadata FROM steps ORDER BY idx").all() as Step[];
    const models = modelAssociations(db.prepare("SELECT data FROM gen_metadata").all());
    const projectRef = workspace(db.prepare("SELECT data FROM trajectory_metadata_blob").all());

    const decodedSteps: Array<{
      step: Step;
      decoded: { timestamp: string | null; turnId: string | null; usage: Usage | null };
    }> = [];
    const turnEnumModels = new Map<string, Set<string>>();
    const dbEnumModels = new Map<number, Set<string>>();

    for (const step of steps) {
      if (!Number.isSafeInteger(step.idx) || step.idx < 0 || !Number.isInteger(step.step_type) || !Number.isInteger(step.status)) {
        throw new Error("Invalid Antigravity step row");
      }
      const decoded = step.metadata === null
        ? { timestamp: null, turnId: null, usage: null }
        : decodeAntigravityMetadata(step.metadata);
      decodedSteps.push({ step, decoded });
      const directModel = models.get(step.idx);
      const modelEnum = decoded.usage?.modelEnum ?? null;
      if (directModel && modelEnum !== null) {
        let dbSet = dbEnumModels.get(modelEnum);
        if (!dbSet) {
          dbSet = new Set<string>();
          dbEnumModels.set(modelEnum, dbSet);
        }
        dbSet.add(directModel);
        if (decoded.turnId) {
          const turnKey = `${decoded.turnId}\0${modelEnum}`;
          let turnSet = turnEnumModels.get(turnKey);
          if (!turnSet) {
            turnSet = new Set<string>();
            turnEnumModels.set(turnKey, turnSet);
          }
          turnSet.add(directModel);
        }
      }
    }

    const resolveStepModel = (stepIdx: number, turnId: string | null, modelEnum: number | null): string | null => {
      const direct = models.get(stepIdx);
      if (direct) return direct;
      if (modelEnum === null) return null;
      if (turnId) {
        const turnModels = turnEnumModels.get(`${turnId}\0${modelEnum}`);
        if (turnModels?.size === 1) return [...turnModels][0];
        if (turnModels && turnModels.size > 1) return null;
      }
      const dbModels = dbEnumModels.get(modelEnum);
      return dbModels?.size === 1 ? [...dbModels][0] : null;
    };

    const deltas: ParsedDelta[] = [];
    const collapseItems: Array<{ model: string; hourStart: string; accounting: AccountingGroup }> = [];
    const times: number[] = [];
    let userMessages = 0;
    let assistantMessages = 0;
    let lastModel: string | null = null;
    for (const { step, decoded } of decodedSteps) {
      if (decoded.timestamp) times.push(new Date(decoded.timestamp).getTime());
      if (step.step_type === 14) userMessages++;
      if (step.step_type === 15) assistantMessages++;
      const resolvedModel = resolveStepModel(step.idx, decoded.turnId, decoded.usage?.modelEnum ?? null);
      if (resolvedModel) lastModel = resolvedModel;
      if (step.status !== 3 || !decoded.usage) continue;
      const usage = decoded.usage;
      const tokens = { inputTokens: usage.input, cachedInputTokens: usage.read,
        outputTokens: usage.visible, reasoningOutputTokens: usage.reasoning };
      if (isAllZero(tokens)) continue;
      if (!resolvedModel) throw new Error("Missing Antigravity usage model attribution");
      if (!decoded.timestamp) throw new Error("Missing Antigravity usage timestamp");
      const accounting = inclusiveAccounting(tokens, { input: usage.input + usage.read, read: usage.read,
        write: usage.write, output: usage.output, reasoning: usage.reasoning }, { origin: "antigravity:step", model: resolvedModel });
      deltas.push({ source: "antigravity", model: resolvedModel, timestamp: decoded.timestamp, tokens, accounting });
      collapseItems.push({ model: resolvedModel, hourStart: toUtcHalfHourStart(decoded.timestamp) as string, accounting });
    }
    let snapshot: SessionSnapshot | null = null;
    if (times.length) {
      const start = times.reduce((a, b) => Math.min(a, b));
      const end = times.reduce((a, b) => Math.max(a, b));
      snapshot = validateAntigravitySession({ sessionKey: `antigravity:${basename(path, ".db")}`, source: "antigravity", kind: "human",
        startedAt: new Date(start).toISOString(), lastMessageAt: new Date(end).toISOString(),
        durationSeconds: Math.floor((end - start) / 1000), userMessages, assistantMessages, totalMessages: userMessages + assistantMessages,
        projectRef, model: lastModel, snapshotAt });
    }
    await verify();
    return {
      deltas,
      snapshot,
      cacheEntry: {
        dbStat: mainFp.stat,
        walStat: walFp.stat,
        stepCount: deltas.length,
        deltas: collapseDbDeltas(collapseItems),
        snapshot,
      },
    };
  } finally {
    try { db?.close(); } finally { await rm(dir, { recursive: true, force: true }); }
  }
}

export async function readAntigravitySource(
  rootDirs: readonly string[],
  opts: ReadAntigravityOptions = {},
): Promise<AntigravitySourceSnapshot> {
  const uniqueRoots = [...new Set(rootDirs)];
  const dbPaths = new Map<string, string>();
  let existingRoots = 0;

  for (const rootDir of uniqueRoots) {
    let entries: string[];
    try {
      entries = await readdir(rootDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    existingRoots++;
    for (const name of entries) {
      if (!name.endsWith(".db")) continue;
      const conversationId = basename(name, ".db");
      if (dbPaths.has(conversationId)) {
        throw new Error(`Conflicting duplicate Antigravity conversation ID: ${conversationId}`);
      }
      dbPaths.set(conversationId, join(rootDir, name));
    }
  }

  if (existingRoots === 0) {
    throw Object.assign(new Error("Antigravity conversation root not found"), { code: "ENOENT" });
  }

  const sortedEntries = [...dbPaths.entries()].sort(([a], [b]) => a.localeCompare(b));
  const opener = opts.opener ?? openSqlite;
  const deltas: ParsedDelta[] = [];
  const snapshots: SessionSnapshot[] = [];
  const nextDbs: Record<string, AntigravityDbCache> = {};
  const snapshotAt = new Date().toISOString();
  let stepCount = 0;
  let retainedBusy = 0;
  let skippedBusy = 0;

  const appendEntry = (entry: AntigravityDbCache, dbDeltas?: ParsedDelta[]) => {
    deltas.push(...(dbDeltas ?? expandCachedDeltas(entry.deltas)));
    if (entry.snapshot) snapshots.push(entry.snapshot);
    stepCount += entry.stepCount;
  };

  for (const [, dbPath] of sortedEntries) {
    const cached = opts.cache?.[dbPath];
    const validCache = isValidDbCache(cached) ? cached : undefined;
    const [dbStat, walStat] = await Promise.all([statIdentity(dbPath), statIdentity(`${dbPath}-wal`)]);

    if (dbStat !== null && validCache && validCache.dbStat === dbStat && validCache.walStat === walStat) {
      appendEntry(validCache);
      nextDbs[dbPath] = validCache;
      continue;
    }

    try {
      if (dbStat === null) {
        throw new UnstableAntigravityError("Unstable Antigravity source snapshot: database disappeared");
      }
      const result = await readDatabase(dbPath, opener, snapshotAt);
      appendEntry(result.cacheEntry, result.deltas);
      nextDbs[dbPath] = result.cacheEntry;
    } catch (error) {
      if (!(error instanceof UnstableAntigravityError)) throw error;
      if (validCache) {
        appendEntry(validCache);
        nextDbs[dbPath] = validCache;
        retainedBusy++;
      } else if (opts.allowSkipUncachedUnstable) {
        skippedBusy++;
      } else {
        throw error;
      }
    }
  }

  if (skippedBusy > 0 && Object.keys(nextDbs).length === 0) {
    throw new UnstableAntigravityError("Unstable Antigravity source snapshot");
  }

  const warnings: string[] = [];
  if (retainedBusy > 0) {
    warnings.push(`Retained cached snapshot for ${retainedBusy} busy Antigravity database(s)`);
  }
  if (skippedBusy > 0) {
    warnings.push(`Skipped ${skippedBusy} busy Antigravity database(s); will retry next sync`);
  }

  return {
    deltas,
    snapshots,
    dbCount: Object.keys(nextDbs).length,
    stepCount,
    dbs: nextDbs,
    warnings,
  };
}
