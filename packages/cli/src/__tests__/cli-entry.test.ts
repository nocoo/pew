/** Actual CLI entry points forward native database openers and active source paths. */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";

// Mock hoisting: define handlers before importing cli.ts.
const executeSyncMock = vi.hoisted(() =>
  vi.fn(async () => ({
    totalDeltas: 0,
    totalRecords: 0,
    sources: {
      claude: 0, codex: 0, grok: 0, opencode: 0,
      openclaw: 0, pi: 0, copilotCli: 0,
      hermes: 0, antigravity: 0, workbuddy: 0,
    },
    filesScanned: {
      claude: 0, codex: 0, grok: 0, opencode: 0,
      openclaw: 0, pi: 0, copilotCli: 0,
      hermes: 0, antigravity: 0, workbuddy: 0,
    },
    dbsScanned: { opencode: 0, hermes: 0, antigravity: 0 },
  })),
);
const executeSessionSyncMock = vi.hoisted(() =>
  vi.fn(async () => ({
    totalSnapshots: 0,
    totalRecords: 0,
    sources: {
      claude: 0, codex: 0, copilotCli: 0, grok: 0, opencode: 0, openclaw: 0, pi: 0, antigravity: 0, workbuddy: 0,
    },
    filesScanned: {
      claude: 0, codex: 0, copilotCli: 0, grok: 0, opencode: 0, openclaw: 0, pi: 0, antigravity: 0, workbuddy: 0,
    },
    dbsScanned: { opencode: 0, antigravity: 0 },
  })),
);
const uploadTokensMock = vi.hoisted(() =>
  vi.fn(async () => ({ uploaded: 0, batches: 0, records: 0 })),
);
const uploadSessionsMock = vi.hoisted(() =>
  vi.fn(async () => ({ uploaded: 0, batches: 0, records: 0 })),
);
const ensureDeviceIdMock = vi.hoisted(() => vi.fn(async () => "dev-mock"));
const executeEnrichMock = vi.hoisted(() => vi.fn(async () => ({ source: "antigravity" })));

vi.mock("../commands/sync.js", () => ({
  executeSync: executeSyncMock,
}));
vi.mock("../commands/session-sync.js", () => ({
  executeSessionSync: executeSessionSyncMock,
}));
vi.mock("../commands/enrich.js", () => ({ executeEnrich: executeEnrichMock }));
vi.mock("../commands/upload.js", () => ({
  executeUpload: uploadTokensMock,
}));
vi.mock("../commands/session-upload.js", () => ({
  executeSessionUpload: uploadSessionsMock,
}));
vi.mock("../config/manager.js", () => ({
  ConfigManager: class {
    getDeviceId() {
      return "dev-mock";
    }
    async ensureDeviceId() {
      return ensureDeviceIdMock();
    }
    async load() {
      return { apiKey: null };
    }
  },
}));

// Import AFTER mocks are registered so cli.ts sees the mocked modules.
import { enrichCommand, syncCommand } from "../cli.js";
import { log } from "../log.js";

beforeEach(() => {
  executeSyncMock.mockClear();
  executeSessionSyncMock.mockClear();
  executeEnrichMock.mockClear();
});

describe("syncCommand.run() forwarding", () => {
  it("passes the Antigravity CLI conversations root into both sync pipelines", async () => {
    await syncCommand.run!({ args: { upload: false, dev: false } as never });
    const root = join(homedir(), ".gemini", "antigravity-cli", "conversations");
    expect(executeSyncMock).toHaveBeenCalledWith(expect.objectContaining({ antigravityDir: root }));
    expect(executeSessionSyncMock).toHaveBeenCalledWith(expect.objectContaining({ antigravityDir: root }));
  });

  it("labels Antigravity token, session and database summaries", async () => {
    const tokenResult = await executeSyncMock();
    const sessionResult = await executeSessionSyncMock();
    executeSyncMock.mockResolvedValueOnce({ ...tokenResult, totalDeltas: 1, totalRecords: 1,
      sources: { ...tokenResult.sources, antigravity: 1 }, dbsScanned: { ...tokenResult.dbsScanned, antigravity: 2 } });
    executeSessionSyncMock.mockResolvedValueOnce({ ...sessionResult, totalSnapshots: 1, totalRecords: 1,
      sources: { ...sessionResult.sources, antigravity: 1 }, dbsScanned: { ...sessionResult.dbsScanned, antigravity: 2 } });
    const text = vi.spyOn(log, "text").mockImplementation(() => {});
    try {
      await syncCommand.run!({ args: { upload: false, dev: false } as never });
      expect(text.mock.calls.filter(([line]) => line.includes("Antigravity CLI: 1"))).toHaveLength(2);
      expect(text.mock.calls.filter(([line]) => line.includes("Antigravity CLI: 2 dbs"))).toHaveLength(2);
    } finally { text.mockRestore(); }
  });

  it("accepts Antigravity for accounting details and forwards the conversations root", async () => {
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await enrichCommand.run!({ args: { source: "antigravity", from: "2026-09-01", to: "2026-09-02", apply: false } as never });
      expect(executeEnrichMock).toHaveBeenCalledWith(expect.objectContaining({ source: "antigravity",
        antigravityDir: join(homedir(), ".gemini", "antigravity-cli", "conversations") }));
    } finally { output.mockRestore(); }
  });

});
