/**
 * GitHub Copilot CLI session collector.
 *
 * Full-scans a Copilot CLI process log file and produces a single SessionSnapshot.
 * Each log file represents one CLI session (process).
 * GitHub Copilot CLI is considered "human" kind (user-initiated requests).
 *
 * Session ID comes from "Workspace initialized: <uuid>" line.
 * Model comes from "Using default model: <model>" line.
 * Project ref is NOT available in logs (no cwd/repo hashing possible).
 *
 * Timing:
 * - startedAt: timestamp of "Workspace initialized" line
 * - lastMessageAt: timestamp of last "Sending request to the AI model" line
 *
 * Message counting:
 * - "Sending request to the AI model" lines → userMessages (each is a user prompt)
 * - assistantMessages set equal to userMessages (1:1 request/response pattern)
 * - totalMessages = userMessages (only counting user-initiated turns)
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { SessionSnapshot, Source } from "@pew/core";

/** Timestamp pattern from log lines: 2026-04-11T11:12:04.598Z */
const TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/;

/**
 * Collect session snapshots from a Copilot CLI process log file.
 *
 * Reads every line, extracts session metadata and request counts,
 * and produces 0 or 1 SessionSnapshot.
 */
export async function collectCopilotCliSessions(
  filePath: string,
): Promise<SessionSnapshot[]> {
  const st = await stat(filePath).catch(() => null);
  if (!st || !st.isFile() || st.size === 0) return [];

  let sessionId: string | null = null;
  let model: string | null = null;
  let firstTimestamp: string | null = null;
  let lastRequestTimestamp: string | null = null;
  let userMessages = 0;

  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      if (!line) continue;

      const timestampMatch = line.match(TIMESTAMP_RE);
      const timestamp = timestampMatch?.[1] ?? null;

      // Track first timestamp as session start
      if (timestamp && !firstTimestamp) {
        firstTimestamp = timestamp;
      }

      // Extract session ID from "Workspace initialized: <uuid>"
      if (line.includes("Workspace initialized:")) {
        const match = line.match(
          /Workspace initialized:\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
        );
        if (match) {
          sessionId = match[1];
        }
      }

      // Extract model from "Using default model: <model>"
      if (line.includes("Using default model:")) {
        const match = line.match(/Using default model:\s+(\S+)/);
        if (match) {
          model = match[1];
        }
      }

      // Count AI requests and track last request timestamp
      if (line.includes("Sending request to the AI model")) {
        userMessages++;
        if (timestamp) {
          lastRequestTimestamp = timestamp;
        }
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  // No valid session ID or timestamps → skip this file
  if (!sessionId || !firstTimestamp) return [];

  // Session must have at least one AI request to be meaningful
  if (userMessages === 0) return [];

  const startedAt = firstTimestamp;
  const lastMessageAt = lastRequestTimestamp ?? firstTimestamp;
  const durationMs =
    new Date(lastMessageAt).getTime() - new Date(startedAt).getTime();

  // Session key: use native UUID from Workspace initialized
  const sessionKey = `copilot-cli:${sessionId}`;

  return [
    {
      sessionKey,
      source: "copilot-cli" as Source,
      kind: "human",
      startedAt,
      lastMessageAt,
      durationSeconds: Math.max(0, Math.floor(durationMs / 1000)),
      userMessages,
      assistantMessages: userMessages, // 1:1 request/response
      totalMessages: userMessages,
      projectRef: null, // Not available in Copilot CLI logs
      model,
      snapshotAt: new Date().toISOString(),
    },
  ];
}
