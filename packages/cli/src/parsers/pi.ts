import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { Source, TokenDelta } from "@pew/core";
import type { ParsedDelta } from "./claude.js";
import { isAllZero, toNonNegInt } from "../utils/token-delta.js";
import { clampedJsonlEndOffset, jsonlStreamBound } from "../utils/jsonl-offset.js";
import { evidenceId, usageLabel } from "../utils/usage-evidence.js";

/** Result of parsing a single pi-format JSONL session file */
export interface PiFileResult {
  deltas: ParsedDelta[];
  endOffset: number;
}

/**
 * Normalize a pi-format usage object to our TokenDelta format.
 *
 * Pi/omp session JSONL assistant messages carry per-turn absolute usage:
 *   input + cacheWrite + orchestration.input  → inputTokens
 *   cacheRead + orchestration.cacheRead       → cachedInputTokens
 *   output - reasoning + orchestration.output → outputTokens
 *   reasoningTokens | reasoning               → reasoningOutputTokens
 *
 * `input` counts non-cached input tokens and `cacheWrite` counts tokens
 * written to the cache (analogous to Anthropic's
 * `cache_creation_input_tokens`). Together they represent total input.
 *
 * `orchestration` is a provider-side bucket ("billed, but not part of the
 * conversation prompt/cache buckets" — OpenAI/Codex Responses populate it).
 * It is counted in the source's own `totalTokens`, so folding each component
 * into the matching pew bucket is what keeps
 * `totalTokens === inputTokens + cachedInputTokens + outputTokens +
 * reasoningOutputTokens`. Dropping it would undercount both tokens and the
 * cost pew recomputes from them.
 *
 * Reasoning tokens are a documented **subset of `output`** (omp's
 * `Usage.reasoningTokens`: "Always a subset of `output` — non-reasoning
 * output is `output - reasoningTokens`"; pi spells the same field
 * `reasoning`). They are split out of the *conversation* output rather than
 * added on top, keeping the row total unchanged. Providers that don't report
 * the field omit it — absent means unknown, which we treat as no split.
 */
export function normalizePiUsage(u: Record<string, unknown>): TokenDelta {
  const orchestration =
    u?.orchestration && typeof u.orchestration === "object"
      ? (u.orchestration as Record<string, unknown>)
      : undefined;

  const conversationOutput = toNonNegInt(u?.output);
  // omp ≥17 uses `reasoningTokens`; pi uses `reasoning`. Clamp to the
  // conversation output (orchestration output is a separate bucket) so a
  // malformed row can never push outputTokens negative.
  const reasoning = Math.min(
    conversationOutput,
    toNonNegInt(u?.reasoningTokens ?? u?.reasoning),
  );

  return {
    inputTokens:
      toNonNegInt(u?.input) +
      toNonNegInt(u?.cacheWrite) +
      toNonNegInt(orchestration?.input),
    cachedInputTokens:
      toNonNegInt(u?.cacheRead) + toNonNegInt(orchestration?.cacheRead),
    outputTokens:
      conversationOutput - reasoning + toNonNegInt(orchestration?.output),
    reasoningOutputTokens: reasoning,
  };
}

/**
 * Parse a pi-format JSONL session file incrementally from a byte offset.
 *
 * Pi stores one JSONL file per session under ~/.pi/agent/sessions/<encoded-cwd>/.
 * Oh My Pi (omp) is a fork that writes the identical schema under
 * ~/.omp/agent/sessions/<encoded-cwd>/ — `source` selects which one is tagged.
 *
 * Each line is a JSON object with a `type` field. Assistant messages have
 * `type: "message"` with `message.role === "assistant"` and a `message.usage`
 * object containing per-turn absolute token counts.
 *
 * Strategy: byte-offset streaming, bounded to the `stat()` snapshot so a
 * concurrent append is never parsed under a cursor that predates it.
 * Partial-line safe: `endOffset` stops after the last complete `\n`, so a
 * half-written trailing line is retried on the next sync instead of being
 * skipped forever. Each usage block is standalone — no running-total diffing.
 */
export async function parsePiFile(opts: {
  filePath: string;
  startOffset: number;
  endBound?: number;
  /** Source tag for emitted deltas — "pi" (default) or "omp" */
  source?: Source;
}): Promise<PiFileResult> {
  const { filePath, startOffset, source = "pi" } = opts;
  const deltas: ParsedDelta[] = [];

  const st = await stat(filePath).catch(() => null);
  if (!st?.isFile()) return { deltas, endOffset: startOffset };
  const bound = jsonlStreamBound(st.size, opts.endBound);
  if (startOffset >= bound) return { deltas, endOffset: bound };

  // `end` is inclusive — pin the read to the snapshot bound so bytes appended
  // mid-parse stay unread (and unaccounted) until the next run.
  // ponytail: changed Pi files replay their metadata prefix to recover the
  // model/session after legacy cursor upgrades. Persist metadata if this
  // becomes a measured bottleneck; usage before startOffset is never emitted.
  const readStart = source === "pi" ? 0 : startOffset;
  const stream = createReadStream(filePath, { start: readStart, end: bound - 1 });
  let sessionId: string | null = null;
  let currentModel = "unknown";
  let currentProvider = "unknown";
  const seenCompactions = new Set<string>();
  // Carry incomplete trailing bytes across chunks (Uint8Array avoids Buffer generics)
  let pending: Uint8Array = new Uint8Array(0);
  // Bytes of complete lines (ending in \n) consumed relative to startOffset
  let completeBytes = 0;

  try {
    for await (const chunk of stream) {
      const piece: Uint8Array = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk as string);
      if (pending.length === 0) {
        pending = piece;
      } else {
        const merged = new Uint8Array(pending.length + piece.length);
        merged.set(pending, 0);
        merged.set(piece, pending.length);
        pending = merged;
      }

      let offset = 0;
      while (offset < pending.length) {
        const nl = pending.indexOf(0x0a, offset);
        if (nl === -1) break;

        const lineBuf = pending.subarray(offset, nl);
        completeBytes += nl - offset + 1; // include \n
        offset = nl + 1;

        if (lineBuf.length === 0) continue;
        const line = Buffer.from(lineBuf).toString("utf8");

        // Fast-path: skip lines that can't contain usage data
        if (!line.includes('"usage"') && !line.includes('"session"') && !line.includes('"model_change"')) continue;

        let obj: Record<string, unknown>;
        try {
          obj = JSON.parse(line) as Record<string, unknown>;
        } catch {
          // Malformed but terminated line — skip and advance past it
          continue;
        }

        if (obj.type === "session") {
          sessionId = typeof obj.id === "string" ? obj.id : null;
          currentModel = "unknown";
          currentProvider = "unknown";
          continue;
        }
        if (obj.type === "model_change") {
          currentModel = usageLabel(obj.modelId);
          currentProvider = usageLabel(obj.provider);
          continue;
        }

        const beforeCursor = readStart + completeBytes <= startOffset;
        if (obj.type === "compaction" && source === "pi") {
          if (!sessionId || typeof obj.id !== "string" || !obj.id ||
            typeof obj.timestamp !== "string" || !Number.isFinite(Date.parse(obj.timestamp)) ||
            !obj.usage || typeof obj.usage !== "object") continue;
          // Pi copies entry IDs and timestamps when forking into a NEW session
          // header. Scope by the immutable entry tuple, not pathname/header.
          // The timestamp also separates reused short entry IDs in new calls.
          const eventId = evidenceId(["pi", "compaction", obj.id, new Date(obj.timestamp).toISOString()]);
          const tokens = normalizePiUsage(obj.usage as Record<string, unknown>);
          if (isAllZero(tokens)) continue;
          if (seenCompactions.has(eventId)) continue;
          seenCompactions.add(eventId);
          if (beforeCursor) continue;
          const model = obj.model ? usageLabel(obj.model) : obj.fromHook ? "unknown" : currentModel;
          deltas.push({ source, model, timestamp: obj.timestamp, tokens, evidence: {
            eventId, groupId: eventId,
            callType: "compaction", origin: "pi-session", provider: currentProvider,
            granularity: "operation", timePrecision: "exact",
            intervalStart: null, intervalEnd: null, callCount: null, snapshotSeq: 1,
          } });
          continue;
        }

        // Assistant usage remains in the original accounting path. Custom
        // provider/proxy request copies are not a second ingest source.
        if (obj.type !== "message") continue;

        const msg = obj.message as Record<string, unknown> | undefined;
        if (msg?.role !== "assistant") continue;

        // Extract usage
        const usage = msg.usage as Record<string, unknown> | undefined;
        if (!usage || typeof usage !== "object") continue;

        // Extract model
        const model = typeof msg.model === "string" ? msg.model.trim() : null;
        if (!model) continue;
        currentModel = usageLabel(model);
        if (beforeCursor) continue;

        // Extract timestamp from the outer JSONL entry
        const timestamp =
          typeof obj.timestamp === "string" ? obj.timestamp : null;
        if (!timestamp) continue;

        // Normalize and filter zero deltas
        const delta = normalizePiUsage(usage);
        if (isAllZero(delta)) continue;

        deltas.push({ source, model, timestamp, tokens: delta });
      }

      // Keep only the trailing partial line
      pending = offset === 0 ? pending : pending.subarray(offset);
    }
  } finally {
    stream.destroy();
  }

  // Trailing partial line is NOT counted in endOffset
  return { deltas, endOffset: clampedJsonlEndOffset(readStart, bound, completeBytes) };
}
