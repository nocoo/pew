/**
 * CLI-entry regression: syncCommand.run() must forward both zcodeDbPath
 * and openZcodeDb / openZcodeSessionDb to executeSync + executeSessionSync
 * respectively.
 *
 * The previous forwarding test bypassed cli.ts by calling executeSync
 * directly — so a missing "zcodeDbPath: paths.zcodeDbPath, openZcodeDb"
 * pair in cli.ts (the actual P1#1 bug) would not have failed. This test
 * instead mocks executeSync + executeSessionSync at module boundary,
 * drives syncCommand.run(), and asserts the args passed by cli.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock hoisting: define handlers before importing cli.ts.
const executeSyncMock = vi.hoisted(() =>
  vi.fn(async () => ({
    totalDeltas: 0,
    totalRecords: 0,
    sources: {
      claude: 0, codex: 0, gemini: 0, grok: 0, kosmos: 0, opencode: 0,
      openclaw: 0, pi: 0, pmstudio: 0, vscodeCopilot: 0, copilotCli: 0,
      hermes: 0, zcode: 0,
    },
    filesScanned: {
      claude: 0, codex: 0, gemini: 0, grok: 0, kosmos: 0, opencode: 0,
      openclaw: 0, pi: 0, pmstudio: 0, vscodeCopilot: 0, copilotCli: 0,
      hermes: 0, zcode: 0,
    },
    dbsScanned: { opencode: 0, hermes: 0, zcode: 0 },
  })),
);
const executeSessionSyncMock = vi.hoisted(() =>
  vi.fn(async () => ({
    totalSnapshots: 0,
    totalRecords: 0,
    sources: {
      claude: 0, codex: 0, copilotCli: 0, gemini: 0, grok: 0, kosmos: 0,
      opencode: 0, openclaw: 0, pi: 0, pmstudio: 0, zcode: 0,
    },
    filesScanned: {
      claude: 0, codex: 0, copilotCli: 0, gemini: 0, grok: 0, kosmos: 0,
      opencode: 0, openclaw: 0, pi: 0, pmstudio: 0, zcode: 0,
    },
    dbsScanned: { opencode: 0, zcode: 0 },
  })),
);
const uploadTokensMock = vi.hoisted(() =>
  vi.fn(async () => ({ uploaded: 0, batches: 0, records: 0 })),
);
const uploadSessionsMock = vi.hoisted(() =>
  vi.fn(async () => ({ uploaded: 0, batches: 0, records: 0 })),
);
const ensureDeviceIdMock = vi.hoisted(() => vi.fn(async () => "dev-mock"));

vi.mock("../commands/sync.js", () => ({
  executeSync: executeSyncMock,
}));
vi.mock("../commands/session-sync.js", () => ({
  executeSessionSync: executeSessionSyncMock,
}));
vi.mock("../commands/upload.js", () => ({
  executeUpload: uploadTokensMock,
}));
vi.mock("../commands/session-upload.js", () => ({
  executeSessionUpload: uploadSessionsMock,
}));
vi.mock("../config/manager.js", () => ({
  ConfigManager: class {
    async ensureDeviceId() {
      return ensureDeviceIdMock();
    }
    async load() {
      return { apiKey: null };
    }
  },
}));

// Import AFTER mocks are registered so cli.ts sees the mocked modules.
import { syncCommand } from "../cli.js";

beforeEach(() => {
  executeSyncMock.mockClear();
  executeSessionSyncMock.mockClear();
});

describe("syncCommand.run() forwarding", () => {
  it("passes both zcodeDbPath and openZcodeDb into executeSync (regression: manual entry token pipeline)", async () => {
    await syncCommand.run!({ args: { upload: false, dev: false } as never });

    expect(executeSyncMock).toHaveBeenCalledTimes(1);
    const opts = executeSyncMock.mock.calls[0][0] as {
      zcodeDbPath?: string;
      openZcodeDb?: unknown;
    };
    // Regression assertions — must be present, not undefined.
    expect(opts.zcodeDbPath).toBeTypeOf("string");
    expect(opts.zcodeDbPath!.endsWith("/.zcode/cli/db/db.sqlite")).toBe(true);
    // openZcodeDb comes from a dynamic import of zcode-sqlite-db, which
    // succeeds on Bun / Node ≥22.5. In any case cli.ts must PASS the
    // variable (even if undefined) — the field's presence is what
    // prevents the P1#1 excess-property bug from being silently
    // dropped. TypeScript would reject an unknown key, so if this
    // field is truly missing the sync would compile but not forward.
    // We assert the key is in the passed opts object.
    expect(Object.hasOwn(opts, "openZcodeDb")).toBe(true);
  });

  it("passes both zcodeDbPath and openZcodeSessionDb into executeSessionSync (regression: manual entry session pipeline)", async () => {
    await syncCommand.run!({ args: { upload: false, dev: false } as never });

    expect(executeSessionSyncMock).toHaveBeenCalledTimes(1);
    const opts = executeSessionSyncMock.mock.calls[0][0] as {
      zcodeDbPath?: string;
      openZcodeSessionDb?: unknown;
    };
    expect(opts.zcodeDbPath).toBeTypeOf("string");
    expect(opts.zcodeDbPath!.endsWith("/.zcode/cli/db/db.sqlite")).toBe(true);
    expect(Object.hasOwn(opts, "openZcodeSessionDb")).toBe(
      true,
    );
  });
});
