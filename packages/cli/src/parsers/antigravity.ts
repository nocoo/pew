import { createHash } from "node:crypto";
import { chmod, copyFile, lstat, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { SessionSnapshot } from "@pew/core";
import { inclusiveAccounting } from "../utils/accounting.js";
import { hashProjectRef } from "../utils/hash-project-ref.js";
import { isAllZero } from "../utils/token-delta.js";
import { usageLabel } from "../utils/usage-evidence.js";
import type { ParsedDelta } from "./claude.js";

interface SqliteDb {
  prepare(sql: string): { all(): unknown[] };
  close(): void;
}

type Field = { number: number; value: bigint | Uint8Array | null };
type Usage = { input: number; output: number; read: number; write: number; reasoning: number; visible: number };
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

export function decodeAntigravityMetadata(blob: Uint8Array): { timestamp: string | null; usage: Usage | null } {
  const data = fields(blob);
  const time = timestamp(message(singular(data, 1)));
  const raw = message(singular(data, 9));
  if (!raw) return { timestamp: time, usage: null };
  const count = (number: number) => integer(singular(raw, number), 1_000_000_000n);
  const input = count(2) ?? 0;
  const output = count(3) ?? 0;
  const read = count(5) ?? 0;
  const write = count(4) ?? 0;
  const reasoning = count(9) ?? 0;
  const visible = count(10) ?? output - reasoning;
  if (write !== 0) throw new Error("Unknown Antigravity nonzero cache-write accounting");
  if (reasoning > output || visible !== output - reasoning) throw new Error("Contradictory Antigravity output counters");
  if (input + read + output > 1_000_000_000) throw new Error("Unsafe Antigravity combined token count");
  return { timestamp: time, usage: { input, output, read, write, reasoning, visible } };
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

async function fingerprint(path: string): Promise<string | null> {
  const before = await lstat(path, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!before) return null;
  if (!before.isFile()) throw new Error("Antigravity source must be a regular file");
  const after = await lstat(path, { bigint: true });
  const identity = (st: typeof before) => `${st.dev}:${st.ino}:${st.size}:${st.mtimeNs}:${st.ctimeNs}`;
  if (identity(before) !== identity(after)) throw new Error("Unstable Antigravity source snapshot");
  const digest = createHash("sha256").update(await readFile(path)).digest("hex");
  return `${identity(after)}:${digest}`;
}

export function validateAntigravitySession(snapshot: SessionSnapshot): SessionSnapshot {
  const dates = [snapshot.startedAt, snapshot.lastMessageAt, snapshot.snapshotAt];
  const counters = [snapshot.userMessages, snapshot.assistantMessages, snapshot.totalMessages];
  if (snapshot.sessionKey.length > 1024 || !snapshot.sessionKey.trim() ||
    (snapshot.model !== null && snapshot.model.length > 1024) ||
    dates.some((date) => !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(date) || !Number.isFinite(Date.parse(date))) ||
    !Number.isSafeInteger(snapshot.durationSeconds) || snapshot.durationSeconds < 0 || snapshot.durationSeconds > 315_576_000 ||
    counters.some((n) => !Number.isSafeInteger(n) || n < 0 || n > 100_000_000) ||
    snapshot.totalMessages !== snapshot.userMessages + snapshot.assistantMessages ||
    Date.parse(snapshot.lastMessageAt) < Date.parse(snapshot.startedAt)) throw new Error("Invalid Antigravity session snapshot");
  return snapshot;
}

async function readDatabase(path: string, opener: (path: string) => SqliteDb, snapshotAt: string, original: Array<string | null>) {
  if (!original[0]) throw new Error("Unstable Antigravity source snapshot: database disappeared");
  const dir = await mkdtemp(join(tmpdir(), "pew-antigravity-"));
  let db: SqliteDb | undefined;
  const verify = async () => {
    const current = await Promise.all([fingerprint(path), fingerprint(`${path}-wal`)]);
    if (current.some((item, i) => item !== original[i])) throw new Error("Unstable Antigravity source snapshot");
  };
  try {
    await verify();
    const copy = join(dir, basename(path));
    await copyFile(path, copy);
    await chmod(copy, 0o600);
    if (original[1]) {
      await copyFile(`${path}-wal`, `${copy}-wal`);
      await chmod(`${copy}-wal`, 0o600);
    }
    await verify();
    db = opener(copy);
    const steps = db.prepare("SELECT idx, step_type, status, metadata FROM steps ORDER BY idx").all() as Step[];
    const models = modelAssociations(db.prepare("SELECT data FROM gen_metadata").all());
    const projectRef = workspace(db.prepare("SELECT data FROM trajectory_metadata_blob").all());
    const deltas: ParsedDelta[] = [];
    const times: number[] = [];
    let userMessages = 0;
    let assistantMessages = 0;
    let lastModel: string | null = null;
    for (const step of steps) {
      if (!Number.isSafeInteger(step.idx) || step.idx < 0 || !Number.isInteger(step.step_type) || !Number.isInteger(step.status)) throw new Error("Invalid Antigravity step row");
      const decoded = step.metadata === null ? { timestamp: null, usage: null } : decodeAntigravityMetadata(step.metadata);
      if (decoded.timestamp) times.push(new Date(decoded.timestamp).getTime());
      if (step.step_type === 14) userMessages++;
      if (step.step_type === 15) assistantMessages++;
      if (models.has(step.idx)) lastModel = models.get(step.idx) as string;
      if (step.status !== 3 || !decoded.usage) continue;
      const usage = decoded.usage;
      const tokens = { inputTokens: usage.input, cachedInputTokens: usage.read,
        outputTokens: usage.visible, reasoningOutputTokens: usage.reasoning };
      if (isAllZero(tokens)) continue;
      const model = models.get(step.idx);
      if (!model) throw new Error("Missing Antigravity usage model attribution");
      if (!decoded.timestamp) throw new Error("Missing Antigravity usage timestamp");
      deltas.push({ source: "antigravity", model, timestamp: decoded.timestamp, tokens,
        accounting: inclusiveAccounting(tokens, { input: usage.input + usage.read, read: usage.read,
          write: usage.write, output: usage.output, reasoning: usage.reasoning }, { origin: "antigravity:step", model }) });
    }
    const snapshots: SessionSnapshot[] = [];
    if (times.length) {
      const start = times.reduce((a, b) => Math.min(a, b));
      const end = times.reduce((a, b) => Math.max(a, b));
      snapshots.push(validateAntigravitySession({ sessionKey: `antigravity:${basename(path, ".db")}`, source: "antigravity", kind: "human",
        startedAt: new Date(start).toISOString(), lastMessageAt: new Date(end).toISOString(),
        durationSeconds: Math.floor((end - start) / 1000), userMessages, assistantMessages, totalMessages: userMessages + assistantMessages,
        projectRef, model: lastModel, snapshotAt }));
    }
    await verify();
    return { deltas, snapshots, signatures: original };
  } finally {
    try { db?.close(); } finally { await rm(dir, { recursive: true, force: true }); }
  }
}

export async function readAntigravitySource(
  rootDir: string,
  opener: (path: string) => SqliteDb = openSqlite,
): Promise<{ deltas: ParsedDelta[]; snapshots: SessionSnapshot[]; dbCount: number }> {
  const names = (await readdir(rootDir)).filter((name) => name.endsWith(".db")).sort();
  const deltas: ParsedDelta[] = [];
  const snapshots: SessionSnapshot[] = [];
  const signatures = new Map<string, Array<string | null>>();
  const snapshotAt = new Date().toISOString();
  for (const name of names) {
    signatures.set(name, await Promise.all([fingerprint(join(rootDir, name)), fingerprint(join(rootDir, `${name}-wal`))]));
  }
  for (const name of names) {
    const result = await readDatabase(join(rootDir, name), opener, snapshotAt, signatures.get(name) as Array<string | null>);
    deltas.push(...result.deltas);
    snapshots.push(...result.snapshots);
  }
  const current = (await readdir(rootDir)).filter((name) => name.endsWith(".db")).sort();
  if (JSON.stringify(current) !== JSON.stringify(names)) throw new Error("Unstable Antigravity source discovery");
  for (const name of names) {
    for (const [index, suffix] of ["", "-wal"].entries()) {
      const file = await fingerprint(join(rootDir, `${name}${suffix}`));
      if (file !== signatures.get(name)?.[index]) throw new Error("Unstable Antigravity source snapshot");
    }
  }
  return { deltas, snapshots, dbCount: names.length };
}
