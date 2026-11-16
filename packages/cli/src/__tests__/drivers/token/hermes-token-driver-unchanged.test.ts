import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHermesSqliteTokenDriver } from "../../../drivers/token/hermes-token-driver.js";
import type { SyncContext } from "../../../drivers/types.js";
import type { ParsedDelta } from "../../../parsers/claude.js";

const { collectHermesUsageEvidence } = vi.hoisted(() => ({
  collectHermesUsageEvidence: vi.fn(),
}));
vi.mock("../../../parsers/hermes-usage-evidence.js", () => ({ collectHermesUsageEvidence }));

const evidence = {
  eventId: "event-1",
  groupId: "group-1",
  callType: "auxiliary" as const,
  origin: "hermes-aux-ledger" as const,
  provider: "provider",
  granularity: "session" as const,
  timePrecision: "session-start" as const,
  intervalStart: null,
  intervalEnd: null,
  callCount: null,
  snapshotSeq: 2,
};

const delta: ParsedDelta = {
  source: "hermes",
  model: "claude-opus-4",
  timestamp: "2026-04-03T10:00:00.000Z",
  tokens: { inputTokens: 10, cachedInputTokens: 5, outputTokens: 3, reasoningOutputTokens: 2 },
  evidence,
};

const previous = {
  source: "hermes" as const,
  model: "claude-opus-4",
  hour_start: "2026-04-03T10:00:00.000Z",
  device_id: "device",
  timestamp: delta.timestamp,
  input_tokens: 10,
  cached_input_tokens: 5,
  output_tokens: 3,
  reasoning_output_tokens: 2,
  total_tokens: 20,
  evidence,
};

describe("Hermes token driver unchanged evidence", () => {
  it("filters an auxiliary evidence delta already persisted unchanged", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "pew-hermes-unchanged-"));
    const dbPath = join(tempDir, "state.db");
    await writeFile(dbPath, "fake");
    collectHermesUsageEvidence.mockReturnValue([delta]);
    try {
      const driver = createHermesSqliteTokenDriver({
        dbPath,
        dbKey: "default",
        openHermesDb: () => ({
          querySessions: () => [],
          queryAuxiliaryUsage: () => [],
          close: () => {},
        }),
      });
      const ctx: SyncContext = {
        evidenceRecords: [previous],
        collectAccounting: true,
        accountingRecords: [{
          event_id: "event-1",
          evidence_snapshot_seq: 2,
          parser_revision: 1,
          basis: {
            input_tokens: 10,
            cached_input_tokens: 5,
            output_tokens: 3,
            reasoning_output_tokens: 2,
            total_tokens: 20,
          },
        } as never],
      };
      const result = await driver.run(undefined, ctx);
      expect(result.deltas).toEqual([]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
