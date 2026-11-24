import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AntigravityDbCache } from "@pew/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedDelta } from "../parsers/claude.js";
import { executeSync } from "../commands/sync.js";
import { executeSessionSync } from "../commands/session-sync.js";
import { executeReset } from "../commands/reset.js";
import { executeUpload } from "../commands/upload.js";
import { ConfigManager } from "../config/manager.js";
import { ANTIGRAVITY_CACHE_VERSION, readAntigravitySource } from "../parsers/antigravity.js";
import { AccountingQueue } from "../storage/accounting-queue.js";
import { CursorStore } from "../storage/cursor-store.js";
import { LocalQueue } from "../storage/local-queue.js";
import { inclusiveAccounting } from "../utils/accounting.js";

vi.mock("../parsers/antigravity.js", () => ({
  ANTIGRAVITY_CACHE_VERSION: 1,
  readAntigravitySource: vi.fn(),
}));
const reader = vi.mocked(readAntigravitySource);
const time = "2026-10-01T12:01:00.000Z";
function delta(input = 100, read = 900, model = "test-model", timestamp = time): ParsedDelta {
  const tokens = {
    inputTokens: input,
    cachedInputTokens: read,
    outputTokens: 40,
    reasoningOutputTokens: 60,
  };
  return {
    source: "antigravity",
    model,
    timestamp,
    tokens,
    accounting: inclusiveAccounting(
      tokens,
      { input: input + read, read, write: 0, output: 100, reasoning: 60 },
      { origin: "antigravity:step", model },
    ),
  };
}

function sourceSnapshot(
  overrides: Partial<Awaited<ReturnType<typeof readAntigravitySource>>> = {},
) {
  const deltas = overrides.deltas ?? [delta()];
  return {
    deltas,
    snapshots: overrides.snapshots ?? [],
    dbCount: overrides.dbCount ?? 1,
    stepCount: overrides.stepCount ?? deltas.length,
    dbs: overrides.dbs ?? {},
    warnings: overrides.warnings ?? [],
  };
}

describe("Antigravity source-isolated sync", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pew-agy-sync-"));
    reader.mockReset();
    reader.mockResolvedValue(sourceSnapshot());
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });
  const sync = (deviceId = "device") =>
    executeSync({ stateDir: dir, deviceId, antigravityDirs: ["/synthetic"] });
  const records = async () => (await new LocalQueue(dir).readFromOffset(0)).records;
  const accounting = async () => (await new AccountingQueue(dir).readFromOffset(0)).records;

  it("does not warn about an uninstalled optional source on the first sync", async () => {
    reader.mockRejectedValue(Object.assign(new Error("not installed"), { code: "ENOENT" }));
    const progress = vi.fn();
    await executeSync({
      stateDir: dir,
      deviceId: "device",
      antigravityDirs: ["/synthetic"],
      onProgress: progress,
    });
    expect(
      progress.mock.calls.some(
        ([event]) => event.source === "antigravity" && event.phase === "warn",
      ),
    ).toBe(false);
    await executeSessionSync({
      stateDir: dir,
      antigravityDirs: ["/synthetic"],
      onProgress: progress,
    });
    expect(
      progress.mock.calls.some(
        ([event]) => event.source === "antigravity" && event.phase === "warn",
      ),
    ).toBe(false);
  });

  it("keeps counters and complete known-zero cache details idempotent without file cursors", async () => {
    const first = await sync();
    expect(first.sources.antigravity).toBe(1);
    expect(first.dbsScanned.antigravity).toBe(1);
    expect(first.accountingKeys).toHaveLength(1);
    expect((await records())[0]).toMatchObject({
      input_tokens: 100,
      cached_input_tokens: 900,
      output_tokens: 40,
      reasoning_output_tokens: 60,
      total_tokens: 1100,
    });
    const details = await accounting();
    expect(details[0].groups[0].counts).toMatchObject({
      input_total_tokens: 1000,
      cache_read_input_tokens: 900,
      cache_write_input_tokens: 0,
      output_total_tokens: 100,
      reasoning_output_tokens: 60,
    });
    await new LocalQueue(dir).saveDirtyKeys([]);
    await new AccountingQueue(dir).saveDirtyKeys([]);
    await sync();
    expect(await accounting()).toEqual(details);
    expect(await new LocalQueue(dir).loadDirtyKeys()).toEqual([]);
    expect(await new AccountingQueue(dir).loadDirtyKeys()).toEqual([]);
    reader.mockResolvedValue(sourceSnapshot({ deltas: [delta(9000, 0)] }));
    await sync();
    expect((await accounting())[0].groups[0].counts?.cache_read_input_tokens).toBe(0);
    expect((await records())[0].input_tokens).toBe(9000);
    expect((await new CursorStore(dir).load()).antigravity?.dbCount).toBe(1);
  });

  it("persists per-DB cache state and forwards cache/skip flags and warnings across sync phases", async () => {
    const d = delta();
    const cachedDb: AntigravityDbCache = {
      dbStat: "1:2:3:4:5",
      walStat: null,
      stepCount: 7,
      deltas: [
        {
          model: d.model,
          hourStart: "2026-10-01T12:00:00.000Z",
          tokens: d.tokens,
          accounting: d.accounting!,
        },
      ],
      snapshot: null,
    };
    const dbs = { "/synthetic/conv.db": cachedDb };
    reader.mockResolvedValueOnce(
      sourceSnapshot({
        deltas: [d],
        stepCount: 7,
        dbs,
        warnings: ["Skipped 1 busy Antigravity database(s); will retry next sync"],
      }),
    );

    const syncWarnings: string[] = [];
    const first = await executeSync({
      stateDir: dir,
      deviceId: "device",
      antigravityDirs: ["/synthetic"],
      onProgress: (event) => {
        if (event.source === "antigravity" && event.phase === "warn")
          syncWarnings.push(event.message ?? "");
      },
    });
    // First sync with no prior baseline allows skipping an uncached busy DB
    expect(reader).toHaveBeenNthCalledWith(1, ["/synthetic"], {
      cache: undefined,
      allowSkipUncachedUnstable: true,
    });
    expect(first.sources.antigravity).toBe(7);
    expect(first.totalDeltas).toBe(7);
    expect(syncWarnings).toEqual(["Skipped 1 busy Antigravity database(s); will retry next sync"]);

    const savedCursor = (await new CursorStore(dir).load()).antigravity;
    expect(savedCursor).toMatchObject({
      dbCount: 1,
      cacheVersion: ANTIGRAVITY_CACHE_VERSION,
      dbs,
    });

    // Steady-state sync passes saved cache and allowSkipUncachedUnstable: true
    reader.mockResolvedValueOnce(sourceSnapshot({ deltas: [d], stepCount: 7, dbs }));
    await sync();
    expect(reader).toHaveBeenNthCalledWith(2, ["/synthetic"], {
      cache: dbs,
      allowSkipUncachedUnstable: true,
    });

    // Session sync loads token cache read-only and forwards warnings
    reader.mockResolvedValueOnce(
      sourceSnapshot({
        deltas: [],
        snapshots: [],
        dbCount: 1,
        dbs,
        warnings: ["Retained cached snapshot for 1 busy Antigravity database(s)"],
      }),
    );
    const sessionWarnings: string[] = [];
    await executeSessionSync({
      stateDir: dir,
      antigravityDirs: ["/synthetic"],
      onProgress: (event) => {
        if (event.source === "antigravity" && event.phase === "warn")
          sessionWarnings.push(event.message ?? "");
      },
    });
    expect(reader).toHaveBeenNthCalledWith(3, ["/synthetic"], {
      cache: dbs,
      allowSkipUncachedUnstable: true,
    });
    expect(sessionWarnings).toEqual([
      "Retained cached snapshot for 1 busy Antigravity database(s)",
    ]);

    // Post-reset sync has prior records but no cursor -> cache: undefined & allowSkipUncachedUnstable: false
    await executeReset({ stateDir: dir });
    reader.mockResolvedValueOnce(sourceSnapshot({ deltas: [d], stepCount: 7, dbs }));
    await sync();
    expect(reader).toHaveBeenNthCalledWith(4, ["/synthetic"], {
      cache: undefined,
      allowSkipUncachedUnstable: false,
    });
  });

  it("survives cursor deletion and preserves other sources and other devices", async () => {
    await sync();
    await sync("other");
    const before = await records();
    const pi = { ...before[0], source: "pi" as const, total_tokens: 1100 };
    await new LocalQueue(dir).overwrite([...before, pi]);
    await rm(join(dir, "cursors.json"));
    await sync();
    expect((await records()).filter((r) => r.source === "antigravity")).toEqual(
      expect.arrayContaining(before),
    );
    // Generic reset semantics for unrelated sources remain unchanged.
    expect((await records()).find((r) => r.device_id === "other")).toEqual(
      before.find((r) => r.device_id === "other"),
    );
  });

  it("corrects model/time moves and step deletions with usage and detail tombstones", async () => {
    await sync();
    reader.mockResolvedValue(
      sourceSnapshot({ deltas: [delta(50, 900, "corrected-model", "2026-10-01T12:31:00.000Z")] }),
    );
    await sync();
    expect((await records()).map((r) => [r.model, r.total_tokens])).toEqual([
      ["corrected-model", 1050],
      ["test-model", 0],
    ]);
    expect((await accounting()).find((r) => r.model === "test-model")?.basis.total_tokens).toBe(0);
    reader.mockResolvedValue(sourceSnapshot({ deltas: [] }));
    await sync();
    expect((await records()).every((r) => r.total_tokens === 0)).toBe(true);
    expect((await accounting()).every((r) => r.basis.total_tokens === 0)).toBe(true);
  });

  it("preserves reset baselines and uploads corrections and deletions as tombstones", async () => {
    await new ConfigManager(dir).save({ token: "synthetic" });
    const remote = new Map<string, number>();
    const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
      const batch = JSON.parse(String(init?.body));
      if (String(url).endsWith("/details"))
        return Response.json({
          details_version: 1,
          acknowledgments: batch.map(
            (r: {
              device_id: string;
              source: string;
              model: string;
              hour_start: string;
              event_id: string | null;
              source_revision: number;
              parser_revision: number;
              detail_revision: number;
            }) => ({
              key: JSON.stringify([r.device_id, r.source, r.model, r.hour_start, r.event_id]),
              source_revision: r.source_revision,
              parser_revision: r.parser_revision,
              detail_revision: r.detail_revision,
              status: "applied",
            }),
          ),
        });
      for (const r of batch) remote.set(`${r.model}|${r.hour_start}`, r.total_tokens);
      return Response.json({ ingested: batch.length });
    });
    const upload = () =>
      executeUpload({ stateDir: dir, apiUrl: "https://synthetic.invalid", fetch });
    await sync();
    expect((await upload()).success).toBe(true);
    reader.mockResolvedValue(
      sourceSnapshot({ deltas: [delta(50, 900, "corrected-model", "2026-10-01T12:31:00.000Z")] }),
    );
    await executeReset({ stateDir: dir });
    await sync();
    expect((await upload()).success).toBe(true);
    expect(remote.get("test-model|2026-10-01T12:00:00.000Z")).toBe(0);
    expect(remote.get("corrected-model|2026-10-01T12:30:00.000Z")).toBe(1050);
    expect((await accounting()).find((r) => r.model === "test-model")?.basis.total_tokens).toBe(0);
    reader.mockResolvedValue(sourceSnapshot({ deltas: [] }));
    await executeReset({ stateDir: dir });
    await sync();
    expect((await upload()).success).toBe(true);
    expect([...remote.values()]).toEqual([0, 0]);
  });

  it("preserves Antigravity usage and pending intent when reset is followed by source failure", async () => {
    await sync();
    const before = await records();
    const queue = new LocalQueue(dir);
    const pending = await queue.loadDirtyKeys();
    const details = await accounting();
    await executeReset({ stateDir: dir });
    reader.mockRejectedValue(new Error("unstable WAL"));
    await sync();
    expect(await records()).toEqual(before);
    expect(await queue.loadDirtyKeys()).toEqual(pending);
    expect(await accounting()).toEqual(details);
  });

  it.each(["root missing", "corrupt wire", "unstable WAL", "schema unavailable"])(
    "preserves old values and pending state on %s, even after cursor reset",
    async (reason) => {
      await sync();
      const before = await records();
      const details = await accounting();
      const queue = new LocalQueue(dir);
      await queue.saveDirtyKeys([]);
      await queue.saveOffset(73);
      await new AccountingQueue(dir).saveDirtyKeys([]);
      await rm(join(dir, "cursors.json"));
      reader.mockRejectedValue(new Error(reason));
      const warnings: string[] = [];
      await executeSync({
        stateDir: dir,
        deviceId: "device",
        antigravityDirs: ["/synthetic"],
        onProgress: (event) => {
          if (event.phase === "warn") warnings.push(event.message ?? "");
        },
      });
      expect(await records()).toEqual(before);
      expect(await accounting()).toEqual(details);
      expect(await queue.loadDirtyKeys()).toEqual([]);
      expect(await queue.loadOffset()).toBe(73);
      expect(await new AccountingQueue(dir).loadDirtyKeys()).toEqual([]);
      expect(warnings).toContain(
        "Antigravity source unavailable or invalid; previous usage is preserved",
      );
    },
  );

  it("rejects aggregate overflow and invalid accounting before changing a previous snapshot", async () => {
    await sync();
    const before = await records();
    for (const deltas of [
      [delta(600_000_000), delta(600_000_000)],
      [
        {
          ...delta(),
          accounting: {
            ...delta().accounting!,
            basis: { ...delta().accounting!.basis, total_tokens: 1 },
          },
        },
      ],
    ]) {
      reader.mockResolvedValue(sourceSnapshot({ deltas }));
      await sync();
      expect(await records()).toEqual(before);
    }
  });

  it("retains the Antigravity marker if an unrelated replay fails after resetting cursors", async () => {
    await sync();
    const before = await records();
    const store = new CursorStore(dir);
    const prior = await store.load();
    await store.save({
      ...prior,
      accountingSchemaVersion: 0,
      files: {
        "/synthetic/other.jsonl": { inode: 1, mtimeMs: 1, size: 1, updatedAt: time, offset: 1 },
      },
    });
    reader.mockRejectedValue(new Error("source unavailable"));
    const originalSave = CursorStore.prototype.save;
    vi.spyOn(CursorStore.prototype, "save").mockImplementationOnce(async function (state) {
      await originalSave.call(this, state);
      throw new Error("synthetic interruption after reset");
    });
    await expect(sync()).rejects.toThrow("synthetic interruption");
    expect((await store.load()).antigravity).toEqual(prior.antigravity);
    expect(await records()).toEqual(before);
  });

  it("converts legacy offset pending source/device records into dirty keys during sibling rewrites", async () => {
    await sync();
    await sync("other");
    const before = await records();
    const pi = { ...before[0], source: "pi" as const };
    await new LocalQueue(dir).overwrite([...before, pi]);
    const oldCursor = await new CursorStore(dir).load();
    await new CursorStore(dir).save({
      ...oldCursor,
      files: {
        "/synthetic/missing.jsonl": { inode: 1, size: 1, mtimeMs: 1, updatedAt: time, offset: 1 },
      },
    });
    await writeFile(join(dir, "queue.state.json"), JSON.stringify({ offset: 0 }));
    reader.mockRejectedValue(new Error("failed"));
    const claudeDir = join(dir, "claude");
    await mkdir(join(claudeDir, "projects", "synthetic"), { recursive: true });
    await writeFile(
      join(claudeDir, "projects", "synthetic", "conversation.jsonl"),
      `${JSON.stringify({
        type: "assistant",
        timestamp: time,
        message: { model: "test-model", usage: { input_tokens: 10, output_tokens: 2 } },
      })}\n`,
    );
    await executeSync({
      stateDir: dir,
      deviceId: "device",
      antigravityDirs: ["/synthetic"],
      claudeDir,
    });
    expect(await new LocalQueue(dir).loadDirtyKeys()).toEqual(
      expect.arrayContaining(
        [...before, pi].map((r) => `${r.source}|${r.model}|${r.hour_start}|${r.device_id}`),
      ),
    );
    expect((await records()).filter((r) => r.source === "antigravity")).toEqual(
      expect.arrayContaining(before),
    );
  });

  it("full-scans sessions and never stamps a failed source read", async () => {
    const snapshot = {
      sessionKey: "antigravity:synthetic",
      source: "antigravity" as const,
      kind: "human" as const,
      startedAt: time,
      lastMessageAt: time,
      durationSeconds: 0,
      userMessages: 1,
      assistantMessages: 1,
      totalMessages: 2,
      projectRef: null,
      model: "test-model",
      snapshotAt: time,
    };
    reader.mockResolvedValue(sourceSnapshot({ deltas: [], snapshots: [snapshot] }));
    const opts = { stateDir: dir, antigravityDirs: ["/synthetic"] };
    expect((await executeSessionSync(opts)).sources.antigravity).toBe(1);
    const content = await readFile(join(dir, "session-queue.jsonl"), "utf8");
    reader.mockRejectedValue(new Error("failed"));
    expect((await executeSessionSync(opts)).sources.antigravity).toBe(0);
    expect(await readFile(join(dir, "session-queue.jsonl"), "utf8")).toBe(content);
  });
});
