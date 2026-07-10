import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseGrokSession } from "../parsers/grok-session.js";

describe("parseGrokSession", () => {
  let dir: string;
  let sessionDir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pew-grok-session-"));
    sessionDir = join(dir, "session");
    await mkdir(sessionDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("parses complete summary.json + signals.json", async () => {
    await writeFile(
      join(sessionDir, "summary.json"),
      JSON.stringify({
        info: { id: "sid-1", cwd: "/tmp/proj" },
        created_at: "2026-07-10T00:37:48.494738Z",
        updated_at: "2026-07-10T00:38:09.373039Z",
        last_active_at: "2026-07-10T00:38:09.334793Z",
        num_messages: 61,
        num_chat_messages: 22,
        current_model_id: "grok-4.5",
        git_root_dir: "/tmp/proj/",
      }),
    );
    await writeFile(
      join(sessionDir, "signals.json"),
      JSON.stringify({
        sessionDurationSeconds: 18,
        userMessageCount: 1,
        assistantMessageCount: 3,
      }),
    );

    const snap = await parseGrokSession(sessionDir);
    expect(snap).not.toBeNull();
    expect(snap!.sessionKey).toBe("sid-1");
    expect(snap!.source).toBe("grok");
    expect(snap!.kind).toBe("human");
    expect(snap!.startedAt).toBe("2026-07-10T00:37:48.494738Z");
    expect(snap!.lastMessageAt).toBe("2026-07-10T00:38:09.334793Z");
    expect(snap!.durationSeconds).toBe(18);
    expect(snap!.userMessages).toBe(1);
    expect(snap!.assistantMessages).toBe(3);
    expect(snap!.totalMessages).toBe(22); // NOT num_messages (61)
    expect(snap!.projectRef).toBe("/tmp/proj/");
    expect(snap!.model).toBe("grok-4.5");
  });

  it("works when signals.json is missing", async () => {
    await writeFile(
      join(sessionDir, "summary.json"),
      JSON.stringify({
        info: { id: "sid-2", cwd: "/tmp/x" },
        created_at: "2026-07-10T00:00:00Z",
        num_chat_messages: 5,
        current_model_id: "grok-4.5",
      }),
    );
    const snap = await parseGrokSession(sessionDir);
    expect(snap).not.toBeNull();
    expect(snap!.startedAt).toBe("2026-07-10T00:00:00Z");
    expect(snap!.model).toBe("grok-4.5");
    expect(snap!.userMessages).toBe(0);
    expect(snap!.assistantMessages).toBe(0);
    expect(snap!.totalMessages).toBe(5);
    expect(snap!.durationSeconds).toBe(0);
  });

  it("sets model null when current_model_id is missing", async () => {
    await writeFile(
      join(sessionDir, "summary.json"),
      JSON.stringify({
        info: { id: "sid-3" },
        created_at: "2026-07-10T00:00:00Z",
        num_chat_messages: 0,
      }),
    );
    const snap = await parseGrokSession(sessionDir);
    expect(snap!.model).toBeNull();
  });

  it("returns null on corrupt summary.json", async () => {
    await writeFile(join(sessionDir, "summary.json"), "{not-json");
    const snap = await parseGrokSession(sessionDir);
    expect(snap).toBeNull();
  });

  it("returns null when summary is missing info.id", async () => {
    await writeFile(
      join(sessionDir, "summary.json"),
      JSON.stringify({ created_at: "2026-07-10T00:00:00Z" }),
    );
    expect(await parseGrokSession(sessionDir)).toBeNull();
  });
});
