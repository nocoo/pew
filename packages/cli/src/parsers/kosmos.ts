import { readFile } from "node:fs/promises";
import type { Source, TokenDelta } from "@pew/core";
import type { ParsedDelta } from "./claude.js";
import { isAllZero, toNonNegInt } from "../utils/token-delta.js";

export interface KosmosFileResult {
  deltas: ParsedDelta[];
  allMessageIds: string[];
}

export async function parseKosmosFile(opts: {
  filePath: string;
  knownMessageIds: Set<string> | null;
}): Promise<KosmosFileResult> {
  const { filePath, knownMessageIds } = opts;
  const deltas: ParsedDelta[] = [];
  const allMessageIds: string[] = [];

  let raw: string;
  try { raw = await readFile(filePath, "utf8"); } catch { return { deltas, allMessageIds }; }
  if (!raw.trim()) return { deltas, allMessageIds };

  let session: Record<string, unknown>;
  try { session = JSON.parse(raw); } catch { return { deltas, allMessageIds }; }

  const chatHistory = Array.isArray(session?.chat_history) ? (session.chat_history as Record<string, unknown>[]) : [];

  for (const msg of chatHistory) {
    if (!msg || typeof msg !== "object") continue;
    if (msg.role !== "assistant") continue;
    const usage = msg.usage as Record<string, unknown> | undefined;
    if (!usage || typeof usage !== "object") continue;
    const msgId = typeof msg.id === "string" ? msg.id : null;
    if (!msgId) continue;
    allMessageIds.push(msgId);
    if (knownMessageIds?.has(msgId)) continue;
    const timestamp = typeof msg.timestamp === "number" ? msg.timestamp : null;
    if (!timestamp) continue;
    const model = typeof msg.model === "string" ? msg.model.trim() : "unknown";
    const tokens: TokenDelta = {
      inputTokens: toNonNegInt(usage.prompt_tokens),
      cachedInputTokens: 0,
      outputTokens: toNonNegInt(usage.completion_tokens),
      reasoningOutputTokens: 0,
    };
    if (isAllZero(tokens)) continue;
    deltas.push({ source: "kosmos" as Source, model, timestamp: new Date(timestamp).toISOString(), tokens });
  }
  return { deltas, allMessageIds };
}
