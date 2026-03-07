import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { CursorState } from "@zebra/core";

const CURSORS_FILE = "cursors.json";

/** Creates a fresh empty cursor state */
function emptyCursorState(): CursorState {
  return { version: 1, files: {}, updatedAt: null };
}

/**
 * Persists incremental parsing cursors to disk.
 * Stored at ~/.config/zebra/cursors.json
 */
export class CursorStore {
  readonly filePath: string;

  constructor(storeDir: string) {
    this.filePath = join(storeDir, CURSORS_FILE);
  }

  /** Load cursor state from disk. Returns empty state if file doesn't exist or is corrupted. */
  async load(): Promise<CursorState> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      return JSON.parse(raw) as CursorState;
    } catch {
      return emptyCursorState();
    }
  }

  /** Save cursor state to disk, creating the directory if needed. */
  async save(state: CursorState): Promise<void> {
    const dir = dirname(this.filePath);
    await mkdir(dir, { recursive: true });
    await writeFile(this.filePath, JSON.stringify(state, null, 2) + "\n");
  }
}
