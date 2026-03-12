/**
 * Claude Code session collector.
 *
 * Full-scans a Claude JSONL file and extracts session-level metadata.
 * Groups lines by sessionId, counts message types, computes duration.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { SessionSnapshot, Source } from "@pew/core";
import { hashProjectRef } from "../utils/hash-project-ref.js";

/** Internal accumulator for a single session */
interface SessionAccum {
  sessionId: string;
  userMessages: number;
  assistantMessages: number;
  totalMessages: number;
  minTimestamp: string | null;
  maxTimestamp: string | null;
  lastModel: string | null;
}

/**
 * Extract the project reference from a Claude file path.
 *
 * Claude stores files under ~/.claude/projects/{dirName}/{file}.jsonl
 * where dirName is a path-encoded string like `-Users-nocoo-workspace-pew`.
 *
 * We hash the directory name through hashProjectRef() (SHA-256, 16 hex chars)
 * for privacy. The raw directory name is NOT stored because it's a
 * privacy-sensitive path variant (albeit irreversible due to Claude's encoding).
 */
function extractProjectRef(filePath: string): string | null {
  const parts = filePath.split("/");
  const projectsIdx = parts.lastIndexOf("projects");
  if (projectsIdx < 0 || projectsIdx + 1 >= parts.length - 1) return null;
  const dirName = parts[projectsIdx + 1];
  if (!dirName) return null;
  return hashProjectRef(dirName);
}

/**
 * Collect session snapshots from a Claude Code JSONL file.
 *
 * Each line may contain a sessionId. Lines are grouped by sessionId,
 * and for each group we produce a SessionSnapshot with:
 * - message counts (user/assistant/total)
 * - wall-clock duration (min timestamp → max timestamp)
 * - last seen model
 * - project ref from file path
 */
export async function collectClaudeSessions(
  filePath: string,
): Promise<SessionSnapshot[]> {
  const st = await stat(filePath).catch(() => null);
  if (!st || !st.isFile() || st.size === 0) return [];

  const sessions = new Map<string, SessionAccum>();

  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      if (!line) continue;

      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }

      const sessionId = typeof obj.sessionId === "string" ? obj.sessionId : null;
      if (!sessionId) continue;

      const timestamp = typeof obj.timestamp === "string" ? obj.timestamp : null;
      const type = typeof obj.type === "string" ? obj.type : null;

      // Get or create session accumulator
      let accum = sessions.get(sessionId);
      if (!accum) {
        accum = {
          sessionId,
          userMessages: 0,
          assistantMessages: 0,
          totalMessages: 0,
          minTimestamp: null,
          maxTimestamp: null,
          lastModel: null,
        };
        sessions.set(sessionId, accum);
      }

      // Count messages
      accum.totalMessages++;
      if (type === "user") {
        accum.userMessages++;
      } else if (type === "assistant") {
        accum.assistantMessages++;
      }

      // Track timestamps
      if (timestamp) {
        if (!accum.minTimestamp || timestamp < accum.minTimestamp) {
          accum.minTimestamp = timestamp;
        }
        if (!accum.maxTimestamp || timestamp > accum.maxTimestamp) {
          accum.maxTimestamp = timestamp;
        }
      }

      // Track model (from message.model or obj.model)
      const msg = obj.message as Record<string, unknown> | undefined;
      const model =
        typeof msg?.model === "string"
          ? msg.model.trim()
          : typeof obj.model === "string"
            ? (obj.model as string).trim()
            : null;
      if (model) {
        accum.lastModel = model;
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  // Convert accumulators to snapshots
  const projectRef = extractProjectRef(filePath);
  const snapshotAt = new Date().toISOString();
  const results: SessionSnapshot[] = [];

  for (const accum of sessions.values()) {
    if (!accum.minTimestamp) continue; // no valid timestamps → skip

    const startedAt = accum.minTimestamp;
    const lastMessageAt = accum.maxTimestamp ?? accum.minTimestamp;
    const durationMs =
      new Date(lastMessageAt).getTime() - new Date(startedAt).getTime();

    results.push({
      sessionKey: `claude:${accum.sessionId}`,
      source: "claude-code" as Source,
      kind: "human",
      startedAt,
      lastMessageAt,
      durationSeconds: Math.max(0, Math.floor(durationMs / 1000)),
      userMessages: accum.userMessages,
      assistantMessages: accum.assistantMessages,
      totalMessages: accum.totalMessages,
      projectRef,
      model: accum.lastModel,
      snapshotAt,
    });
  }

  return results;
}
