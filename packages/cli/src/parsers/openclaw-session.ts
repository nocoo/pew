/**
 * OpenClaw session collector.
 *
 * Full-scans an OpenClaw JSONL file and produces a single SessionSnapshot.
 * OpenClaw is automated (kind: "automated"), has no user messages,
 * and counts all line types in totalMessages.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { SessionSnapshot, Source } from "@pew/core";

/**
 * Extract agent name from an OpenClaw file path.
 *
 * Expected pattern: .../agents/{agentName}/sessions/*.jsonl
 * Returns null if the path doesn't match.
 */
function extractAgentName(filePath: string): string | null {
  const parts = filePath.split("/");
  const agentsIdx = parts.lastIndexOf("agents");
  if (agentsIdx < 0 || agentsIdx + 2 >= parts.length) return null;
  // Check that the part after agent name is "sessions"
  if (parts[agentsIdx + 2] !== "sessions") return null;
  return parts[agentsIdx + 1] || null;
}

/**
 * Collect session snapshots from an OpenClaw JSONL session file.
 *
 * Reads every line, counts by type:
 * - `type: "message"` → assistantMessages
 * - All valid lines → totalMessages
 * - userMessages always 0 (no user messages observable in OpenClaw)
 *
 * Returns 0 or 1 SessionSnapshot.
 */
export async function collectOpenClawSessions(
  filePath: string,
): Promise<SessionSnapshot[]> {
  const st = await stat(filePath).catch(() => null);
  if (!st || !st.isFile() || st.size === 0) return [];

  let assistantMessages = 0;
  let totalMessages = 0;
  let minTimestamp: string | null = null;
  let maxTimestamp: string | null = null;
  let lastModel: string | null = null;

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

      totalMessages++;

      // Track type
      const type = typeof obj.type === "string" ? obj.type : null;
      if (type === "message") {
        assistantMessages++;

        // Extract model from message.model
        const msg = obj.message as Record<string, unknown> | undefined;
        if (msg && typeof msg === "object") {
          const model =
            typeof msg.model === "string" ? msg.model.trim() : null;
          if (model) {
            lastModel = model;
          }
        }
      }

      // Track timestamps
      const timestamp =
        typeof obj.timestamp === "string" ? obj.timestamp : null;
      if (timestamp) {
        if (!minTimestamp || timestamp < minTimestamp) {
          minTimestamp = timestamp;
        }
        if (!maxTimestamp || timestamp > maxTimestamp) {
          maxTimestamp = timestamp;
        }
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  // No valid timestamps → can't produce a snapshot
  if (!minTimestamp) return [];

  const startedAt = minTimestamp;
  const lastMessageAt = maxTimestamp ?? minTimestamp;
  const durationMs =
    new Date(lastMessageAt).getTime() - new Date(startedAt).getTime();

  // Session key: sha256 of absolute path (OpenClaw has no native session ID)
  const hash = createHash("sha256")
    .update(resolve(filePath))
    .digest("hex")
    .slice(0, 16);
  const sessionKey = `openclaw:${hash}`;

  // Project ref: agent name from path
  const projectRef = extractAgentName(filePath);

  return [
    {
      sessionKey,
      source: "openclaw" as Source,
      kind: "automated",
      startedAt,
      lastMessageAt,
      durationSeconds: Math.max(0, Math.floor(durationMs / 1000)),
      userMessages: 0,
      assistantMessages,
      totalMessages,
      projectRef,
      model: lastModel,
      snapshotAt: new Date().toISOString(),
    },
  ];
}
