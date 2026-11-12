import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueRecord, Source } from "@pew/core";
import { executeNotify } from "../commands/notify.js";
import { executeReset } from "../commands/reset.js";
import { executeSync } from "../commands/sync.js";
import { LocalQueue } from "../storage/local-queue.js";
import { CursorStore } from "../storage/cursor-store.js";
import { getAllDrivers } from "../notifier/registry.js";
import { SessionQueue } from "../storage/session-queue.js";
import { BaseQueue } from "../storage/base-queue.js";
import { executeSessionUpload } from "../commands/session-upload.js";
import { executeSessionSync } from "../commands/session-sync.js";
import { executeStatus } from "../commands/status.js";
import { SessionCursorStore } from "../storage/session-cursor-store.js";
import { isRetiredCursorPath } from "../utils/retired-sources.js";
import { ConfigManager } from "../config/manager.js";

const retired: Source[] = ["gemini-cli", "kosmos", "omp", "zcode", "pmstudio", "vscode-copilot"];
const row = (source: Source, device_id = "old-device"): QueueRecord => ({ source, device_id, model: "historic-model",
  hour_start: "2026-01-01T00:00:00.000Z", input_tokens: 100, cached_input_tokens: 900,
  output_tokens: 40, reasoning_output_tokens: 60, total_tokens: 1100 });
const key = (r: QueueRecord) => `${r.source}|${r.model}|${r.hour_start}|${r.device_id}`;

describe("retired sources", () => {
  let stateDir: string;
  beforeEach(async () => { stateDir = await mkdtemp(join(tmpdir(), "pew-retired-")); });
  afterEach(async () => { await rm(stateDir, { recursive: true, force: true }); });

  it("does not install retired notifiers", () => {
    expect(getAllDrivers().map((d) => d.source)).not.toEqual(expect.arrayContaining(["gemini-cli"]));
    expect(getAllDrivers().every((d) => !retired.includes(d.source))).toBe(true);
  });

  it("does not treat a similarly named sibling as an active root", () => {
    expect(isRetiredCursorPath("/work/kosmos-app/file.jsonl", [undefined, "/work/kosmos-app2"])).toBe(true);
    expect(isRetiredCursorPath("/work/kosmos-app2/file.jsonl", ["/work/kosmos-app"])).toBe(false);
  });

  it.each(retired)("acknowledges old %s hooks without syncing or creating state", async (source) => {
    const sync = vi.fn();
    const result = await executeNotify({ stateDir, deviceId: "device", source, coordinatedSyncFn: sync });
    expect(result.skippedSync).toBe(true);
    expect(sync).not.toHaveBeenCalled();
  });

  it("retains all retired buckets and pending keys across a full rescan", async () => {
    const queue = new LocalQueue(stateDir);
    const history = retired.map((s) => row(s));
    await queue.overwrite([...history, row("claude-code")]);
    await queue.saveDirtyKeys([key(history[0])]);
    await executeSync({ stateDir, deviceId: "device" });
    expect((await queue.readFromOffset(0)).records).toEqual(history);
    expect(await queue.loadDirtyKeys()).toEqual([key(history[0])]);
  });

  it("retains historical rows on reset and subsequent empty rescan", async () => {
    const queue = new LocalQueue(stateDir);
    const history = retired.map((s) => row(s));
    await queue.overwrite([...history, row("claude-code")]);
    await queue.saveDirtyKeys([key(history[2])]);
    await executeReset({ stateDir });
    expect((await queue.readFromOffset(0)).records).toEqual(history);
    expect(await queue.loadDirtyKeys()).toEqual([key(history[2])]);
    await executeSync({ stateDir, deviceId: "device" });
    expect((await queue.readFromOffset(0)).records).toEqual(history);
    expect(await queue.loadDirtyKeys()).toEqual([key(history[2])]);
  });

  it("discards obsolete default cursors before checking schema replay", async () => {
    await new CursorStore(stateDir).save({ version: 1, updatedAt: null, files: {
      "/home/test/.gemini/tmp/id/chats/session-1.json": { inode: 1, mtimeMs: 0, size: 0, updatedAt: "2026-01-01" } as never,
    }, knownFilePaths: { "/home/test/.gemini/tmp/id/chats/session-1.json": true } });
    const progress = vi.fn();
    await executeSync({ stateDir, deviceId: "device", onProgress: progress });
    expect(progress.mock.calls.some(([e]) => e.message?.includes("one-time full rescan"))).toBe(false);
    expect((await new CursorStore(stateDir).load()).files).toEqual({});
  });

  it.each(["kosmos-app", ".gemini/tmp", ".omp", "Code/User"])("does not replay active Copilot files inside %s", async (directory) => {
    const path = join(stateDir, directory, "copilot.jsonl");
    await mkdir(join(stateDir, directory), { recursive: true });
    await writeFile(path, `${JSON.stringify({ type: "span", startTime: "2026-01-01T00:00:00Z", attributes: {
      "gen_ai.provider.name": "github", "gen_ai.response.model": "synthetic-model",
      "gen_ai.usage.input_tokens": 100, "gen_ai.usage.output_tokens": 10,
    } })}\n`);
    const options = { stateDir, deviceId: "device", copilotCliOtelPaths: [`${join(stateDir, directory)}/`] };
    await executeSync(options);
    const queue = new LocalQueue(stateDir);
    const before = (await queue.readFromOffset(0)).records;
    expect(before[0]?.total_tokens).toBe(110);
    const store = new CursorStore(stateDir);
    const cursors = await store.load();
    cursors.files[join(stateDir, "other-active.jsonl")] = { offset: 0, inode: 1, size: 0, mtimeMs: 0, updatedAt: "2026-01-01" };
    await store.save(cursors);
    await executeSync(options);
    expect((await queue.readFromOffset(0)).records).toEqual(before);
    expect((await store.load()).files[path]).toBeDefined();
    const status = await executeStatus({ stateDir, sourceDirs: { claudeDir: "/absent/claude", codexSessionsDir: "/absent/codex",
      openCodeMessageDir: "/absent/opencode", openclawDir: "/absent/openclaw", piSessionsDir: "/absent/pi",
      copilotCliLogsDir: "/absent/copilot", copilotCliOtelPaths: options.copilotCliOtelPaths, multicaCodexDirs: [], grokHome: "/absent/grok",
      workbuddyDirs: [] } });
    expect(status.sources["copilot-cli"]).toBe(1);
  });

  it("keeps active session cursors inside a retired directory name", async () => {
    const root = join(stateDir, "kosmos-app", "claude");
    const directory = join(root, "projects", "synthetic");
    const path = join(directory, "session.jsonl");
    await mkdir(directory, { recursive: true });
    await writeFile(path, `${JSON.stringify({ type: "user", sessionId: "synthetic", timestamp: "2026-01-01T00:00:00Z",
      message: { role: "user", content: "synthetic" } })}\n`);
    const options = { stateDir, claudeDir: `${root}/` };
    await executeSessionSync(options);
    expect((await executeSessionSync(options)).totalSnapshots).toBe(0);
    expect((await new SessionCursorStore(stateDir).load()).files[path]).toBeDefined();
  });

  it("retains retired sessions and their legacy pending offset across reset", async () => {
    const queue = new SessionQueue(stateDir);
    const records = retired.map((source) => ({ session_key: `${source}:test`, source, kind: "human" as const,
      started_at: "2026-01-01T00:00:00Z", last_message_at: "2026-01-01T00:01:00Z", snapshot_at: "2026-01-01T00:02:00Z",
      duration_seconds: 60, user_messages: 1, assistant_messages: 1, total_messages: 2, project_ref: null, model: null }));
    await queue.overwrite(records);
    const offset = Buffer.byteLength(`${JSON.stringify(records[0])}\n`);
    await queue.saveOffset(offset);
    await executeReset({ stateDir });
    expect((await queue.readFromOffset(0)).records).toEqual(records);
    expect(await queue.loadDirtyKeys()).toBeUndefined();
    expect(await queue.loadOffset()).toBe(offset);
    await new ConfigManager(stateDir).save({ token: "synthetic" });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ ingested: 5 }));
    const options = { stateDir, apiUrl: "https://synthetic.invalid", fetch };
    expect((await executeSessionUpload(options)).success).toBe(true);
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual(records.slice(1));
    await executeReset({ stateDir });
    expect((await executeSessionUpload(options)).uploaded).toBe(0);
    expect(fetch).toHaveBeenCalledOnce();
    const active = { ...records[0], source: "claude-code" as const, session_key: "claude:active" };
    await queue.append(active);
    expect((await executeSessionUpload(options)).uploaded).toBe(1);
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toEqual([active]);
    await executeReset({ stateDir });
    expect((await executeSessionUpload(options)).uploaded).toBe(0);
  });

  it("fails before changing any history when a retained queue or state is invalid", async () => {
    const queue = new LocalQueue(stateDir);
    await queue.overwrite([row("omp")]);
    await writeFile(join(stateDir, "cursors.json"), "{}");
    await writeFile(join(stateDir, "queue.state.json"), "broken");
    await expect(executeReset({ stateDir })).rejects.toThrow("Cannot verify retained queue upload state");
    await expect(executeSync({ stateDir, deviceId: "device" })).rejects.toThrow("Cannot verify retained queue upload state");
    expect((await queue.readFromOffset(0)).records).toEqual([row("omp")]);
    expect(await readFile(join(stateDir, "cursors.json"), "utf8")).toBe("{}");
  });

  it("recomputes the acknowledged session prefix after removing active records", async () => {
    const queue = new SessionQueue(stateDir);
    const session = (source: Source, session_key: string) => ({ source, session_key, kind: "human" as const,
      started_at: "2026-01-01T00:00:00Z", last_message_at: "2026-01-01T00:01:00Z", snapshot_at: "2026-01-01T00:02:00Z",
      duration_seconds: 60, user_messages: 1, assistant_messages: 1, total_messages: 2, project_ref: null, model: null });
    const active = session("claude-code", "active");
    const clean = session("omp", "clean");
    const pending = session("omp", "pending");
    await queue.overwrite([active, clean, pending]);
    await queue.saveOffset(Buffer.byteLength([active, clean].map((r) => `${JSON.stringify(r)}\n`).join("")));
    await executeReset({ stateDir });
    expect((await queue.readFromOffset(0)).records).toEqual([clean, pending]);
    expect((await queue.readFromOffset(await queue.loadOffset())).records).toEqual([pending]);
  });

  it("retains a safe replay offset when saving the rewritten session prefix fails", async () => {
    const queue = new SessionQueue(stateDir);
    const record = { session_key: "omp:synthetic", source: "omp" as const, kind: "human" as const,
      started_at: "2026-01-01T00:00:00Z", last_message_at: "2026-01-01T00:01:00Z", snapshot_at: "2026-01-01T00:02:00Z",
      duration_seconds: 60, user_messages: 1, assistant_messages: 1, total_messages: 2, project_ref: null, model: null };
    await queue.overwrite([record]);
    await queue.saveOffset(Buffer.byteLength(`${JSON.stringify(record)}\n`));
    const original = BaseQueue.prototype.saveState;
    let writes = 0;
    const save = vi.spyOn(BaseQueue.prototype, "saveState").mockImplementation(async function (state) {
      if (++writes === 2) throw new Error("prefix write failed");
      return original.call(this, state);
    });
    try { await expect(executeReset({ stateDir })).rejects.toThrow("prefix write failed"); }
    finally { save.mockRestore(); }
    expect(await queue.loadOffset()).toBe(0);
    expect((await queue.readFromOffset(0)).records).toEqual([record]);
  });

  it("invalidates both cursors before a failed retained-state write and preserves the original queue", async () => {
    const queue = new LocalQueue(stateDir);
    const records = [row("omp"), row("claude-code")];
    await queue.overwrite(records);
    await writeFile(join(stateDir, "cursors.json"), "{}");
    await writeFile(join(stateDir, "session-cursors.json"), "{}");
    const save = vi.spyOn(BaseQueue.prototype, "saveState").mockRejectedValueOnce(new Error("state write failed"));
    try { await expect(executeReset({ stateDir })).rejects.toThrow("state write failed"); }
    finally { save.mockRestore(); }
    await expect(access(join(stateDir, "cursors.json"))).rejects.toThrow();
    await expect(access(join(stateDir, "session-cursors.json"))).rejects.toThrow();
    expect((await queue.readFromOffset(0)).records).toEqual(records);
  });
});
