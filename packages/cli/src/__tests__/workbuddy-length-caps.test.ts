import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectWorkbuddySessions } from "../parsers/workbuddy-session";
import { parseWorkbuddyFile } from "../parsers/workbuddy";
import { MAX_STRING_LENGTH } from "@pew/core";

// The server rejects `model` and `session_key` over MAX_STRING_LENGTH with a
// 400, and the upload engine does not retry or skip a 4xx — one over-long row
// would wedge every later upload for the account. The parsers must therefore
// drop such rows locally instead of queueing them.
describe("workbuddy string length caps", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "wb-len-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("drops a usage row whose model exceeds MAX_STRING_LENGTH but keeps the rest of the file", async () => {
    const path = join(tempDir, "mixed.jsonl");
    const usageRow = (model: string) => JSON.stringify({
      timestamp: Date.now(),
      providerData: { model, rawUsage: { prompt_tokens: 100 } },
    });
    await writeFile(path, [
      usageRow("x".repeat(2000)),
      usageRow("hy4-preview"),
      "",
    ].join("\n"));

    const res = await parseWorkbuddyFile({ filePath: path, startOffset: 0 });
    expect(res.deltas).toHaveLength(1);
    expect(res.deltas[0].model).toBe("hy4-preview");
  });

  it("keeps a usage row whose model sits exactly at MAX_STRING_LENGTH", async () => {
    const path = join(tempDir, "edge.jsonl");
    await writeFile(path, JSON.stringify({
      timestamp: Date.now(),
      providerData: { model: "m".repeat(1024), rawUsage: { prompt_tokens: 100 } },
    }) + "\n");

    const res = await parseWorkbuddyFile({ filePath: path, startOffset: 0 });
    expect(res.deltas).toHaveLength(1);
    expect(res.deltas[0].model).toHaveLength(1024);
  });

  it("drops a session whose constructed session_key exceeds MAX_STRING_LENGTH but keeps the rest of the file", async () => {
    const path = join(tempDir, "sessions.jsonl");
    const now = Date.now();
    const line = (sessionId: string) => JSON.stringify({
      timestamp: now,
      sessionId,
      message: { role: "user", content: "hi" },
    });
    // `workbuddy:` is 10 chars, so a 5000-char id overflows the 1024 cap.
    await writeFile(path, [
      line("s".repeat(5000)),
      line("11111111-2222-3333-4444-555555555555"),
      "",
    ].join("\n"));

    const snaps = await collectWorkbuddySessions(path);
    expect(snaps).toHaveLength(1);
    expect(snaps[0].sessionKey).toBe("workbuddy:11111111-2222-3333-4444-555555555555");
  });

  it("drops an overlong model from a session snapshot instead of queueing it", async () => {
    const path = join(tempDir, "session-model.jsonl");
    await writeFile(path, JSON.stringify({
      timestamp: Date.now(),
      sessionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      providerData: { model: "y".repeat(2000) },
      message: { role: "assistant", content: "ok" },
    }) + "\n");

    const snaps = await collectWorkbuddySessions(path);
    expect(snaps).toHaveLength(1);
    expect(snaps[0].model).toBeNull();
  });
});

describe("workbuddy timestamp server-compatibility window", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "wb-ts-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("drops a row whose timestamp is representable but outside the server's 4-digit-year window", async () => {
    // 5e15 ms passes isRepresentableEpochMs (|ms| <= 8.64e15) and formats as
    // `+160413-09-10T…Z`, but the server's ISO regex only accepts a 4-digit
    // year, so such a row would 400 the batch and wedge every later upload.
    const path = join(tempDir, "far-future.jsonl");
    await writeFile(path, [
      JSON.stringify({ timestamp: 5e15, providerData: { model: "m", rawUsage: { prompt_tokens: 100 } } }),
      JSON.stringify({ timestamp: Date.now(), providerData: { model: "m", rawUsage: { prompt_tokens: 100 } } }),
      "",
    ].join("\n"));

    const res = await parseWorkbuddyFile({ filePath: path, startOffset: 0 });
    expect(res.deltas).toHaveLength(1);
    // The kept row must round-trip through the server's own validator.
    expect(/^\d{4}-/.test(res.deltas[0]!.timestamp)).toBe(true);
  });
  it("keeps a session whose key sits exactly at MAX_STRING_LENGTH", async () => {
    const path = join(tempDir, "key-boundary.jsonl");
    // "workbuddy:" is 10 chars, so a 1014-char id puts the key at exactly 1024.
    const id = "i".repeat(1014);
    await writeFile(path, `${JSON.stringify({
      timestamp: Date.now(),
      sessionId: id,
      type: "message",
      role: "assistant",
      message: { model: "m" },
    })}\n`);

    const snaps = await collectWorkbuddySessions(path);
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.sessionKey).toHaveLength(MAX_STRING_LENGTH);
  });

  it("session bounds reject a representable-but-far-future epoch", async () => {
    const path = join(tempDir, "session-window.jsonl");
    await writeFile(path, [
      JSON.stringify({ sessionId: "ses-1", type: "message", role: "assistant", timestamp: 5e15, message: { model: "m" } }),
      JSON.stringify({ sessionId: "ses-1", type: "message", role: "assistant", timestamp: Date.now(), message: { model: "m" } }),
      "",
    ].join("\n"));

    const snaps = await collectWorkbuddySessions(path);
    expect(snaps).toHaveLength(1);
    // Only the contemporary row contributes bounds; 5e15 never appears.
    for (const snap of snaps) {
      expect(/^\d{4}-/.test(snap.startedAt)).toBe(true);
      expect(/^\d{4}-/.test(snap.lastMessageAt)).toBe(true);
    }
  });
});
