import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Generic base class for persisting cursor state to disk as JSON.
 *
 * Both `CursorStore` (token cursors) and `SessionCursorStore` (session cursors)
 * share identical load/save logic — only the filename and empty-state factory differ.
 */
export class BaseCursorStore<T> {
  readonly filePath: string;
  private readonly emptyState: () => T;

  constructor(filePath: string, emptyState: () => T) {
    this.filePath = filePath;
    this.emptyState = emptyState;
  }

  /** Load cursor state from disk. Returns empty state if file doesn't exist or is corrupted. */
  async load(): Promise<T> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      return JSON.parse(raw) as T;
    } catch {
      return this.emptyState();
    }
  }

  /** Save cursor state to disk, creating the directory if needed. */
  async save(state: T): Promise<void> {
    const dir = dirname(this.filePath);
    await mkdir(dir, { recursive: true });
    await writeFile(this.filePath, JSON.stringify(state, null, 2) + "\n");
  }
}
