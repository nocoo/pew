import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withStateLock } from "../storage/state-lock.js";

describe("state mutation lock", () => {
  it("excludes competing mutations and releases after a failed transaction", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pew-state-lock-"));
    try {
      await expect(withStateLock(dir, async () => {
        await expect(withStateLock(dir, async () => { throw new Error("must not run"); })).rejects.toThrow("Pew state is busy");
        throw new Error("transaction failed");
      })).rejects.toThrow("transaction failed");
      expect(await withStateLock(dir, async () => "recovered")).toBe("recovered");
      // A partial/dead lock is never stolen while another process may own it.
      const path = join(dir, "state.lock"); await writeFile(path, "{");
      await expect(withStateLock(dir, async () => {})).rejects.toThrow("Pew state is busy");
      expect(await readFile(path, "utf8")).toBe("{");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
