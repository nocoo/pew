import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectKosmosSessionSnapshots } from "../parsers/kosmos-session.js";

/** Helper: create a minimal Kosmos chat session JSON for session parsing */
function kosmosSession(opts: {
  chatSessionId?: string;
  messages?: Array<{
    role?: string;
    model?: string;
    timestamp?: number;
  }>;
}): string {
  const messages = (opts.messages ?? []).map((m) => ({
    id: `msg-${Math.random().toString(36).slice(2)}`,
    role: m.role ?? "assistant",
    model: m.model ?? "gpt-4o",
    timestamp: m.timestamp ?? Date.now(),
  }));

  return JSON.stringify({
    chatSession_id: opts.chatSessionId ?? "ses-001",
    chat_history: messages,
  });
}

describe("collectKosmosSessionSnapshots", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-kosmos-session-parser-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should collect a session snapshot from a valid file", async () => {
    const filePath = join(tempDir, "chatSession_001.json");
    await writeFile(filePath, kosmosSession({
      chatSessionId: "ses-123",
      messages: [
        { role: "user", timestamp: 1700000000000 },
        { role: "assistant", model: "gpt-4o", timestamp: 1700000005000 },
        { role: "user", timestamp: 1700000010000 },
        { role: "assistant", model: "claude-sonnet-4", timestamp: 1700000015000 },
      ],
    }));

    const snapshots = await collectKosmosSessionSnapshots({ filePath });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].sessionKey).toBe("kosmos:ses-123");
    expect(snapshots[0].source).toBe("kosmos");
    expect(snapshots[0].kind).toBe("human");
    expect(snapshots[0].userMessages).toBe(2);
    expect(snapshots[0].assistantMessages).toBe(2);
    expect(snapshots[0].totalMessages).toBe(4);
    expect(snapshots[0].durationSeconds).toBe(15);
    expect(snapshots[0].model).toBe("claude-sonnet-4"); // last model
  });

  it("should return empty for missing file", async () => {
    const snapshots = await collectKosmosSessionSnapshots({ filePath: join(tempDir, "nope.json") });
    expect(snapshots).toHaveLength(0);
  });

  it("should return empty for invalid JSON", async () => {
    const filePath = join(tempDir, "chatSession_bad.json");
    await writeFile(filePath, "not json");
    const snapshots = await collectKosmosSessionSnapshots({ filePath });
    expect(snapshots).toHaveLength(0);
  });

  it("should return empty for missing chatSession_id", async () => {
    const filePath = join(tempDir, "chatSession_no_id.json");
    await writeFile(filePath, JSON.stringify({
      chat_history: [{ role: "user", timestamp: 1700000000000 }],
    }));
    const snapshots = await collectKosmosSessionSnapshots({ filePath });
    expect(snapshots).toHaveLength(0);
  });

  it("should return empty for empty chat_history", async () => {
    const filePath = join(tempDir, "chatSession_empty.json");
    await writeFile(filePath, JSON.stringify({
      chatSession_id: "ses-empty",
      chat_history: [],
    }));
    const snapshots = await collectKosmosSessionSnapshots({ filePath });
    expect(snapshots).toHaveLength(0);
  });

  it("should handle single-message session", async () => {
    const filePath = join(tempDir, "chatSession_single.json");
    await writeFile(filePath, kosmosSession({
      chatSessionId: "ses-single",
      messages: [
        { role: "user", timestamp: 1700000000000 },
      ],
    }));

    const snapshots = await collectKosmosSessionSnapshots({ filePath });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].durationSeconds).toBe(0);
    expect(snapshots[0].userMessages).toBe(1);
    expect(snapshots[0].assistantMessages).toBe(0);
  });

  it("should return empty for empty file", async () => {
    const filePath = join(tempDir, "chatSession_blank.json");
    await writeFile(filePath, "");
    const snapshots = await collectKosmosSessionSnapshots({ filePath });
    expect(snapshots).toHaveLength(0);
  });

  it("should handle chat_history not being an array", async () => {
    const filePath = join(tempDir, "chatSession_badhist.json");
    await writeFile(filePath, JSON.stringify({ chatSession_id: "ses-bad", chat_history: "oops" }));
    const snapshots = await collectKosmosSessionSnapshots({ filePath });
    expect(snapshots).toHaveLength(0);
  });

  it("should skip null entries in chat_history", async () => {
    const filePath = join(tempDir, "chatSession_nullmsg.json");
    await writeFile(filePath, JSON.stringify({
      chatSession_id: "ses-null",
      chat_history: [null, { role: "user", timestamp: 1700000000000 }],
    }));
    const snapshots = await collectKosmosSessionSnapshots({ filePath });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].totalMessages).toBe(1);
  });

  it("should handle messages without timestamps", async () => {
    const filePath = join(tempDir, "chatSession_nots.json");
    await writeFile(filePath, JSON.stringify({
      chatSession_id: "ses-nots",
      chat_history: [{ role: "user" }, { role: "assistant" }],
    }));
    const snapshots = await collectKosmosSessionSnapshots({ filePath });
    expect(snapshots).toHaveLength(0); // no valid timestamps → empty
  });

  it("should handle assistant messages without model", async () => {
    const filePath = join(tempDir, "chatSession_nomodel.json");
    await writeFile(filePath, JSON.stringify({
      chatSession_id: "ses-nomodel",
      chat_history: [
        { role: "user", timestamp: 1700000000000 },
        { role: "assistant", timestamp: 1700000001000 },
      ],
    }));
    const snapshots = await collectKosmosSessionSnapshots({ filePath });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].model).toBeNull();
  });
});
