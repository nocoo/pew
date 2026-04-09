import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  executeStatus,
  type StatusResult,
  type SourceDirs,
} from "../commands/status.js";
import { CursorStore } from "../storage/cursor-store.js";
import { LocalQueue } from "../storage/local-queue.js";
import type { QueueRecord } from "@pew/core";

/** Default source dirs matching the paths used in cursor fixtures below */
const defaultDirs: SourceDirs = {
  claudeDir: "/home/.claude",
  codexSessionsDir: "/home/.codex/sessions",
  geminiDir: "/home/.gemini",
  kosmosDataDir: "/home/.config/kosmos-app",
  pmstudioDataDir: "/home/.config/pm-studio-app",
  openCodeMessageDir: "/home/.local/share/opencode/storage/message",
  openclawDir: "/home/.openclaw",
  piSessionsDir: "/home/.pi/agent/sessions",
  vscodeCopilotDirs: ["/home/.config/Code/User"],
  copilotCliLogsDir: "/home/.copilot/logs",
};

describe("executeStatus", () => {
  let tempDir: string;
  let stateDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-status-test-"));
    stateDir = join(tempDir, "state");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should return zero counts when no state exists", async () => {
    const result = await executeStatus({
      stateDir,
      sourceDirs: defaultDirs,
    });
    expect(result.trackedFiles).toBe(0);
    expect(result.lastSync).toBeNull();
    expect(result.pendingRecords).toBe(0);
    expect(result.sources).toEqual({});
    expect(result.notifiers).toEqual({});
  });

  it("should count tracked files from cursor state", async () => {
    const cursorStore = new CursorStore(stateDir);
    await cursorStore.save({
      files: {
        "/home/.claude/projects/a/session.jsonl": {
          type: "byte-offset",
          offset: 100,
          inode: 1,
          size: 100,
          mtimeMs: 1000,
        },
        "/home/.gemini/tmp/proj/chats/session.json": {
          type: "gemini",
          messages: { "msg-1": true },
          inode: 2,
          size: 200,
          mtimeMs: 2000,
        },
      },
      updatedAt: "2026-03-07T10:00:00.000Z",
    });

    const result = await executeStatus({
      stateDir,
      sourceDirs: defaultDirs,
    });
    expect(result.trackedFiles).toBe(2);
    expect(result.lastSync).toBe("2026-03-07T10:00:00.000Z");
  });

  it("should categorize files by source from resolved directories", async () => {
    const cursorStore = new CursorStore(stateDir);
    await cursorStore.save({
      files: {
        "/home/.claude/projects/a/s.jsonl": {
          type: "byte-offset",
          offset: 50,
          inode: 1,
          size: 50,
          mtimeMs: 1000,
        },
        "/home/.claude/projects/b/s.jsonl": {
          type: "byte-offset",
          offset: 60,
          inode: 2,
          size: 60,
          mtimeMs: 1001,
        },
        "/home/.gemini/tmp/proj/chats/s.json": {
          type: "gemini",
          messages: {},
          inode: 3,
          size: 100,
          mtimeMs: 2000,
        },
        "/home/.local/share/opencode/storage/message/ses_001/msg_001.json": {
          type: "opencode",
          tokens: {
            total: 100,
            input: 80,
            output: 20,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          inode: 4,
          size: 300,
          mtimeMs: 3000,
        },
        "/home/.openclaw/agents/a/sessions/s.jsonl": {
          type: "byte-offset",
          offset: 70,
          inode: 5,
          size: 70,
          mtimeMs: 4000,
        },
        "/home/.codex/sessions/2026/03/07/rollout-abc.jsonl": {
          type: "codex",
          offset: 200,
          inode: 6,
          size: 200,
          mtimeMs: 5000,
          lastTotals: null,
          lastModel: null,
        },
        "/home/.config/Code/User/workspaceStorage/ws1/chatSessions/s.jsonl": {
          type: "byte-offset",
          offset: 80,
          inode: 7,
          size: 80,
          mtimeMs: 6000,
        },
        "/home/.copilot/logs/process-999.log": {
          type: "byte-offset",
          offset: 90,
          inode: 8,
          size: 90,
          mtimeMs: 7000,
        },
      },
      updatedAt: "2026-03-07T12:00:00.000Z",
    });

    const result = await executeStatus({
      stateDir,
      sourceDirs: defaultDirs,
    });
    expect(result.trackedFiles).toBe(8);
    expect(result.sources["claude-code"]).toBe(2);
    expect(result.sources["gemini-cli"]).toBe(1);
    expect(result.sources["opencode"]).toBe(1);
    expect(result.sources["openclaw"]).toBe(1);
    expect(result.sources["codex"]).toBe(1);
    expect(result.sources["vscode-copilot"]).toBe(1);
    expect(result.sources["copilot-cli"]).toBe(1);
  });

  it("should classify codex files under custom CODEX_HOME", async () => {
    const customCodexDir = "/opt/ai/codex/sessions";
    const cursorStore = new CursorStore(stateDir);
    await cursorStore.save({
      files: {
        "/opt/ai/codex/sessions/2026/03/07/rollout-xyz.jsonl": {
          type: "codex",
          offset: 300,
          inode: 10,
          size: 300,
          mtimeMs: 6000,
          lastTotals: null,
          lastModel: null,
        },
      },
      updatedAt: "2026-03-08T10:00:00.000Z",
    });

    const result = await executeStatus({
      stateDir,
      sourceDirs: { ...defaultDirs, codexSessionsDir: customCodexDir },
    });
    expect(result.trackedFiles).toBe(1);
    expect(result.sources["codex"]).toBe(1);
    expect(result.sources["unknown"]).toBeUndefined();
  });

  it("should classify copilot-cli files correctly", async () => {
    const cursorStore = new CursorStore(stateDir);
    await cursorStore.save({
      files: {
        "/home/.copilot/logs/process-12345.log": {
          type: "byte-offset",
          offset: 500,
          inode: 20,
          size: 500,
          mtimeMs: 7000,
        },
        "/home/.copilot/logs/process-67890.log": {
          type: "byte-offset",
          offset: 200,
          inode: 21,
          size: 200,
          mtimeMs: 7001,
        },
      },
      updatedAt: "2026-03-09T10:00:00.000Z",
    });

    const result = await executeStatus({
      stateDir,
      sourceDirs: defaultDirs,
    });
    expect(result.trackedFiles).toBe(2);
    expect(result.sources["copilot-cli"]).toBe(2);
    expect(result.sources["unknown"]).toBeUndefined();
  });

  it("should classify vscode-copilot files correctly", async () => {
    const cursorStore = new CursorStore(stateDir);
    await cursorStore.save({
      files: {
        "/home/.config/Code/User/workspaceStorage/abc/chatSessions/s1.jsonl": {
          type: "byte-offset",
          offset: 100,
          inode: 30,
          size: 100,
          mtimeMs: 8000,
        },
      },
      updatedAt: "2026-03-09T11:00:00.000Z",
    });

    const result = await executeStatus({
      stateDir,
      sourceDirs: defaultDirs,
    });
    expect(result.trackedFiles).toBe(1);
    expect(result.sources["vscode-copilot"]).toBe(1);
    expect(result.sources["unknown"]).toBeUndefined();
  });

  it("should count pending records from queue", async () => {
    // First create some state to make the directory exist
    const cursorStore = new CursorStore(stateDir);
    await cursorStore.save({ files: {}, updatedAt: null });

    // Write queue records
    const queue = new LocalQueue(stateDir);
    const record: QueueRecord = {
      source: "claude-code",
      model: "glm-5",
      hour_start: "2026-03-07T10:00:00.000Z",
      input_tokens: 5000,
      cached_input_tokens: 0,
      output_tokens: 800,
      reasoning_output_tokens: 0,
      total_tokens: 5800,
    };
    await queue.append([record]);

    const result = await executeStatus({
      stateDir,
      sourceDirs: defaultDirs,
    });
    expect(result.pendingRecords).toBe(1);
  });

  it("should return zero pending after queue offset advances", async () => {
    const cursorStore = new CursorStore(stateDir);
    await cursorStore.save({ files: {}, updatedAt: null });

    const queue = new LocalQueue(stateDir);
    const record: QueueRecord = {
      source: "claude-code",
      model: "glm-5",
      hour_start: "2026-03-07T10:00:00.000Z",
      input_tokens: 5000,
      cached_input_tokens: 0,
      output_tokens: 800,
      reasoning_output_tokens: 0,
      total_tokens: 5800,
    };
    await queue.append([record]);

    // Advance the offset past all records
    const offset = await queue.loadOffset();
    const { records, newOffset } = await queue.readFromOffset(offset);
    await queue.saveOffset(newOffset);

    const result = await executeStatus({
      stateDir,
      sourceDirs: defaultDirs,
    });
    expect(result.pendingRecords).toBe(0);
  });

  it("should handle missing updatedAt as null lastSync", async () => {
    const cursorStore = new CursorStore(stateDir);
    await cursorStore.save({
      files: {
        "/home/.claude/projects/a/s.jsonl": {
          type: "byte-offset",
          offset: 50,
          inode: 1,
          size: 50,
          mtimeMs: 1000,
        },
      },
      updatedAt: null,
    });

    const result = await executeStatus({
      stateDir,
      sourceDirs: defaultDirs,
    });
    expect(result.trackedFiles).toBe(1);
    expect(result.lastSync).toBeNull();
  });

  it("should include notifier statuses when provided", async () => {
    const result = await executeStatus({
      stateDir,
      sourceDirs: defaultDirs,
      notifierStatuses: {
        "claude-code": "installed",
        codex: "error",
      },
    });

    expect(result.notifiers).toEqual({
      "claude-code": "installed",
      codex: "error",
    });
  });
});
