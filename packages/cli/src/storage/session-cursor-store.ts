import { join } from "node:path";
import type { SessionCursorState } from "@pew/core";
import { BaseCursorStore } from "./base-cursor-store.js";

const CURSORS_FILE = "session-cursors.json";

/**
 * Persists session file cursors (mtime + size dual-check) to disk.
 * Stored at ~/.config/pew/session-cursors.json
 */
export class SessionCursorStore extends BaseCursorStore<SessionCursorState> {
  constructor(storeDir: string) {
    super(
      join(storeDir, CURSORS_FILE),
      () => ({ version: 1, files: {}, updatedAt: null }),
    );
  }
}
