import { BaseQueue } from "./base-queue.js";
import type { QueueRecord } from "@pew/core";

/**
 * Append-only local queue for token usage records.
 * Thin wrapper around BaseQueue with token-specific file names.
 */
export class LocalQueue extends BaseQueue<QueueRecord> {
  constructor(storeDir: string) {
    super(storeDir, "queue.jsonl", "queue.state.json");
  }
}
