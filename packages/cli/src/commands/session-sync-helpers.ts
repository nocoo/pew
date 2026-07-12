/**
 * Pure helpers extracted from session-sync.ts. Keeps the orchestrator file
 * under the 400-LOC complexity guideline. No runtime behavior change.
 */
import type {
  SessionQueueRecord,
  SessionSnapshot,
  Source,
} from "@pew/core";
import { hashProjectRef } from "../utils/hash-project-ref.js";

/** Result key map for executeSessionSync (kept in sync with SessionSyncResult.sources). */
export type SessionSyncSourceKey =
  | "claude"
  | "codex"
  | "copilotCli"
  | "gemini"
  | "grok"
  | "kosmos"
  | "opencode"
  | "openclaw"
  | "pi"
  | "pmstudio"
  | "zcode";

/**
 * Convert a SessionSnapshot to a SessionQueueRecord for upload.
 *
 * Project refs MUST be hashed before leaving the device. If a parser forgot
 * to hash, this function applies hashProjectRef as a safety net.
 */
export function toQueueRecord(snap: SessionSnapshot): SessionQueueRecord {
  let projectRef = snap.projectRef;
  if (projectRef !== null && !/^[a-f0-9]{16}$/.test(projectRef)) {
    projectRef = hashProjectRef(projectRef);
  }

  return {
    session_key: snap.sessionKey,
    source: snap.source,
    kind: snap.kind,
    started_at: snap.startedAt,
    last_message_at: snap.lastMessageAt,
    duration_seconds: snap.durationSeconds,
    user_messages: snap.userMessages,
    assistant_messages: snap.assistantMessages,
    total_messages: snap.totalMessages,
    project_ref: projectRef,
    model: snap.model,
    snapshot_at: snap.snapshotAt,
  };
}

/**
 * Map Source type to short result key (null if source has no session driver).
 */
export function sourceKey(source: Source): SessionSyncSourceKey | null {
  switch (source) {
    case "claude-code": return "claude";
    case "codex": return "codex";
    case "copilot-cli": return "copilotCli";
    case "gemini-cli": return "gemini";
    case "grok": return "grok";
    case "kosmos": return "kosmos";
    case "opencode": return "opencode";
    case "openclaw": return "openclaw";
    case "pi": return "pi";
    case "pmstudio": return "pmstudio";
    case "vscode-copilot": return null;
    case "hermes": return null;
    case "zcode": return "zcode";
    default: {
      // Exhaustiveness check — if Source adds a new value, this will fail to compile
      const _exhaustive: never = source;
      throw new Error(`Unknown source: ${_exhaustive}`);
    }
  }
}
