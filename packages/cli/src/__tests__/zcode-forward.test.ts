/**
 * Regression: manual `pew sync` (CLI entry) and executeSync must forward
 * zcodeDbPath + openZcodeDb; likewise executeSessionSync + openZcodeSessionDb.
 * Doc §二挑战 7.
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { executeSync } from "../commands/sync.js";
import { executeSessionSync } from "../commands/session-sync.js";
import type {
  ZcodeUsageDb,
  ZcodeSessionDb,
  ZcodeUsageRow,
  ZcodeSessionRow,
} from "../parsers/zcode-types.js";

let dataDir: string;
let stateDir: string;
let zcodeDbPath: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "pew-zcode-forward-"));
  stateDir = join(dataDir, ".config", "pew");
  await mkdir(stateDir, { recursive: true });
  const zdir = join(dataDir, ".zcode", "cli", "db");
  await mkdir(zdir, { recursive: true });
  zcodeDbPath = join(zdir, "db.sqlite");
  await writeFile(zcodeDbPath, "placeholder");
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

const ROW: ZcodeUsageRow = {
  id: "u1",
  sessionId: "sess_a",
  turnId: "t_a",
  modelId: "GLM-5.2",
  providerId: "builtin:bigmodel-coding-plan",
  status: "completed",
  startedAt: 1000,
  completedAt: 2000,
  inputTokens: 11933,
  outputTokens: 170,
  reasoningTokens: 0,
  cacheReadInputTokens: 7360,
  cacheCreationInputTokens: 0,
  providerTotalTokens: 12103,
  computedTotalTokens: 12103,
};

const SROW: ZcodeSessionRow = {
  id: "sess_a",
  directory: "/proj/dir",
  title: "hello",
  timeCreated: 1000,
  timeUpdated: 2000,
  taskType: "interactive",
};

function usageOpener(rows: readonly ZcodeUsageRow[]): (p: string) => ZcodeUsageDb {
  return () => ({
    queryUsageRows(watermark, skipIds) {
      const wm = watermark ?? 0;
      const skip = new Set(skipIds);
      return rows.filter((r) => r.completedAt >= wm && !skip.has(r.id));
    },
    close() {},
  });
}

function sessionOpener(
  rows: readonly ZcodeSessionRow[],
): (p: string) => ZcodeSessionDb {
  return () => ({
    querySessions(watermark, skipIds) {
      const wm = watermark ?? 0;
      const skip = new Set(skipIds);
      return rows.filter((r) => r.timeUpdated >= wm && !skip.has(r.id));
    },
    queryMessages: () => ({ user: 1, assistant: 4, total: 5 }),
    queryPrimaryModel: () => "GLM-5.2",
    close() {},
  });
}

describe("executeSync forwards zcode opener → token driver runs", () => {
  it("emits deltas + increments sources.zcode + dbsScanned.zcode when both are provided", async () => {
    const result = await executeSync({
      stateDir,
      deviceId: "dev-1",
      zcodeDbPath,
      openZcodeDb: usageOpener([ROW]),
    });
    expect(result.sources.zcode).toBe(1);
    expect(result.dbsScanned.zcode).toBe(1);
    expect(result.totalDeltas).toBe(1);
  });

  it("skips ZCode when zcodeDbPath is set but opener is missing (regression: manual entry should still not crash)", async () => {
    const result = await executeSync({
      stateDir,
      deviceId: "dev-1",
      zcodeDbPath,
    });
    expect(result.sources.zcode).toBe(0);
    expect(result.dbsScanned.zcode).toBe(0);
  });
});

describe("executeSessionSync forwards zcode session opener → session driver runs", () => {
  it("emits snapshots + increments sources.zcode + dbsScanned.zcode when both are provided", async () => {
    const result = await executeSessionSync({
      stateDir,
      zcodeDbPath,
      openZcodeSessionDb: sessionOpener([SROW]),
    });
    expect(result.sources.zcode).toBe(1);
    expect(result.dbsScanned.zcode).toBe(1);
    expect(result.totalSnapshots).toBe(1);
  });
});
