import { createHash } from "node:crypto";
import { toQueueRecord } from "../commands/session-sync-helpers.js";
import { hashProjectRef } from "../utils/hash-project-ref.js";
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

  it.each(["git_root_dir", "cwd"])("hashes a raw hash-shaped identifier from %s before upload", async (field) => {
    const raw = "0123456789abcdef";
    await writeFile(join(sessionDir, "summary.json"), JSON.stringify({
      info: { id: "hex-project", ...(field === "cwd" ? { cwd: raw } : {}) },
      ...(field === "git_root_dir" ? { git_root_dir: raw } : {}),
      created_at: "2026-09-25T00:00:00Z",
    }));
    const snapshot = await parseGrokSession(sessionDir);
    const expected = createHash("sha256").update(raw).digest("hex").slice(0, 16);
    expect(snapshot?.projectRef).toBe(expected);
    expect(toQueueRecord(snapshot!).project_ref).toBe(expected);
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
    expect(snap!.projectRef).toBe(hashProjectRef("/tmp/proj/"));
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

  it("keeps legacy session metadata when chat counts and last activity are absent", async () => {
    await writeFile(
      join(sessionDir, "summary.json"),
      JSON.stringify({
        info: { id: "legacy-session", cwd: "/tmp/legacy-project" },
        created_at: "2026-07-10T00:00:00Z",
        updated_at: "2026-07-10T00:10:00Z",
        num_messages: 42,
      }),
    );

    expect(await parseGrokSession(sessionDir)).toMatchObject({
      sessionKey: "legacy-session",
      source: "grok",
      lastMessageAt: "2026-07-10T00:10:00Z",
      projectRef: hashProjectRef("/tmp/legacy-project"),
      totalMessages: 0,
      userMessages: 0,
      assistantMessages: 0,
      durationSeconds: 0,
    });
  });

  it("ignores an incomplete session summary without a creation timestamp", async () => {
    await writeFile(
      join(sessionDir, "summary.json"),
      JSON.stringify({ info: { id: "incomplete-session" } }),
    );

    expect(await parseGrokSession(sessionDir)).toBeNull();
  });

  it("keeps malformed activity counters from producing negative or non-finite totals", async () => {
    await writeFile(
      join(sessionDir, "summary.json"),
      JSON.stringify({
        info: { id: "malformed-counters" },
        created_at: "2026-07-10T00:00:00Z",
        num_chat_messages: -5,
      }),
    );
    await writeFile(
      join(sessionDir, "signals.json"),
      JSON.stringify({
        sessionDurationSeconds: "Infinity",
        userMessageCount: "unknown",
        assistantMessageCount: -1,
      }),
    );

    expect(await parseGrokSession(sessionDir)).toMatchObject({
      durationSeconds: 0,
      userMessages: 0,
      assistantMessages: 0,
      totalMessages: 0,
    });
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
