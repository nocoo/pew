import { join } from "node:path";
import type { CursorState } from "@pew/core";
import { BaseCursorStore } from "./base-cursor-store.js";

const CURSORS_FILE = "cursors.json";

/**
 * Persists incremental parsing cursors to disk.
 * Stored at ~/.config/pew/cursors.json
 */
export class CursorStore extends BaseCursorStore<CursorState> {
  constructor(storeDir: string) {
    super(
      join(storeDir, CURSORS_FILE),
      () => ({ version: 1, files: {}, updatedAt: null }),
    );
  }
}
