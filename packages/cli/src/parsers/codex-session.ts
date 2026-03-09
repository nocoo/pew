/**
 * Codex CLI session collector.
 *
 * Full-scans a Codex JSONL rollout file and produces a single SessionSnapshot.
 * Each rollout file represents one session. Codex is user-driven (kind: "human").
 *
 * Session ID comes from session_meta.payload.id (UUID).
 * Project ref comes from session_meta.payload.cwd (working directory).
 * Model comes from turn_context.payload.model (preferred) or session_meta.payload.model (fallback).
 *
 * Message counting:
 * - response_item with payload.role === "user"      → userMessages
 * - response_item with payload.role === "assistant"  → assistantMessages
 * - All valid JSON lines                             → totalMessages
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { SessionSnapshot, Source } from "@pew/core";

/**
 * Collect session snapshots from a Codex CLI JSONL rollout file.
 *
 * Reads every line, extracts session metadata, counts messages,
 * and produces 0 or 1 SessionSnapshot.
 */
export async function collectCodexSessions(
  filePath: string,
): Promise<SessionSnapshot[]> {
  const st = await stat(filePath).catch(() => null);
  if (!st || !st.isFile() || st.size === 0) return [];

  let sessionId: string | null = null;
  let projectRef: string | null = null;
  let lastModel: string | null = null;
  let userMessages = 0;
  let assistantMessages = 0;
  let totalMessages = 0;
  let minTimestamp: string | null = null;
  let maxTimestamp: string | null = null;

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

      const type = typeof obj.type === "string" ? obj.type : null;
      const timestamp =
        typeof obj.timestamp === "string" ? obj.timestamp : null;

      // Track timestamps
      if (timestamp) {
        if (!minTimestamp || timestamp < minTimestamp) {
          minTimestamp = timestamp;
        }
        if (!maxTimestamp || timestamp > maxTimestamp) {
          maxTimestamp = timestamp;
        }
      }

      const payload = obj.payload as Record<string, unknown> | undefined;

      // Extract session ID and project ref from session_meta
      if (type === "session_meta" && payload) {
        if (typeof payload.id === "string" && payload.id) {
          sessionId = payload.id;
        }
        if (typeof payload.cwd === "string" && payload.cwd) {
          projectRef = payload.cwd;
        }
        // Fallback model from session_meta
        if (typeof payload.model === "string" && payload.model.trim()) {
          lastModel = payload.model.trim();
        }
        continue;
      }

      // Track model from turn_context (overrides session_meta)
      if (type === "turn_context" && payload) {
        if (typeof payload.model === "string" && payload.model.trim()) {
          lastModel = payload.model.trim();
        }
        continue;
      }

      // Count user/assistant messages from response_item
      if (type === "response_item" && payload) {
        const role =
          typeof payload.role === "string" ? payload.role : null;
        if (role === "user") {
          userMessages++;
        } else if (role === "assistant") {
          assistantMessages++;
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

  // Session key: prefer native UUID from session_meta, fallback to sha256 of path
  let sessionKey: string;
  if (sessionId) {
    sessionKey = `codex:${sessionId}`;
  } else {
    const hash = createHash("sha256")
      .update(resolve(filePath))
      .digest("hex")
      .slice(0, 16);
    sessionKey = `codex:${hash}`;
  }

  return [
    {
      sessionKey,
      source: "codex" as Source,
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
