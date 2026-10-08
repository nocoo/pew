import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, symlink, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  discoverClaudeFiles,

  discoverOpenCodeFiles,
  discoverOpenClawFiles,

  discoverCopilotCliFiles,
  discoverCodexFiles,
  discoverPiFiles,
  discoverWorkbuddyFiles,
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
    expect(r1.skippedDirPaths).toEqual([]);

    // Second discovery with known mtimes — skips unchanged dir
    const r2 = await discoverOpenCodeFiles(messageDir, r1.dirMtimes);
    expect(r2.files).toHaveLength(0);
    expect(r2.skippedDirs).toBe(1);
    expect(r2.skippedDirPaths).toEqual([sesDir]);
  });

  it("should skip subdirectories that cannot be stat'd", async () => {
    const messageDir = join(tempDir, "storage", "message");
    await mkdir(messageDir, { recursive: true });
    // Create a dangling symlink that looks like a directory entry but fails stat
    await symlink(join(tempDir, "nonexistent-target"), join(messageDir, "broken-link"));

    const result = await discoverOpenCodeFiles(messageDir);
    // Should not crash, just skip the broken entry
    expect(result.files).toEqual([]);
  });

  it("should skip subdirectories that cannot be read", async () => {
    const messageDir = join(tempDir, "storage", "message");
    const sesDir = join(messageDir, "ses_unreadable");
    await mkdir(sesDir, { recursive: true });
    await writeFile(join(sesDir, "msg.json"), "{}");
    // Make the directory unreadable
    await chmod(sesDir, 0o000);

    try {
      const result = await discoverOpenCodeFiles(messageDir);
      // Should not crash, just skip the unreadable directory
      expect(result.files).toEqual([]);
    } finally {
      // Restore permissions for cleanup
      await chmod(sesDir, 0o755);
    }
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

    const { files, complete } = await discoverCodexFiles(join(tempDir, "sessions"));
    expect(files).toHaveLength(2);
    expect(files.every((f) => f.includes("rollout-"))).toBe(true);
    expect(files.every((f) => f.endsWith(".jsonl"))).toBe(true);
    expect(complete).toBe(true);
  });

  it("should report an incomplete walk when the root does not exist", async () => {
    const { files, complete } = await discoverCodexFiles(join(tempDir, "nonexistent"));
    expect(files).toEqual([]);
    // "Cannot read the root" is not the same claim as "there is nothing here".
    expect(complete).toBe(false);
  });

  it("should report an incomplete walk when a day directory is unreadable", async () => {
    const sessionsDir = join(tempDir, "sessions");
    const readable = join(sessionsDir, "2026", "03", "07");
    const blocked = join(sessionsDir, "2026", "03", "08");
    await mkdir(readable, { recursive: true });
    await mkdir(blocked, { recursive: true });
    await writeFile(join(readable, "rollout-ok.jsonl"), "{}");
    await writeFile(join(blocked, "rollout-hidden.jsonl"), "{}");
    await chmod(blocked, 0o000);

    try {
      const { files, complete } = await discoverCodexFiles(sessionsDir);
      expect(files).toHaveLength(1);
      expect(complete).toBe(false);
    } finally {
      await chmod(blocked, 0o755);
    }
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

    const { files, complete } = await discoverCodexFiles(
      join(tempDir, "primary"),
      [extraDir1, extraDir2],
    );
    expect(files).toHaveLength(3);
    expect(files.some((f) => f.includes("rollout-primary.jsonl"))).toBe(true);
    expect(files.some((f) => f.includes("rollout-extra1.jsonl"))).toBe(true);
    expect(files.some((f) => f.includes("rollout-extra2.jsonl"))).toBe(true);
    // Verify sorted
    expect(files).toEqual([...files].sort());
    expect(complete).toBe(true);
  });

  it("should work with empty extraDirs array", async () => {
    const dateDir = join(tempDir, "sessions", "2026", "03", "07");
    await mkdir(dateDir, { recursive: true });
    await writeFile(join(dateDir, "rollout-abc.jsonl"), "{}");

    const { files } = await discoverCodexFiles(join(tempDir, "sessions"), []);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("rollout-abc.jsonl");
  });

  it("should work with undefined extraDirs", async () => {
    const dateDir = join(tempDir, "sessions", "2026", "03", "07");
    await mkdir(dateDir, { recursive: true });
    await writeFile(join(dateDir, "rollout-abc.jsonl"), "{}");

    const { files } = await discoverCodexFiles(join(tempDir, "sessions"), undefined);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("rollout-abc.jsonl");
  });

  it("should flag nonexistent extra dirs as an incomplete walk", async () => {
    const primaryDir = join(tempDir, "primary", "2026", "03", "07");
    await mkdir(primaryDir, { recursive: true });
    await writeFile(join(primaryDir, "rollout-primary.jsonl"), "{}");

    const { files, complete } = await discoverCodexFiles(
      join(tempDir, "primary"),
      [join(tempDir, "nonexistent1"), join(tempDir, "nonexistent2")],
    );
    // Only primary dir files found
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("rollout-primary.jsonl");
    expect(complete).toBe(false);
  });
});

describe("discoverPiFiles", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-discover-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should find JSONL files in sessions directory", async () => {
    const sessionsDir = join(tempDir, "agent", "sessions", "encoded-cwd");
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(join(sessionsDir, "session1.jsonl"), "{}");
    await writeFile(join(sessionsDir, "session2.jsonl"), "{}");
    await writeFile(join(sessionsDir, "notes.txt"), "not a jsonl");

    const files = await discoverPiFiles(join(tempDir, "agent", "sessions"));
    expect(files).toHaveLength(2);
    expect(files.every((f) => f.endsWith(".jsonl"))).toBe(true);
  });

  it("should return empty array if directory does not exist", async () => {
    const files = await discoverPiFiles(join(tempDir, "nonexistent"));
    expect(files).toEqual([]);
  });
});

describe("discoverWorkbuddyFiles", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-discover-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should find depth-2 session JSONL files under projects/<slug>/", async () => {
    const slugDir = join(tempDir, "projects", "Users-me-WorkBuddy-2026-09-10");
    await mkdir(slugDir, { recursive: true });
    await writeFile(join(slugDir, "session-a.jsonl"), "{}");
    await writeFile(join(slugDir, "session-b.jsonl"), "{}");
    await writeFile(join(slugDir, "session-a.meta.json"), "{}");

    const files = await discoverWorkbuddyFiles(tempDir);
    expect(files).toHaveLength(2);
    expect(files.every((f) => f.endsWith(".jsonl"))).toBe(true);
  });

  it("should exclude subagent transcripts and tool outputs nested deeper", async () => {
    const slugDir = join(tempDir, "projects", "Users-me-WorkBuddy-2026-09-10");
    await mkdir(join(slugDir, "subagents"), { recursive: true });
    await mkdir(join(slugDir, "session-a", "tool-results"), { recursive: true });
    await writeFile(join(slugDir, "session-a.jsonl"), "{}");
    await writeFile(join(slugDir, "subagents", "agent-1.jsonl"), "{}");
    await writeFile(join(slugDir, "session-a", "tool-results", "call-1.txt"), "x");

    const files = await discoverWorkbuddyFiles(tempDir);
    expect(files).toEqual([join(slugDir, "session-a.jsonl")]);
  });

  it("should return empty array if directory does not exist", async () => {
    const files = await discoverWorkbuddyFiles(join(tempDir, "nonexistent"));
    expect(files).toEqual([]);
  });
});
