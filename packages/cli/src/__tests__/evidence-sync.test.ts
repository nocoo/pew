import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendFile, mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeSync } from "../commands/sync.js";
import { executeReset } from "../commands/reset.js";
import { CursorStore } from "../storage/cursor-store.js";
import { executeUpload } from "../commands/upload.js";
import { ConfigManager } from "../config/manager.js";

const ts = "2026-09-06T16:00:01.000Z";
const header = { type: "session", id: "synthetic", timestamp: ts };
const model = { type: "model_change", modelId: "test-model", timestamp: ts };
const compaction = { type: "compaction", id: "c1", timestamp: ts, usage: { input: 100, output: 20 } };
const assistant = { type: "message", id: "a1", timestamp: ts,
  message: { role: "assistant", model: "test-model", usage: { input: 1000, output: 100 } } };
const jsonl = (rows: unknown[]) => `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`;

describe("supplemental evidence sync", () => {
  let dir: string;
  let source: string;
  let stateDir: string;
  let file: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pew-evidence-sync-"));
    source = join(dir, "sessions");
    stateDir = join(dir, "state");
    await mkdir(source);
    file = join(source, "session.jsonl");
  });
  afterEach(async () => { vi.restoreAllMocks(); await rm(dir, { recursive: true, force: true }); });
  const sync = () => executeSync({ stateDir, deviceId: "test-device", piSessionsDir: source });
  async function evidence() {
    return (await readFile(join(stateDir, "evidence-queue.jsonl"), "utf8")).trim().split("\n").filter(Boolean).map((s) => JSON.parse(s));
  }

  it("keeps compaction out of legacy buckets and retains its exact time and provenance", async () => {
    await writeFile(file, jsonl([header, model, assistant, compaction]));
    await sync();
    const main = JSON.parse((await readFile(join(stateDir, "queue.jsonl"), "utf8")).trim());
    expect(main.total_tokens).toBe(1100);
    expect(await evidence()).toMatchObject([{
      source: "pi", model: "test-model", timestamp: ts,
      hour_start: "2026-09-06T16:00:00.000Z", total_tokens: 120,
      evidence: { callType: "compaction", timePrecision: "exact" },
    }]);
  });

  it("is idempotent across replay, cursor reset, rotation and offline source loss", async () => {
    await writeFile(file, jsonl([header, model, compaction]));
    await sync();
    const original = await evidence();
    await appendFile(file, jsonl([compaction]));
    await sync();
    expect(await evidence()).toEqual(original);
    await rename(file, join(source, "rotated.jsonl"));
    await sync();
    expect(await evidence()).toEqual(original);
    await executeReset({ stateDir });
    await sync();
    expect(await evidence()).toEqual(original);
    await rm(source, { recursive: true });
    await executeReset({ stateDir });
    await sync();
    expect(await evidence()).toEqual(original);
  });

  it("does not add the same evidence again after queue commit but cursor-save failure", async () => {
    await writeFile(file, jsonl([header, model, compaction]));
    const save = vi.spyOn(CursorStore.prototype, "save").mockRejectedValueOnce(new Error("synthetic crash"));
    await expect(sync()).rejects.toThrow("synthetic crash");
    save.mockRestore();
    await sync();
    expect((await evidence()).map((r) => r.total_tokens)).toEqual([120]);
  });

  it("fails closed on a corrupted durable evidence ledger without echoing its content", async () => {
    await mkdir(stateDir);
    await writeFile(join(stateDir, "evidence-queue.jsonl"), "PRIVATE_FIXTURE_BODY{\n");
    await expect(sync()).rejects.toThrow("Invalid usage evidence ledger");
    expect(await readFile(join(stateDir, "evidence-queue.jsonl"), "utf8")).toBe("PRIVATE_FIXTURE_BODY{\n");
  });

  it("uploads evidence through its own endpoint and retains it when an older server rejects the route", async () => {
    await writeFile(file, jsonl([header, model, compaction]));
    await sync();
    await new ConfigManager(stateDir).save({ token: "synthetic-test-key" });
    const fetch = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 404 }))
      .mockResolvedValue(new Response('{"ingested":1}', { status: 200 }));
    const opts = { stateDir, apiUrl: "https://synthetic.invalid", fetch, retryDelayMs: 0 };
    expect((await executeUpload(opts)).success).toBe(false);
    expect(fetch.mock.calls[0][0]).toBe("https://synthetic.invalid/api/ingest/evidence");
    const firstBody = fetch.mock.calls[0][1].body;
    expect((await executeUpload(opts)).uploaded).toBe(1);
    expect(fetch.mock.calls[1][1].body).toBe(firstBody);
    expect((await executeUpload(opts)).uploaded).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects private text hidden in provenance fields of an otherwise valid ledger", async () => {
    await writeFile(file, jsonl([header, model, compaction]));
    await sync();
    const [original] = await evidence();
    for (const field of ["origin", "callType", "granularity", "timePrecision", "intervalStart"]) {
      await writeFile(join(stateDir, "evidence-queue.jsonl"), jsonl([
        { ...original, evidence: { ...original.evidence, [field]: "PRIVATE_FIXTURE_BODY" } },
      ]));
      await expect(sync()).rejects.toThrow("Invalid usage evidence ledger");
    }
  });
});
