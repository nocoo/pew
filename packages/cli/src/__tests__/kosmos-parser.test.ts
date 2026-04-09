import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseKosmosFile } from "../parsers/kosmos.js";

/** Helper: create a minimal Kosmos chat session JSON */
function kosmosSession(opts: {
  chatSessionId?: string;
  messages?: Array<{
    id?: string;
    role?: string;
    model?: string;
    timestamp?: number;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  }>;
}): string {
  const messages = (opts.messages ?? []).map((m) => ({
    id: m.id ?? `msg-${Math.random().toString(36).slice(2)}`,
    role: m.role ?? "assistant",
    model: m.model ?? "gpt-4o",
    timestamp: m.timestamp ?? Date.now(),
    usage: m.usage ?? { prompt_tokens: 100, completion_tokens: 50 },
  }));

  return JSON.stringify({
    chatSession_id: opts.chatSessionId ?? "ses-001",
    chat_history: messages,
  });
}

describe("parseKosmosFile", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-kosmos-parser-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should parse assistant messages with usage", async () => {
    const filePath = join(tempDir, "chatSession_001.json");
    await writeFile(filePath, kosmosSession({
      messages: [
        { id: "msg-1", role: "assistant", model: "gpt-4o", timestamp: 1700000000000, usage: { prompt_tokens: 500, completion_tokens: 200 } },
      ],
    }));

    const result = await parseKosmosFile({ filePath, knownMessageIds: null, source: "kosmos" });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].source).toBe("kosmos");
    expect(result.deltas[0].model).toBe("gpt-4o");
    expect(result.deltas[0].tokens.inputTokens).toBe(500);
    expect(result.deltas[0].tokens.outputTokens).toBe(200);
    expect(result.deltas[0].tokens.cachedInputTokens).toBe(0);
    expect(result.deltas[0].tokens.reasoningOutputTokens).toBe(0);
    expect(result.allMessageIds).toEqual(["msg-1"]);
  });

  it("should skip user messages", async () => {
    const filePath = join(tempDir, "chatSession_002.json");
    await writeFile(filePath, kosmosSession({
      messages: [
        { id: "msg-1", role: "user", timestamp: 1700000000000 },
        { id: "msg-2", role: "assistant", model: "gpt-4o", timestamp: 1700000001000, usage: { prompt_tokens: 100, completion_tokens: 50 } },
      ],
    }));

    const result = await parseKosmosFile({ filePath, knownMessageIds: null, source: "kosmos" });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].tokens.inputTokens).toBe(100);
  });

  it("should dedup by known message IDs", async () => {
    const filePath = join(tempDir, "chatSession_003.json");
    await writeFile(filePath, kosmosSession({
      messages: [
        { id: "msg-1", role: "assistant", model: "gpt-4o", timestamp: 1700000000000, usage: { prompt_tokens: 100, completion_tokens: 50 } },
        { id: "msg-2", role: "assistant", model: "gpt-4o", timestamp: 1700000001000, usage: { prompt_tokens: 200, completion_tokens: 100 } },
      ],
    }));

    const known = new Set(["msg-1"]);
    const result = await parseKosmosFile({ filePath, knownMessageIds: known, source: "kosmos" });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].tokens.inputTokens).toBe(200);
    expect(result.allMessageIds).toEqual(["msg-1", "msg-2"]);
  });

  it("should skip messages without usage", async () => {
    const filePath = join(tempDir, "chatSession_004.json");
    const content = JSON.stringify({
      chatSession_id: "ses-004",
      chat_history: [
        { id: "msg-1", role: "assistant", model: "gpt-4o", timestamp: 1700000000000 },
      ],
    });
    await writeFile(filePath, content);

    const result = await parseKosmosFile({ filePath, knownMessageIds: null, source: "kosmos" });
    expect(result.deltas).toHaveLength(0);
    expect(result.allMessageIds).toHaveLength(0);
  });

  it("should skip messages with all-zero tokens", async () => {
    const filePath = join(tempDir, "chatSession_005.json");
    await writeFile(filePath, kosmosSession({
      messages: [
        { id: "msg-1", role: "assistant", model: "gpt-4o", timestamp: 1700000000000, usage: { prompt_tokens: 0, completion_tokens: 0 } },
      ],
    }));

    const result = await parseKosmosFile({ filePath, knownMessageIds: null, source: "kosmos" });
    expect(result.deltas).toHaveLength(0);
    expect(result.allMessageIds).toEqual(["msg-1"]);
  });

  it("should handle missing file", async () => {
    const result = await parseKosmosFile({ filePath: join(tempDir, "nonexistent.json"), knownMessageIds: null });
    expect(result.deltas).toHaveLength(0);
    expect(result.allMessageIds).toHaveLength(0);
  });

  it("should handle invalid JSON", async () => {
    const filePath = join(tempDir, "chatSession_bad.json");
    await writeFile(filePath, "not valid json{{{");

    const result = await parseKosmosFile({ filePath, knownMessageIds: null, source: "kosmos" });
    expect(result.deltas).toHaveLength(0);
  });

  it("should handle empty file", async () => {
    const filePath = join(tempDir, "chatSession_empty.json");
    await writeFile(filePath, "");

    const result = await parseKosmosFile({ filePath, knownMessageIds: null, source: "kosmos" });
    expect(result.deltas).toHaveLength(0);
  });

  it("should handle multiple assistant messages", async () => {
    const filePath = join(tempDir, "chatSession_multi.json");
    await writeFile(filePath, kosmosSession({
      messages: [
        { id: "msg-1", role: "assistant", model: "gpt-4o", timestamp: 1700000000000, usage: { prompt_tokens: 100, completion_tokens: 50 } },
        { id: "msg-2", role: "user", timestamp: 1700000001000 },
        { id: "msg-3", role: "assistant", model: "claude-sonnet-4", timestamp: 1700000002000, usage: { prompt_tokens: 300, completion_tokens: 150 } },
      ],
    }));

    const result = await parseKosmosFile({ filePath, knownMessageIds: null, source: "kosmos" });
    expect(result.deltas).toHaveLength(2);
    expect(result.deltas[0].model).toBe("gpt-4o");
    expect(result.deltas[1].model).toBe("claude-sonnet-4");
  });

  it("should use 'unknown' when model field is missing", async () => {
    const filePath = join(tempDir, "chatSession_nomodel.json");
    const content = JSON.stringify({
      chatSession_id: "ses-nomodel",
      chat_history: [
        { id: "msg-1", role: "assistant", timestamp: 1700000000000, usage: { prompt_tokens: 100, completion_tokens: 50 } },
      ],
    });
    await writeFile(filePath, content);
    const result = await parseKosmosFile({ filePath, knownMessageIds: null, source: "kosmos" });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].model).toBe("unknown");
  });

  it("should skip assistant message without id", async () => {
    const filePath = join(tempDir, "chatSession_noid.json");
    const content = JSON.stringify({
      chatSession_id: "ses-noid",
      chat_history: [
        { role: "assistant", model: "gpt-4o", timestamp: 1700000000000, usage: { prompt_tokens: 100, completion_tokens: 50 } },
      ],
    });
    await writeFile(filePath, content);
    const result = await parseKosmosFile({ filePath, knownMessageIds: null, source: "kosmos" });
    expect(result.deltas).toHaveLength(0);
    expect(result.allMessageIds).toHaveLength(0);
  });

  it("should skip assistant message without timestamp but track id", async () => {
    const filePath = join(tempDir, "chatSession_nots.json");
    const content = JSON.stringify({
      chatSession_id: "ses-nots",
      chat_history: [
        { id: "msg-1", role: "assistant", model: "gpt-4o", usage: { prompt_tokens: 100, completion_tokens: 50 } },
      ],
    });
    await writeFile(filePath, content);
    const result = await parseKosmosFile({ filePath, knownMessageIds: null, source: "kosmos" });
    expect(result.deltas).toHaveLength(0);
    expect(result.allMessageIds).toEqual(["msg-1"]);
  });

  it("should handle chat_history not being an array", async () => {
    const filePath = join(tempDir, "chatSession_badhist.json");
    await writeFile(filePath, JSON.stringify({ chatSession_id: "ses-bad", chat_history: "not-array" }));
    const result = await parseKosmosFile({ filePath, knownMessageIds: null, source: "kosmos" });
    expect(result.deltas).toHaveLength(0);
  });

  it("should handle null entries in chat_history", async () => {
    const filePath = join(tempDir, "chatSession_nullmsg.json");
    await writeFile(filePath, JSON.stringify({
      chatSession_id: "ses-null",
      chat_history: [null, undefined, { id: "msg-1", role: "assistant", model: "gpt-4o", timestamp: 1700000000000, usage: { prompt_tokens: 10, completion_tokens: 5 } }],
    }));
    const result = await parseKosmosFile({ filePath, knownMessageIds: null, source: "kosmos" });
    expect(result.deltas).toHaveLength(1);
  });

  it("should use the provided source parameter (pmstudio)", async () => {
    const filePath = join(tempDir, "chatSession_pmstudio.json");
    await writeFile(filePath, kosmosSession({
      messages: [
        { id: "msg-1", role: "assistant", model: "gpt-4o", timestamp: 1700000000000, usage: { prompt_tokens: 500, completion_tokens: 200 } },
      ],
    }));

    const result = await parseKosmosFile({ filePath, knownMessageIds: null, source: "pmstudio" });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].source).toBe("pmstudio");
  });
});
