import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectCopilotCliSessions } from "../parsers/copilot-cli-session.js";

describe("collectCopilotCliSessions", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-copilot-cli-session-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns empty array for non-existent file", async () => {
    const result = await collectCopilotCliSessions("/non/existent/path.log");
    expect(result).toEqual([]);
  });

  it("returns empty array for empty file", async () => {
    const filePath = join(tempDir, "empty.log");
    await writeFile(filePath, "");
    const result = await collectCopilotCliSessions(filePath);
    expect(result).toEqual([]);
  });

  it("returns empty array when no session ID found", async () => {
    const filePath = join(tempDir, "no-session.log");
    await writeFile(
      filePath,
      `2026-04-11T11:12:04.598Z [INFO] Starting Copilot CLI: 1.0.24
2026-04-11T11:12:05.288Z [INFO] Welcome nocoo!
`,
    );
    const result = await collectCopilotCliSessions(filePath);
    expect(result).toEqual([]);
  });

  it("returns empty array when no AI requests made", async () => {
    const filePath = join(tempDir, "no-requests.log");
    await writeFile(
      filePath,
      `2026-04-11T11:12:04.598Z [INFO] Session indexing debug: SESSION_INDEXING=false
2026-04-11T11:12:04.615Z [INFO] Workspace initialized: 35c0aae8-83ce-4d63-b26c-8612f06cbbda (checkpoints: 0)
2026-04-11T11:12:05.288Z [INFO] Welcome nocoo (via gh)!
`,
    );
    const result = await collectCopilotCliSessions(filePath);
    expect(result).toEqual([]);
  });

  it("extracts session from valid log file", async () => {
    const filePath = join(tempDir, "valid.log");
    await writeFile(
      filePath,
      `2026-04-11T11:12:04.598Z [INFO] Session indexing debug: SESSION_INDEXING=false
2026-04-11T11:12:04.615Z [INFO] Workspace initialized: 35c0aae8-83ce-4d63-b26c-8612f06cbbda (checkpoints: 0)
2026-04-11T11:12:04.617Z [INFO] Starting Copilot CLI: 1.0.24
2026-04-11T11:12:05.288Z [INFO] Welcome nocoo (via gh)!
2026-04-11T11:12:07.123Z [INFO] Using default model: claude-sonnet-4.6
2026-04-11T11:12:28.633Z [INFO] --- Start of group: Sending request to the AI model ---
2026-04-11T11:12:32.177Z [INFO] --- End of group ---
2026-04-11T11:12:35.071Z [INFO] --- Start of group: Sending request to the AI model ---
2026-04-11T11:12:40.119Z [INFO] --- End of group ---
2026-04-11T11:12:41.064Z [INFO] --- Start of group: Sending request to the AI model ---
2026-04-11T11:12:44.641Z [INFO] --- End of group ---
2026-04-11T11:13:03.142Z [INFO] Unregistering foreground session: 35c0aae8-83ce-4d63-b26c-8612f06cbbda
`,
    );
    const result = await collectCopilotCliSessions(filePath);

    expect(result).toHaveLength(1);
    const session = result[0];
    expect(session.sessionKey).toBe("copilot-cli:35c0aae8-83ce-4d63-b26c-8612f06cbbda");
    expect(session.source).toBe("copilot-cli");
    expect(session.kind).toBe("human");
    expect(session.model).toBe("claude-sonnet-4.6");
    expect(session.userMessages).toBe(3);
    expect(session.assistantMessages).toBe(3);
    expect(session.totalMessages).toBe(6); // user + assistant per spec
    expect(session.startedAt).toBe("2026-04-11T11:12:04.598Z");
    expect(session.lastMessageAt).toBe("2026-04-11T11:12:41.064Z");
    // Duration: from 11:12:04.598 to 11:12:41.064 = ~36 seconds
    expect(session.durationSeconds).toBeGreaterThanOrEqual(36);
    expect(session.durationSeconds).toBeLessThanOrEqual(37);
    expect(session.projectRef).toBeNull();
  });

  it("handles session without model specification", async () => {
    const filePath = join(tempDir, "no-model.log");
    await writeFile(
      filePath,
      `2026-04-11T11:12:04.598Z [INFO] Session indexing debug: SESSION_INDEXING=false
2026-04-11T11:12:04.615Z [INFO] Workspace initialized: abc12345-1234-5678-90ab-cdef01234567 (checkpoints: 0)
2026-04-11T11:12:05.288Z [INFO] Welcome nocoo (via gh)!
2026-04-11T11:12:28.633Z [INFO] --- Start of group: Sending request to the AI model ---
2026-04-11T11:12:32.177Z [INFO] --- End of group ---
`,
    );
    const result = await collectCopilotCliSessions(filePath);

    expect(result).toHaveLength(1);
    expect(result[0].model).toBeNull();
    expect(result[0].userMessages).toBe(1);
  });

  it("handles multiple AI requests in one session", async () => {
    const filePath = join(tempDir, "multi-requests.log");
    let content = `2026-04-11T11:12:04.598Z [INFO] Workspace initialized: 12345678-1234-5678-1234-123456789abc (checkpoints: 0)
2026-04-11T11:12:07.123Z [INFO] Using default model: gpt-4o
`;
    // Add 10 AI requests
    for (let i = 0; i < 10; i++) {
      const seconds = 12 + i;
      content += `2026-04-11T11:${seconds.toString().padStart(2, "0")}:28.633Z [INFO] --- Start of group: Sending request to the AI model ---\n`;
      content += `2026-04-11T11:${seconds.toString().padStart(2, "0")}:32.177Z [INFO] --- End of group ---\n`;
    }
    await writeFile(filePath, content);

    const result = await collectCopilotCliSessions(filePath);

    expect(result).toHaveLength(1);
    expect(result[0].userMessages).toBe(10);
    expect(result[0].assistantMessages).toBe(10);
    expect(result[0].totalMessages).toBe(20); // user + assistant per spec
  });

  it("handles AI request line without a timestamp (falls back to firstTimestamp)", async () => {
    const filePath = join(tempDir, "no-ts-request.log");
    // First two lines have timestamps; the request line itself does NOT.
    const content = [
      "2026-04-11T11:00:00.000Z [INFO] Workspace initialized: 12345678-1234-5678-1234-123456789abc (checkpoints: 0)",
      "2026-04-11T11:00:01.000Z [INFO] Using default model: gpt-4o",
      "[INFO] --- Start of group: Sending request to the AI model ---", // no timestamp prefix
      "", // also covers `if (!line) continue` early-skip
    ].join("\n") + "\n";
    await writeFile(filePath, content);

    const result = await collectCopilotCliSessions(filePath);
    expect(result).toHaveLength(1);
    expect(result[0].userMessages).toBe(1);
    // Without a request-line timestamp, lastMessageAt falls back to firstTimestamp.
    expect(result[0].lastMessageAt).toBe("2026-04-11T11:00:00.000Z");
    expect(result[0].durationSeconds).toBe(0);
  });

  it("keeps the first encountered timestamp even when later lines also have timestamps", async () => {
    const filePath = join(tempDir, "multi-ts.log");
    const content = [
      "2026-04-11T10:00:00.000Z [INFO] some unrelated startup line",
      "2026-04-11T11:00:00.000Z [INFO] Workspace initialized: 12345678-1234-5678-1234-123456789abc (checkpoints: 0)",
      "2026-04-11T11:00:01.000Z [INFO] Using default model: gpt-4o",
      "2026-04-11T11:00:02.000Z [INFO] --- Start of group: Sending request to the AI model ---",
    ].join("\n") + "\n";
    await writeFile(filePath, content);

    const result = await collectCopilotCliSessions(filePath);
    expect(result).toHaveLength(1);
    // firstTimestamp is set on the very first timestamped line; subsequent lines
    // hit the `timestamp && !firstTimestamp` short-circuit (false branch).
    expect(result[0].startedAt).toBe("2026-04-11T10:00:00.000Z");
  });
});
