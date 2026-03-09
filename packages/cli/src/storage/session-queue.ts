import { BaseQueue } from "./base-queue.js";
import type { SessionQueueRecord } from "@pew/core";

/**
 * Append-only local queue for session records.
 * Thin wrapper around BaseQueue with session-specific file names.
 */
export class SessionQueue extends BaseQueue<SessionQueueRecord> {
  constructor(storeDir: string) {
    super(storeDir, "session-queue.jsonl", "session-queue.state.json");
  }
}
