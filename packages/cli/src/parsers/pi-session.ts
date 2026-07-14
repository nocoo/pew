/**
 * Pi session collector.
 *
 * Full-scans a pi JSONL session file and extracts session-level metadata.
 * Pi stores one session per file with a tree structure (id/parentId).
 *
 * Session header (first line): { type: "session", id, timestamp, cwd }
 * Messages: { type: "message", message: { role, model, usage, ... } }
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { createInterface } from "node:readline";
import type { SessionSnapshot, Source } from "@pew/core";
import { hashProjectRef } from "../utils/hash-project-ref.js";

/**
 * Extract project reference from a pi session file path.
 *
 * Pi stores sessions under ~/.pi/agent/sessions/<encoded-cwd>/<file>.jsonl
 * The <encoded-cwd> directory name is a double-dash-delimited path encoding,
 * e.g. "--Users-shaozliu-projects-3p-pew--".
 *
 * We hash the directory name through hashProjectRef() for privacy.
 */
function extractProjectRef(filePath: string): string | null {
  const dirName = basename(dirname(filePath));
  if (!dirName) return null;
  return hashProjectRef(dirName);
}

/**
 * Collect session snapshots from a pi JSONL session file.
 *
 * Each pi file is one session. We scan all lines to collect:
 * - Session ID from the header line (type: "session")
 * - Message counts (user, assistant, total)
 * - Timestamps for wall-clock duration
 * - Last seen model
 */
export async function collectPiSessions(
  filePath: string,
): Promise<SessionSnapshot[]> {
  const st = await stat(filePath).catch(() => null);
  if (!st?.isFile() || st.size === 0) return [];

  let sessionId: string | null = null;
  let userMessages = 0;
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

      const type = typeof obj.type === "string" ? obj.type : null;
      const timestamp =
        typeof obj.timestamp === "string" ? obj.timestamp : null;

      // Extract session ID from header
      if (type === "session") {
        sessionId = typeof obj.id === "string" ? obj.id : null;
      }

      // Track timestamps from all entries
      if (timestamp) {
        if (!minTimestamp || timestamp < minTimestamp) {
          minTimestamp = timestamp;
        }
        if (!maxTimestamp || timestamp > maxTimestamp) {
          maxTimestamp = timestamp;
        }
      }

      // Count messages and track model
      if (type === "message") {
        const msg = obj.message as Record<string, unknown> | undefined;
        if (!msg) continue;

        const role = typeof msg.role === "string" ? msg.role : null;
        totalMessages++;

        if (role === "user") {
          userMessages++;
        } else if (role === "assistant") {
          assistantMessages++;

          // Track model from assistant messages
          const model =
            typeof msg.model === "string" ? msg.model.trim() : null;
          if (model) lastModel = model;
        }
        // toolResult messages count toward totalMessages but not user/assistant
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  if (!sessionId || !minTimestamp) return [];

  const startedAt = minTimestamp;
  const lastMessageAt = maxTimestamp ?? minTimestamp;
  const durationMs =
    new Date(lastMessageAt).getTime() - new Date(startedAt).getTime();

  const projectRef = extractProjectRef(filePath);

  return [
    {
      sessionKey: `pi:${sessionId}`,
      source: "pi" as Source,
      kind: "human",
      startedAt,
      lastMessageAt,
      durationSeconds: Math.max(0, Math.floor(durationMs / 1000)),
      userMessages,
      assistantMessages,
      totalMessages,
      projectRef,
      model: lastModel,
      snapshotAt: new Date().toISOString(),
    },
  ];
}
