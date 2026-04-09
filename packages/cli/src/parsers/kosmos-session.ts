import { readFile } from "node:fs/promises";
import type { SessionSnapshot, Source } from "@pew/core";

export async function collectKosmosSessionSnapshots(opts: { filePath: string; source: Source }): Promise<SessionSnapshot[]> {
  const { filePath, source } = opts;
  let raw: string;
  try { raw = await readFile(filePath, "utf8"); } catch { return []; }
  if (!raw.trim()) return [];
  let session: Record<string, unknown>;
  try { session = JSON.parse(raw); } catch { return []; }
  const sessionId = typeof session.chatSession_id === "string" ? session.chatSession_id : null;
  if (!sessionId) return [];
  const chatHistory = Array.isArray(session.chat_history) ? (session.chat_history as Record<string, unknown>[]) : [];
  if (chatHistory.length === 0) return [];

  let userMessages = 0, assistantMessages = 0, totalMessages = 0;
  let firstTimestamp = Infinity, lastTimestamp = 0;
  let lastModel: string | null = null;

  for (const msg of chatHistory) {
    if (!msg || typeof msg !== "object") continue;
    totalMessages++;
    const ts = typeof msg.timestamp === "number" ? msg.timestamp : null;
    if (ts) { if (ts < firstTimestamp) firstTimestamp = ts; if (ts > lastTimestamp) lastTimestamp = ts; }
    if (msg.role === "user") userMessages++;
    if (msg.role === "assistant") { assistantMessages++; const model = typeof msg.model === "string" ? msg.model.trim() : null; if (model) lastModel = model; }
  }
  if (!Number.isFinite(firstTimestamp) || lastTimestamp === 0) return [];
  const durationSeconds = Math.max(0, Math.round((lastTimestamp - firstTimestamp) / 1000));
  return [{ sessionKey: `${source}:${sessionId}`, source: source as Source, kind: "human", startedAt: new Date(firstTimestamp).toISOString(), lastMessageAt: new Date(lastTimestamp).toISOString(), durationSeconds, userMessages, assistantMessages, totalMessages, projectRef: null, model: lastModel, snapshotAt: new Date().toISOString() }];
}
