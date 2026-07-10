import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stat } from "node:fs/promises";
import { grokSessionDriver } from "../../../drivers/session/grok-session-driver.js";
import type { FileFingerprint } from "../../../drivers/types.js";

async function fingerprint(path: string): Promise<FileFingerprint> {
  const st = await stat(path);
  return {
    inode: (st as unknown as { ino: number }).ino,
    mtimeMs: st.mtimeMs,
    size: st.size,
  };
}

describe("grokSessionDriver", () => {
  let root: string;
  let sessionsDir: string;
  let summaryPath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "pew-grok-sess-drv-"));
    sessionsDir = join(root, "sessions");
    const sessionDir = join(sessionsDir, "%2Ftmp", "sid-1");
    await mkdir(sessionDir, { recursive: true });
    summaryPath = join(sessionDir, "summary.json");
    await writeFile(
      summaryPath,
      JSON.stringify({
        info: { id: "sid-1", cwd: "/tmp" },
        created_at: "2026-07-10T00:00:00Z",
        last_active_at: "2026-07-10T00:01:00Z",
        num_chat_messages: 4,
        current_model_id: "grok-4.5",
      }),
    );
    await writeFile(
      join(sessionDir, "signals.json"),
      JSON.stringify({
        userMessageCount: 1,
        assistantMessageCount: 3,
        sessionDurationSeconds: 60,
      }),
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("discovers summary.json files", async () => {
    const files = await grokSessionDriver.discover({ grokSessionsDir: sessionsDir });
    expect(files).toEqual([summaryPath]);
  });

  it("parses session snapshot from summary parent dir", async () => {
    const snaps = await grokSessionDriver.parse(summaryPath);
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.sessionKey).toBe("sid-1");
    expect(snaps[0]!.source).toBe("grok");
    expect(snaps[0]!.totalMessages).toBe(4);
    expect(snaps[0]!.model).toBe("grok-4.5");
  });

  it("shouldSkip when mtime and size unchanged", async () => {
    const fp = await fingerprint(summaryPath);
    const cursor = grokSessionDriver.buildCursor(fp);
    expect(grokSessionDriver.shouldSkip(cursor, fp)).toBe(true);
  });

  it("does not skip when fingerprint changes", async () => {
    const fp = await fingerprint(summaryPath);
    const cursor = grokSessionDriver.buildCursor(fp);
    const changed: FileFingerprint = { ...fp, mtimeMs: fp.mtimeMs + 1 };
    expect(grokSessionDriver.shouldSkip(cursor, changed)).toBe(false);
  });
});
