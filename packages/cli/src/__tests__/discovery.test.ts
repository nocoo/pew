import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  discoverClaudeFiles,
  discoverGeminiFiles,
  discoverOpenCodeFiles,
  discoverOpenClawFiles,
  discoverVscodeCopilotFiles,
  discoverCopilotCliFiles,
  discoverCodexFiles,
} from "../discovery/sources.js";

describe("discoverClaudeFiles", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-discover-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should find JSONL files in project directories", async () => {
    const projectDir = join(tempDir, ".claude", "projects", "project-a");
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, "session1.jsonl"), "{}");
    await writeFile(join(projectDir, "session2.jsonl"), "{}");
    await writeFile(join(projectDir, "notes.txt"), "not a jsonl");

    const files = await discoverClaudeFiles(join(tempDir, ".claude"));
    expect(files).toHaveLength(2);
    expect(files.every((f) => f.endsWith(".jsonl"))).toBe(true);
  });

  it("should return empty array if directory does not exist", async () => {
    const files = await discoverClaudeFiles(join(tempDir, "nonexistent"));
    expect(files).toEqual([]);
  });
});

describe("discoverGeminiFiles", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-discover-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should find session JSON files in tmp directories", async () => {
    const chatDir = join(tempDir, ".gemini", "tmp", "project-a", "chats");
    await mkdir(chatDir, { recursive: true });
    await writeFile(join(chatDir, "session-2026-03-07.json"), "{}");
    await writeFile(join(chatDir, "other.txt"), "not a session");

    const files = await discoverGeminiFiles(join(tempDir, ".gemini"));
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("session-");
  });

  it("should return empty array if directory does not exist", async () => {
    const files = await discoverGeminiFiles(join(tempDir, "nonexistent"));
    expect(files).toEqual([]);
  });
});

describe("discoverOpenCodeFiles", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-discover-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should find message JSON files in session directories", async () => {
    const sesDir = join(tempDir, "storage", "message", "ses_001");
    await mkdir(sesDir, { recursive: true });
    await writeFile(join(sesDir, "msg_001.json"), "{}");
    await writeFile(join(sesDir, "msg_002.json"), "{}");

    const result = await discoverOpenCodeFiles(
      join(tempDir, "storage", "message"),
    );
    expect(result.files).toHaveLength(2);
    expect(result.files.every((f) => f.endsWith(".json"))).toBe(true);
    expect(result.skippedDirs).toBe(0);
    expect(Object.keys(result.dirMtimes)).toHaveLength(1);
  });

  it("should return empty result if directory does not exist", async () => {
    const result = await discoverOpenCodeFiles(join(tempDir, "nonexistent"));
    expect(result.files).toEqual([]);
    expect(result.dirMtimes).toEqual({});
    expect(result.skippedDirs).toBe(0);
  });

  it("should skip directories with unchanged mtime", async () => {
    const messageDir = join(tempDir, "storage", "message");
    const sesDir = join(messageDir, "ses_001");
    await mkdir(sesDir, { recursive: true });
    await writeFile(join(sesDir, "msg_001.json"), "{}");

    // First discovery — collects all files
    const r1 = await discoverOpenCodeFiles(messageDir);
    expect(r1.files).toHaveLength(1);
    expect(r1.skippedDirs).toBe(0);

    // Second discovery with known mtimes — skips unchanged dir
    const r2 = await discoverOpenCodeFiles(messageDir, r1.dirMtimes);
    expect(r2.files).toHaveLength(0);
    expect(r2.skippedDirs).toBe(1);
  });
});

describe("discoverOpenClawFiles", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-discover-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should find JSONL files in agent session directories", async () => {
    const agentDir = join(tempDir, ".openclaw", "agents", "agent-1", "sessions");
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, "session1.jsonl"), "{}");

    const files = await discoverOpenClawFiles(join(tempDir, ".openclaw"));
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("session1.jsonl");
  });

  it("should return empty array if directory does not exist", async () => {
    const files = await discoverOpenClawFiles(join(tempDir, "nonexistent"));
    expect(files).toEqual([]);
  });
});

describe("discoverVscodeCopilotFiles", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-discover-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should find JSONL files in workspaceStorage chatSessions", async () => {
    const chatDir = join(tempDir, "Code", "User", "workspaceStorage", "abc123", "chatSessions");
    await mkdir(chatDir, { recursive: true });
    await writeFile(join(chatDir, "session1.jsonl"), "{}");
    await writeFile(join(chatDir, "session2.jsonl"), "{}");
    await writeFile(join(chatDir, "other.txt"), "not a jsonl");

    const files = await discoverVscodeCopilotFiles([join(tempDir, "Code", "User")]);
    expect(files).toHaveLength(2);
    expect(files.every((f) => f.endsWith(".jsonl"))).toBe(true);
  });

  it("should find JSONL files in globalStorage emptyWindowChatSessions", async () => {
    const globalDir = join(tempDir, "Code", "User", "globalStorage", "emptyWindowChatSessions");
    await mkdir(globalDir, { recursive: true });
    await writeFile(join(globalDir, "session1.jsonl"), "{}");

    const files = await discoverVscodeCopilotFiles([join(tempDir, "Code", "User")]);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("emptyWindowChatSessions");
  });

  it("should scan multiple base directories (stable + insiders)", async () => {
    const stableDir = join(tempDir, "Code", "User", "workspaceStorage", "ws1", "chatSessions");
    const insidersDir = join(tempDir, "Code - Insiders", "User", "globalStorage", "emptyWindowChatSessions");
    await mkdir(stableDir, { recursive: true });
    await mkdir(insidersDir, { recursive: true });
    await writeFile(join(stableDir, "s1.jsonl"), "{}");
    await writeFile(join(insidersDir, "s2.jsonl"), "{}");

    const files = await discoverVscodeCopilotFiles([
      join(tempDir, "Code", "User"),
      join(tempDir, "Code - Insiders", "User"),
    ]);
    expect(files).toHaveLength(2);
  });

  it("should scan multiple workspaces under workspaceStorage", async () => {
    const ws1 = join(tempDir, "Code", "User", "workspaceStorage", "abc123", "chatSessions");
    const ws2 = join(tempDir, "Code", "User", "workspaceStorage", "def456", "chatSessions");
    await mkdir(ws1, { recursive: true });
    await mkdir(ws2, { recursive: true });
    await writeFile(join(ws1, "s1.jsonl"), "{}");
    await writeFile(join(ws2, "s2.jsonl"), "{}");

    const files = await discoverVscodeCopilotFiles([join(tempDir, "Code", "User")]);
    expect(files).toHaveLength(2);
  });

  it("should return empty array when base directories do not exist", async () => {
    const files = await discoverVscodeCopilotFiles([join(tempDir, "nonexistent")]);
    expect(files).toEqual([]);
  });

  it("should return empty array for empty baseDirs array", async () => {
    const files = await discoverVscodeCopilotFiles([]);
    expect(files).toEqual([]);
  });

  it("should skip workspaces without chatSessions directory", async () => {
    const wsDir = join(tempDir, "Code", "User", "workspaceStorage", "abc123");
    await mkdir(wsDir, { recursive: true });
    // No chatSessions subdirectory

    const files = await discoverVscodeCopilotFiles([join(tempDir, "Code", "User")]);
    expect(files).toEqual([]);
  });

  it("should combine workspaceStorage and globalStorage files", async () => {
    const wsDir = join(tempDir, "Code", "User", "workspaceStorage", "abc123", "chatSessions");
    const globalDir = join(tempDir, "Code", "User", "globalStorage", "emptyWindowChatSessions");
    await mkdir(wsDir, { recursive: true });
    await mkdir(globalDir, { recursive: true });
    await writeFile(join(wsDir, "ws.jsonl"), "{}");
    await writeFile(join(globalDir, "global.jsonl"), "{}");

    const files = await discoverVscodeCopilotFiles([join(tempDir, "Code", "User")]);
    expect(files).toHaveLength(2);
  });
});

describe("discoverCopilotCliFiles", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-discover-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should find process-*.log files in logs directory", async () => {
    const logsDir = join(tempDir, "logs");
    await mkdir(logsDir, { recursive: true });
    await writeFile(join(logsDir, "process-12345.log"), "log content");
    await writeFile(join(logsDir, "process-67890.log"), "log content");
    await writeFile(join(logsDir, "other.txt"), "not a log");

    const files = await discoverCopilotCliFiles(logsDir);
    expect(files).toHaveLength(2);
    expect(files.every((f) => f.endsWith(".log"))).toBe(true);
    expect(files.every((f) => f.includes("process-"))).toBe(true);
  });

  it("should return empty array if directory does not exist", async () => {
    const files = await discoverCopilotCliFiles(join(tempDir, "nonexistent"));
    expect(files).toEqual([]);
  });

  it("should ignore non-process log files", async () => {
    const logsDir = join(tempDir, "logs");
    await mkdir(logsDir, { recursive: true });
    await writeFile(join(logsDir, "debug.log"), "debug");
    await writeFile(join(logsDir, "error.log"), "error");
    await writeFile(join(logsDir, "process.log"), "no dash suffix");

    const files = await discoverCopilotCliFiles(logsDir);
    expect(files).toEqual([]);
  });

  it("should handle empty logs directory", async () => {
    const logsDir = join(tempDir, "logs");
    await mkdir(logsDir, { recursive: true });

    const files = await discoverCopilotCliFiles(logsDir);
    expect(files).toEqual([]);
  });
});

describe("discoverCodexFiles", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-discover-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should find rollout-*.jsonl files in sessions directory", async () => {
    const dateDir = join(tempDir, "sessions", "2026", "03", "07");
    await mkdir(dateDir, { recursive: true });
    await writeFile(join(dateDir, "rollout-abc123.jsonl"), "{}");
    await writeFile(join(dateDir, "rollout-def456.jsonl"), "{}");
    await writeFile(join(dateDir, "other.txt"), "not a rollout");

    const files = await discoverCodexFiles(join(tempDir, "sessions"));
    expect(files).toHaveLength(2);
    expect(files.every((f) => f.includes("rollout-"))).toBe(true);
    expect(files.every((f) => f.endsWith(".jsonl"))).toBe(true);
  });

  it("should return empty array if directory does not exist", async () => {
    const files = await discoverCodexFiles(join(tempDir, "nonexistent"));
    expect(files).toEqual([]);
  });

  it("should combine files from primary dir and extra dirs", async () => {
    // Primary dir
    const primaryDir = join(tempDir, "primary", "2026", "03", "07");
    await mkdir(primaryDir, { recursive: true });
    await writeFile(join(primaryDir, "rollout-primary.jsonl"), "{}");

    // Extra dirs (simulating Multica)
    const extraDir1 = join(tempDir, "multica", "ws1", "sessions");
    const extraDir2 = join(tempDir, "multica", "ws2", "sessions");
    await mkdir(extraDir1, { recursive: true });
    await mkdir(extraDir2, { recursive: true });
    await writeFile(join(extraDir1, "rollout-extra1.jsonl"), "{}");
    await writeFile(join(extraDir2, "rollout-extra2.jsonl"), "{}");

    const files = await discoverCodexFiles(
      join(tempDir, "primary"),
      [extraDir1, extraDir2],
    );
    expect(files).toHaveLength(3);
    expect(files.some((f) => f.includes("rollout-primary.jsonl"))).toBe(true);
    expect(files.some((f) => f.includes("rollout-extra1.jsonl"))).toBe(true);
    expect(files.some((f) => f.includes("rollout-extra2.jsonl"))).toBe(true);
    // Verify sorted
    expect(files).toEqual([...files].sort());
  });

  it("should work with empty extraDirs array", async () => {
    const dateDir = join(tempDir, "sessions", "2026", "03", "07");
    await mkdir(dateDir, { recursive: true });
    await writeFile(join(dateDir, "rollout-abc.jsonl"), "{}");

    const files = await discoverCodexFiles(join(tempDir, "sessions"), []);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("rollout-abc.jsonl");
  });

  it("should work with undefined extraDirs", async () => {
    const dateDir = join(tempDir, "sessions", "2026", "03", "07");
    await mkdir(dateDir, { recursive: true });
    await writeFile(join(dateDir, "rollout-abc.jsonl"), "{}");

    const files = await discoverCodexFiles(join(tempDir, "sessions"), undefined);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("rollout-abc.jsonl");
  });

  it("should handle nonexistent extra dirs gracefully", async () => {
    const primaryDir = join(tempDir, "primary", "2026", "03", "07");
    await mkdir(primaryDir, { recursive: true });
    await writeFile(join(primaryDir, "rollout-primary.jsonl"), "{}");

    const files = await discoverCodexFiles(
      join(tempDir, "primary"),
      [join(tempDir, "nonexistent1"), join(tempDir, "nonexistent2")],
    );
    // Only primary dir files found
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("rollout-primary.jsonl");
  });
});
