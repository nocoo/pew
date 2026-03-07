import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  discoverClaudeFiles,
  discoverGeminiFiles,
  discoverOpenCodeFiles,
  discoverOpenClawFiles,
} from "../discovery/sources.js";

describe("discoverClaudeFiles", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "zebra-discover-"));
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
    tempDir = await mkdtemp(join(tmpdir(), "zebra-discover-"));
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
    tempDir = await mkdtemp(join(tmpdir(), "zebra-discover-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should find message JSON files in session directories", async () => {
    const sesDir = join(tempDir, "storage", "message", "ses_001");
    await mkdir(sesDir, { recursive: true });
    await writeFile(join(sesDir, "msg_001.json"), "{}");
    await writeFile(join(sesDir, "msg_002.json"), "{}");

    const files = await discoverOpenCodeFiles(
      join(tempDir, "storage", "message"),
    );
    expect(files).toHaveLength(2);
    expect(files.every((f) => f.endsWith(".json"))).toBe(true);
  });

  it("should return empty array if directory does not exist", async () => {
    const files = await discoverOpenCodeFiles(join(tempDir, "nonexistent"));
    expect(files).toEqual([]);
  });
});

describe("discoverOpenClawFiles", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "zebra-discover-"));
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
