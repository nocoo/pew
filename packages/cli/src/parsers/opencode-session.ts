/**
 * OpenCode session collector.
 *
 * Takes an OpenCode session directory (ses_xxx/) and reads all msg_*.json
 * files to produce a single SessionSnapshot with message counts and duration.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import type { SessionSnapshot, Source } from "@pew/core";
import { coerceEpochMs } from "../utils/time.js";

/**
 * Collect session snapshots from an OpenCode session directory.
 *
 * Reads all .json files in the directory, counts roles, tracks timestamps
 * and model. Returns 0 or 1 SessionSnapshot.
 */
export async function collectOpenCodeSessions(
  sessionDir: string,
): Promise<SessionSnapshot[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(sessionDir, { withFileTypes: true });
  } catch {
    return [];
  }

  // Collect .json files, sorted for deterministic order
  const jsonFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith(".json"))
    .map((e) => e.name)
    .sort();

  if (jsonFiles.length === 0) return [];

  let sessionId: string | null = null;
  let userMessages = 0;
  let assistantMessages = 0;
  let totalMessages = 0;
  let minEpochMs: number | null = null;
  let maxEpochMs: number | null = null;
  let lastModel: string | null = null;

  for (const fileName of jsonFiles) {
    let raw: string;
    try {
      raw = await readFile(join(sessionDir, fileName), "utf8");
    } catch {
      continue;
    }

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      continue;
    }

    totalMessages++;

    // Track sessionID from first message that has one
    if (!sessionId && typeof msg.sessionID === "string") {
      sessionId = msg.sessionID;
    }

    // Count by role
    const role = typeof msg.role === "string" ? msg.role : null;
    if (role === "user") {
      userMessages++;
    } else if (role === "assistant") {
      assistantMessages++;
    }

    // Track timestamps — use completed if available, else created
    const time = msg.time as Record<string, unknown> | undefined;
    if (time) {
      const completedMs = coerceEpochMs(time.completed);
      const createdMs = coerceEpochMs(time.created);

      // For min, prefer created (message start)
      const msgStart = createdMs || completedMs;
      // For max, prefer completed (message end)
      const msgEnd = completedMs || createdMs;

      if (msgStart) {
        if (!minEpochMs || msgStart < minEpochMs) minEpochMs = msgStart;
      }
      if (msgEnd) {
        if (!maxEpochMs || msgEnd > maxEpochMs) maxEpochMs = msgEnd;
      }
    }

    // Track model
    const model =
      typeof msg.modelID === "string"
        ? msg.modelID.trim()
        : typeof msg.model === "string"
          ? (msg.model as string).trim()
          : null;
    if (model) {
      lastModel = model;
    }
  }

  // No valid timestamps → can't produce a snapshot
  if (!minEpochMs) return [];

  const startedAt = new Date(minEpochMs).toISOString();
  const lastMessageAt = new Date(maxEpochMs ?? minEpochMs).toISOString();
  const durationSeconds = Math.max(
    0,
    Math.floor(((maxEpochMs ?? minEpochMs) - minEpochMs) / 1000),
  );

  // Derive session key: prefer sessionID from messages, fallback to directory name
  const dirName = basename(sessionDir);
  const sessionKey = `opencode:${sessionId ?? dirName}`;

  return [
    {
      sessionKey,
      source: "opencode" as Source,
      kind: "human",
      startedAt,
      lastMessageAt,
      durationSeconds,
      userMessages,
      assistantMessages,
      totalMessages,
      projectRef: null,
      model: lastModel,
      snapshotAt: new Date().toISOString(),
    },
  ];
}
