import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import type { TokenDelta } from "@pew/core";
import { jsonlCompleteBound } from "../utils/jsonl-offset.js";
import { evidenceId, usageLabel } from "../utils/usage-evidence.js";

export interface HermesReviewCall {
  eventId: string;
  sessionKey: string;
  model: string;
  provider: string;
  timestamp: string;
  tokens: TokenDelta;
  cacheRead: number;
  call: number;
}

interface Completion {
  sessionKey: string;
  timestamp: string;
  calls: number;
  input: number;
  output: number;
  cacheRead: number;
}
type LogEntry = { type: "call"; value: HermesReviewCall } | { type: "complete"; value: Completion };

export const hermesSessionKey = (profile: string, sessionId: string) => evidenceId(["hermes", profile, sessionId]);

/** Only fixed numeric logging templates are projected; never return a log line or raw ID. */
function projectLine(line: string, profile: string, utcOffsetMinutes?: number): LogEntry | null {
  const prefix = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[,.]\d{3}) INFO \[([^\]\r\n]{1,256})\] (agent\.(?:conversation_loop|background_review)): (.*)$/.exec(line);
  if (!prefix) return null;
  const wall = prefix[1].replace(" ", "T").replace(",", ".");
  // Python's asctime is local wall time. Use the host's historical timezone
  // rules (including DST); an explicit fixed offset is available to fixtures.
  const time = utcOffsetMinutes === undefined ? Date.parse(wall) : Date.parse(`${wall}Z`) - utcOffsetMinutes * 60_000;
  if (!Number.isFinite(time)) return null;
  const timestamp = new Date(time).toISOString();
  const sessionKey = hermesSessionKey(profile, prefix[2]);
  const text = prefix[4];
  if (prefix[3] === "agent.background_review") {
    const m = /^Background review complete: thread=bg-review calls=(\d+) in=(\d+) out=(\d+) cache_read=(\d+) result=(?:none|skill|memory|skill\+memory)$/.exec(text);
    if (!m) return null;
    return { type: "complete", value: { sessionKey, timestamp, calls: Number(m[1]), input: Number(m[2]), output: Number(m[3]), cacheRead: Number(m[4]) } };
  }
  const m = /^API call #(\d+): model=(\S+) provider=(\S+) in=(\d+) out=(\d+) total=(\d+) latency=\d+(?:\.\d+)?s(.*)$/.exec(text);
  if (!m) return null; // usage=unavailable is not billable evidence
  const cacheRead = Number(/(?:^| )cache=(\d+)\/\d+ \(\d+%\)/.exec(m[7])?.[1] ?? 0);
  const cacheWrite = Number(/(?:^| )write=(\d+)(?: |$)/.exec(m[7])?.[1] ?? 0);
  const prompt = Number(m[4]);
  const output = Number(m[5]);
  if (![prompt, output, cacheRead, cacheWrite, Number(m[1])].every((n) => Number.isSafeInteger(n) && n >= 0) ||
    prompt < cacheRead + cacheWrite || Number(m[6]) !== prompt + output) return null;
  const model = usageLabel(m[2]);
  const provider = usageLabel(m[3]);
  const requestId = /(?:^| )id=(\S+)/.exec(m[7])?.[1];
  return { type: "call", value: {
    eventId: evidenceId(["hermes-review", sessionKey, provider, requestId ?? [prefix[1], Number(m[1])]]),
    sessionKey, model, provider, timestamp, call: Number(m[1]), cacheRead,
    tokens: { inputTokens: prompt - cacheRead - cacheWrite, cachedInputTokens: cacheRead + cacheWrite,
      outputTokens: output, reasoningOutputTokens: 0 },
  } };
}

/** A matching call counter alone is insufficient: require one unique numeric sequence. */
function uniqueSequence(calls: HermesReviewCall[], done: Completion): HermesReviewCall[] | null {
  if (done.calls < 1 || done.calls > 1000) return null;
  const matches: HermesReviewCall[][] = [];
  let steps = 0;
  const chosen: HermesReviewCall[] = [];
  // ponytail: bounded search, not a speculative join engine. Ambiguous or
  // overly large histories fall back to the authoritative cumulative ledger.
  function search(start: number, input: number, output: number, cache: number): void {
    if (++steps > 20_000 || matches.length > 1) return;
    if (chosen.length === done.calls) {
      if (input === done.input && output === done.output && cache === done.cacheRead) matches.push([...chosen]);
      return;
    }
    for (let i = start; i < calls.length; i++) {
      const c = calls[i];
      if (c.call !== chosen.length + 1 || (chosen[0] && (c.model !== chosen[0].model || c.provider !== chosen[0].provider))) continue;
      const next = [input + c.tokens.inputTokens, output + c.tokens.outputTokens, cache + c.cacheRead];
      if (next[0] > done.input || next[1] > done.output || next[2] > done.cacheRead) continue;
      chosen.push(c);
      search(i + 1, next[0], next[1], next[2]);
      chosen.pop();
      if (steps > 20_000 || matches.length > 1) return;
    }
  }
  search(0, 0, 0, 0);
  return steps <= 20_000 && matches.length === 1 ? matches[0] : null;
}

function matchEntries(entries: LogEntry[]): HermesReviewCall[] {
  const distinct = new Map<string, LogEntry>();
  for (const e of entries) {
    const key = e.type === "call" ? e.value.eventId : evidenceId(["complete", e.value]);
    distinct.set(key, e);
  }
  const ordered = [...distinct.values()].sort((a, b) => Date.parse(a.value.timestamp) - Date.parse(b.value.timestamp));
  const buffers = new Map<string, HermesReviewCall[]>();
  const matched = new Map<string, HermesReviewCall>();
  for (const e of ordered) {
    const key = e.value.sessionKey;
    const pending = buffers.get(key) ?? [];
    if (e.type === "call") {
      pending.push(e.value);
      buffers.set(key, pending.slice(-1000));
    } else {
      for (const call of uniqueSequence(pending, e.value) ?? []) matched.set(call.eventId, call);
      buffers.set(key, []);
    }
  }
  return [...matched.values()];
}

/** Pure entry point for synthetic fixtures and sanitized in-memory verification. */
export function parseHermesReviewLines(lines: Iterable<string>, profile: string, utcOffsetMinutes?: number): HermesReviewCall[] {
  const entries: LogEntry[] = [];
  for (const line of lines) {
    const entry = projectLine(line, profile, utcOffsetMinutes);
    if (entry) entries.push(entry);
  }
  return matchEntries(entries);
}

export async function readHermesReviewCalls(dbPath: string, profile: string, utcOffsetMinutes?: number): Promise<HermesReviewCall[]> {
  const root = join(dirname(dbPath), "logs");
  const files = await readdir(root).catch(() => []);
  const entries: LogEntry[] = [];
  for (const name of files.filter((n) => /^agent\.log(?:\.\d+)?$/.test(n)).sort()) {
    const path = join(root, name);
    const st = await stat(path).catch(() => null);
    if (!st?.isFile()) continue;
    const bound = await jsonlCompleteBound(path, 0, st.size);
    if (bound < 1) continue;
    const stream = createReadStream(path, { end: bound - 1 });
    const reader = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of reader) {
        const entry = projectLine(line, profile, utcOffsetMinutes);
        if (entry) entries.push(entry);
      }
    } finally { reader.close(); stream.destroy(); }
  }
  return matchEntries(entries);
}
