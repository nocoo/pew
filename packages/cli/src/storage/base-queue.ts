import { readFile, writeFile, appendFile, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";

/** Optional callback invoked when a corrupted JSONL line is skipped */
export type OnCorruptLine = (line: string, error: unknown) => void;

/**
 * Generic append-only JSONL queue with byte-offset tracking.
 *
 * Records are stored as newline-delimited JSON. A separate state file
 * tracks how far the upload cursor has progressed (in bytes).
 *
 * Bug fixes over the original LocalQueue/SessionQueue:
 * - readFromOffset uses Buffer slicing (byte offset) instead of String.slice
 *   (character offset), which broke on non-ASCII content.
 * - Per-line JSON.parse error handling: corrupted lines are skipped instead
 *   of blocking all subsequent records.
 */
export class BaseQueue<T> {
  readonly queuePath: string;
  private readonly statePath: string;
  private readonly dir: string;
  private readonly onCorruptLine?: OnCorruptLine;

  constructor(
    storeDir: string,
    queueFile: string,
    stateFile: string,
    onCorruptLine?: OnCorruptLine,
  ) {
    this.dir = storeDir;
    this.queuePath = join(storeDir, queueFile);
    this.statePath = join(storeDir, stateFile);
    this.onCorruptLine = onCorruptLine;
  }

  /** Ensure the directory exists */
  private async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  /** Append a single record to the queue */
  async append(record: T): Promise<void> {
    await this.ensureDir();
    await appendFile(this.queuePath, JSON.stringify(record) + "\n");
  }

  /** Append multiple records to the queue in a single write */
  async appendBatch(records: T[]): Promise<void> {
    if (records.length === 0) return;
    await this.ensureDir();
    const data = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
    await appendFile(this.queuePath, data);
  }

  /**
   * Atomically overwrite the queue with new records (write tmp → rename).
   *
   * This replaces the entire queue file contents. Empty array clears the file.
   * The atomic write-then-rename prevents partial reads if the process crashes
   * mid-write.
   */
  async overwrite(records: T[]): Promise<void> {
    await this.ensureDir();
    const data =
      records.length > 0
        ? records.map((r) => JSON.stringify(r)).join("\n") + "\n"
        : "";
    const tmpPath = this.queuePath + ".tmp";
    await writeFile(tmpPath, data);
    await rename(tmpPath, this.queuePath);
  }

  /**
   * Read records from the queue starting at a byte offset.
   * Returns parsed records and the new offset (end of file in bytes).
   *
   * - Uses Buffer for slicing to correctly handle multi-byte UTF-8 characters.
   * - Skips lines that fail JSON.parse and invokes the optional onCorruptLine
   *   callback so callers can surface a warning.  The offset still advances
   *   past corrupted data to prevent infinite re-reading.  Source data can
   *   always be rebuilt via `pew reset`.
   */
  async readFromOffset(offset: number): Promise<{
    records: T[];
    newOffset: number;
  }> {
    let buf: Buffer;
    try {
      buf = await readFile(this.queuePath);
    } catch {
      return { records: [], newOffset: 0 };
    }

    const slice = buf.subarray(offset);
    const text = slice.toString("utf-8");
    const lines = text.split("\n").filter((line) => line.trim().length > 0);

    const records: T[] = [];
    for (const line of lines) {
      try {
        records.push(JSON.parse(line) as T);
      } catch (err: unknown) {
        // Corrupted lines are skipped to avoid blocking all subsequent records.
        // The onCorruptLine callback lets callers surface a user-visible warning.
        // Data is recoverable via `pew reset` which rebuilds from source files.
        this.onCorruptLine?.(line, err);
      }
    }

    const newOffset = buf.byteLength;
    return { records, newOffset };
  }

  /** Save the upload byte offset to the state file */
  async saveOffset(offset: number): Promise<void> {
    await this.ensureDir();
    await writeFile(this.statePath, JSON.stringify({ offset }) + "\n");
  }

  /** Load the upload byte offset. Returns 0 if not found or corrupted. */
  async loadOffset(): Promise<number> {
    try {
      const raw = await readFile(this.statePath, "utf-8");
      const state = JSON.parse(raw) as { offset: number };
      return state.offset ?? 0;
    } catch {
      return 0;
    }
  }
}
