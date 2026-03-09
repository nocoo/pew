import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

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

  constructor(storeDir: string, queueFile: string, stateFile: string) {
    this.dir = storeDir;
    this.queuePath = join(storeDir, queueFile);
    this.statePath = join(storeDir, stateFile);
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
   * Read records from the queue starting at a byte offset.
   * Returns parsed records and the new offset (end of file in bytes).
   *
   * - Uses Buffer for slicing to correctly handle multi-byte UTF-8 characters.
   * - Skips lines that fail JSON.parse instead of throwing.
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
      } catch {
        // Skip corrupted lines — log would be nice but we keep it silent
        // to avoid coupling to a logger. The line is simply lost.
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
