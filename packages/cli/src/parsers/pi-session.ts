/**
 * Pi-format session collector.
 *
 * Full-scans a pi-format JSONL session file and extracts session-level
 * metadata. Pi stores one session per file with a tree structure (id/parentId).
 * Oh My Pi (omp) writes the identical schema — `source` selects the tag.
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
 * A root session file stem: `<ISO-with-dashes>Z_<uuid>`, e.g.
 * `2026-08-02T23-13-02-103Z_019fc4c0-9097-7000-868a-7b93e2205b9b`.
 *
 * Both pi and omp name root session files this way. omp additionally creates
 * a sibling *directory* with the same stem holding per-agent transcripts, so
 * a parent directory matching this pattern means "the file is a nested agent
 * transcript, not a root session".
 */
const SESSION_STEM =
  /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Locate the `<encoded-cwd>` directory for a pi-format session file.
 *
 * Root session:  `<sessions>/<encoded-cwd>/<stem>.jsonl`
 * Agent nested:  `<sessions>/<encoded-cwd>/<stem>/<agent>.jsonl`
 *                (omp task subagents, `__advisor[.slug].jsonl`)
 *
 * Returns the encoded-cwd dir name plus whether the file is nested. Without
 * the hop, nested transcripts would hash the *root session stem* as their
 * project — a per-session bogus project that never matches the real one.
 */
function locateSession(filePath: string): { dirName: string; nested: boolean } {
  const parent = basename(dirname(filePath));
  if (SESSION_STEM.test(parent)) {
    return { dirName: basename(dirname(dirname(filePath))), nested: true };
  }
  return { dirName: parent, nested: false };
}

/**
 * Extract project reference from a pi-format session file path.
 *
 * Pi stores sessions under ~/.pi/agent/sessions/<encoded-cwd>/<file>.jsonl,
 * omp under ~/.omp/agent/sessions/<encoded-cwd>/<file>.jsonl. The
 * <encoded-cwd> directory name is a path encoding — pi wraps the absolute
 * path in double dashes ("--Users-me-projects-pew--"), omp strips the home
 * prefix ("-projects-pew"), so the same repo hashes differently per source.
 *
 * We hash the directory name through hashProjectRef() for privacy.
 */
function extractProjectRef(dirName: string): string | null {
  if (!dirName) return null;
  return hashProjectRef(dirName);
}

/**
 * Collect session snapshots from a pi-format JSONL session file.
 *
 * Each file is one session. We scan all lines to collect:
 * - Session ID from the header line (type: "session")
 * - Message counts (user, assistant, total)
 * - Timestamps for wall-clock duration
 * - Last seen model
 *
 * omp writes task-subagent and advisor transcripts as nested files carrying
 * their own `type: "session"` header. Those are agent-driven, so they are
 * reported as `kind: "automated"` and attributed to the parent project dir.
 */
export async function collectPiSessions(
  filePath: string,
  source: Source = "pi",
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

        // Advisor/subagent prompts are persisted as user messages tagged
        // `attribution: "agent"` — they are not human turns.
        if (role === "user" && msg.attribution !== "agent") {
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

  const { dirName, nested } = locateSession(filePath);
  const projectRef = extractProjectRef(dirName);

  return [
    {
      sessionKey: `${source}:${sessionId}`,
      source,
      kind: nested ? "automated" : "human",
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
