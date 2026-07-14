/**
 * Regression tests for the review-round-4 findings on doc 45:
 *
 * §8/#1 — Outer uninstall command must NOT delete
 *   codex_notify_original.json unless the Codex driver reports a clean
 *   uninstall (changed:true, no warnings). Cycle-detected, ownership-
 *   conflict, driver throw all keep the backup on disk.
 *
 * §8/#2 — Codex driver must skip + warn on a corrupted backup file
 *   rather than treating parse failure as "no backup" and rewriting
 *   the top-level notify line.
 *
 * §4.1/#3 — chain_reentry and chain_too_long diagnostics must actually
 *   land on disk. The regression was a TDZ ReferenceError inside
 *   writeDiagnostic that got swallowed silently.
 *
 * §4.1/#4 — Windows self-path check must compare case-insensitively so
 *   a case-differing saved-original still trips the self-notify guard.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import vm from "node:vm";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NotifierOperationResult, Source } from "@pew/core";
import { executeUninstall } from "../commands/uninstall.js";
import type { NotifierPaths } from "../notifier/paths.js";
import { buildNotifyHandler } from "../notifier/notify-handler.js";
import { uninstallCodexNotifier } from "../notifier/codex-notifier.js";

// ---------------------------------------------------------------------------
// executeUninstall — driver-outcome-aware backup deletion
// ---------------------------------------------------------------------------

function makePaths(): NotifierPaths {
  return {
    stateDir: "/tmp/pew",
    binDir: "/tmp/pew/bin",
    notifyPath: "/tmp/pew/bin/notify.cjs",
    lockPath: "/tmp/pew/sync.lock",
    signalPath: "/tmp/pew/notify.signal",
    claudeDir: "/tmp/.claude",
    claudeSettingsPath: "/tmp/.claude/settings.json",
    geminiDir: "/tmp/.gemini",
    geminiSettingsPath: "/tmp/.gemini/settings.json",
    opencodeConfigDir: "/tmp/.config/opencode",
    opencodePluginDir: "/tmp/.config/opencode/plugin",
    openclawHome: "/tmp/.openclaw",
    openclawConfigPath: "/tmp/.openclaw/openclaw.json",
    openclawPluginDir: "/tmp/pew/openclaw-plugin",
    codexHome: "/tmp/.codex",
    codexConfigPath: "/tmp/.codex/config.toml",
    codexNotifyOriginalPath: "/tmp/pew/codex_notify_original.json",
  };
}

describe("executeUninstall — Codex backup guarded by driver outcome (doc 45 §8)", () => {
  it("keeps backup when Codex driver reports cycle_detected", async () => {
    const removeCodexBackupFn = vi.fn();
    const codexHook: NotifierOperationResult = {
      source: "codex",
      action: "skip",
      changed: false,
      detail:
        "cycle_detected: codex_notify_original.json refers back to Pew notify.cjs; not restoring",
      warnings: ["Preserved codex_notify_original.json for manual review."],
    };
    const result = await executeUninstall({
      stateDir: "/tmp/pew",
      home: "/tmp",
      resolveNotifierPathsFn: makePaths,
      uninstallAllFn: async () => [codexHook, {
        source: "claude-code",
        action: "uninstall",
        changed: true,
        detail: "ok",
      }],
      removeNotifyHandlerFn: async () => ({
        changed: true,
        path: "/tmp/pew/bin/notify.cjs",
        detail: "removed",
      }),
      removeCodexBackupFn,
    });
    expect(removeCodexBackupFn).not.toHaveBeenCalled();
    expect(result.codexBackup.changed).toBe(false);
    expect(result.codexBackup.detail).toContain("backup preserved");
  });

  it("keeps backup when Codex driver reports ownership_conflict / any warning", async () => {
    const removeCodexBackupFn = vi.fn();
    const codexHook: NotifierOperationResult = {
      source: "codex",
      action: "skip",
      changed: false,
      detail: "ownership_conflict: ...",
      warnings: ["Manual review needed."],
    };
    const result = await executeUninstall({
      stateDir: "/tmp/pew",
      home: "/tmp",
      resolveNotifierPathsFn: makePaths,
      uninstallAllFn: async () => [codexHook],
      getAllDriversFn: () => [
        { source: "codex" as Source, displayName: "Codex" },
      ] as Array<{ source: Source; displayName: string }>,
      removeNotifyHandlerFn: async () => ({
        changed: true,
        path: "/tmp/pew/bin/notify.cjs",
        detail: "removed",
      }),
      removeCodexBackupFn,
    });
    expect(removeCodexBackupFn).not.toHaveBeenCalled();
    expect(result.codexBackup.detail).toContain("backup preserved");
  });

  it("keeps backup when Codex driver threw (outer catch converted to skip+warning)", async () => {
    const removeCodexBackupFn = vi.fn();
    // Selected-only path exercises the try/catch wrapper in executeUninstall.
    const result = await executeUninstall({
      stateDir: "/tmp/pew",
      home: "/tmp",
      sources: ["codex"],
      resolveNotifierPathsFn: makePaths,
      uninstallDriverFn: async () => {
        throw new Error("driver boom");
      },
      removeNotifyHandlerFn: async () => ({
        changed: false,
        path: "/tmp/pew/bin/notify.cjs",
        detail: "shared artifact kept",
      }),
      removeCodexBackupFn,
    });
    expect(removeCodexBackupFn).not.toHaveBeenCalled();
    expect(result.codexBackup.detail).toContain("backup preserved");
  });

  it("removes backup when Codex driver reports clean uninstall with no warnings", async () => {
    const removeCodexBackupFn = vi.fn(async () => ({
      changed: true,
      path: "/tmp/pew/codex_notify_original.json",
      detail: "removed",
    }));
    const result = await executeUninstall({
      stateDir: "/tmp/pew",
      home: "/tmp",
      resolveNotifierPathsFn: makePaths,
      uninstallAllFn: async () => [
        {
          source: "codex",
          action: "uninstall",
          changed: true,
          detail: "Codex notifier restored",
        },
      ],
      removeNotifyHandlerFn: async () => ({
        changed: true,
        path: "/tmp/pew/bin/notify.cjs",
        detail: "removed",
      }),
      removeCodexBackupFn,
    });
    expect(removeCodexBackupFn).toHaveBeenCalledTimes(1);
    expect(result.codexBackup.changed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// codex-notifier uninstall — corrupted backup
// ---------------------------------------------------------------------------

describe("uninstallCodexNotifier — corrupted backup (doc 45 §8)", () => {
  let tempDir: string;
  let configPath: string;
  let backupPath: string;
  const notifyPath = "/tmp/pew/bin/notify.cjs";

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-codex-corrupt-"));
    configPath = join(tempDir, "config.toml");
    backupPath = join(tempDir, "codex_notify_original.json");
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("does not touch config or backup when backup JSON is malformed", async () => {
    await writeFile(
      configPath,
      'notify = ["/usr/local/bin/node", "/tmp/pew/bin/notify.cjs", "--source=codex"]\n',
      "utf8",
    );
    await writeFile(backupPath, "{ this is not valid JSON", "utf8");
    const result = await uninstallCodexNotifier({
      configPath,
      notifyPath,
      originalBackupPath: backupPath,
      runtimePath: "/usr/local/bin/node",
    });
    expect(result.action).toBe("skip");
    expect(result.changed).toBe(false);
    expect(result.detail).toMatch(/unreadable|parse/i);
    // Config must still contain the pew notify line.
    const stillConfig = await readFile(configPath, "utf8");
    expect(stillConfig).toContain("/tmp/pew/bin/notify.cjs");
    // Backup must still exist unchanged.
    const stillBackup = await readFile(backupPath, "utf8");
    expect(stillBackup).toBe("{ this is not valid JSON");
  });

  it("does not touch config or backup when backup lacks a valid `notify` field", async () => {
    await writeFile(
      configPath,
      'notify = ["/usr/local/bin/node", "/tmp/pew/bin/notify.cjs", "--source=codex"]\n',
      "utf8",
    );
    await writeFile(
      backupPath,
      JSON.stringify({ notify: "not-an-array", capturedAt: "..." }),
      "utf8",
    );
    const result = await uninstallCodexNotifier({
      configPath,
      notifyPath,
      originalBackupPath: backupPath,
      runtimePath: "/usr/local/bin/node",
    });
    expect(result.action).toBe("skip");
    expect(result.detail).toMatch(/unreadable|notify/i);
    const stillConfig = await readFile(configPath, "utf8");
    expect(stillConfig).toContain("/tmp/pew/bin/notify.cjs");
  });
});

// ---------------------------------------------------------------------------
// notify-handler chain-guard diagnostic writes (TDZ bug)
// ---------------------------------------------------------------------------

interface DiagnosticSpy {
  writes: Array<{ path: string; data: string }>;
  files: Map<string, string>;
  exitCodes: number[];
}

function makeChainGuardSandbox(chainValue: string): DiagnosticSpy {
  const spy: DiagnosticSpy = { writes: [], files: new Map(), exitCodes: [] };
  const src = buildNotifyHandler({
    stateDir: "/state",
    pewBin: "/bin/pew",
    platform: "linux",
  });
  const script = new vm.Script(src.replace(/^#!.*\n/, ""));
  const sandboxGlobals: Record<string, unknown> = {
    require(mod: string) {
      if (mod === "node:fs") {
        return {
          appendFileSync: () => {},
          readFileSync: () => {
            const e = new Error("ENOENT") as NodeJS.ErrnoException;
            e.code = "ENOENT";
            throw e;
          },
          writeFileSync: (path: string, data: string, opts?: { flag?: string }) => {
            spy.writes.push({ path, data: String(data) });
            if (opts?.flag === "wx" && spy.files.has(path)) {
              const e = new Error("EEXIST") as NodeJS.ErrnoException;
              e.code = "EEXIST";
              throw e;
            }
            spy.files.set(path, String(data));
          },
          mkdirSync: () => {},
          unlinkSync: () => {},
          existsSync: (p: string) => spy.files.has(p),
          readdirSync: () => [],
        };
      }
      if (mod === "node:child_process") return { spawn: () => ({ unref: () => {} }) };
      if (mod === "node:path") return require("node:path");
      if (mod === "node:os") return { homedir: () => "/home/test" };
      if (mod === "node:crypto") return require("node:crypto");
      throw new Error(`unstubbed ${mod}`);
    },
    process: {
      argv: ["node", "notify.cjs", "--source=codex"],
      env: { PEW_NOTIFY_CHAIN: chainValue },
      platform: "linux",
      exit: (code: number) => {
        spy.exitCodes.push(code);
        throw new Error(`__exit_${code}`);
      },
      pid: 111,
    },
    __filename: "/state/bin/notify.cjs",
    __dirname: "/state/bin",
    __pewNow: () => 1_700_000_000_000,
    console: { error: () => {}, log: () => {} },
    Date,
    JSON,
    Math,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Error,
  };
  sandboxGlobals.globalThis = sandboxGlobals;
  const sandbox = vm.createContext(sandboxGlobals);
  try {
    script.runInContext(sandbox);
  } catch (err) {
    if (!(err instanceof Error) || !err.message.startsWith("__exit_")) throw err;
  }
  return spy;
}

describe("notify-handler chain guard — diagnostic reachable (doc 45 §4.1 #3)", () => {
  it("writes last-notify-guard.json when chain contains INSTANCE_ID (chain_reentry)", () => {
    // INSTANCE_ID is a deterministic function of stateDir; compute it here.
    const crypto = require("node:crypto") as typeof import("node:crypto");
    const path = require("node:path") as typeof import("node:path");
    const instanceId = crypto
      .createHash("sha256")
      .update(path.resolve("/state"))
      .digest("hex")
      .slice(0, 16);
    const spy = makeChainGuardSandbox(`foo,${instanceId},bar`);
    const guardWrite = spy.writes.find((w) =>
      w.path.endsWith("last-notify-guard.json"),
    );
    expect(guardWrite).toBeDefined();
    const parsed = JSON.parse(guardWrite!.data);
    expect(parsed.reason).toBe("chain_reentry");
    expect(parsed.instanceId).toBe(instanceId);
  });

  it("writes last-notify-guard.json when chain exceeds 2048 bytes (chain_too_long)", () => {
    const long = "a".repeat(3_000);
    const spy = makeChainGuardSandbox(long);
    const guardWrite = spy.writes.find((w) =>
      w.path.endsWith("last-notify-guard.json"),
    );
    expect(guardWrite).toBeDefined();
    const parsed = JSON.parse(guardWrite!.data);
    expect(parsed.reason).toBe("chain_too_long");
    expect(parsed.chainLen).toBe(3_000);
  });
});

// ---------------------------------------------------------------------------
// notify-handler self-notify — Windows case-insensitive path (doc 45 §4.1 #4)
// ---------------------------------------------------------------------------

describe("notify-handler self-notify — Windows case-insensitive (doc 45 §4.1 #4)", () => {
  it("recognises a lowercase drive-letter self path as self on win32", () => {
    // Compile the handler for a Windows-style state dir. The generated
    // handler bakes IS_WIN via process.platform inside the sandbox; we
    // exercise that branch by launching with platform=win32 and passing
    // a backup command whose notify.cjs path uses a different case.
    const src = buildNotifyHandler({
      stateDir: "C:\\pew\\state",
      pewBin: "C:\\pew\\bin\\pew.cmd",
      platform: "win32",
    });
    const script = new vm.Script(src.replace(/^#!.*\n/, ""));
    const files = new Map<string, string>();
    // Pre-seed the backup with a saved-original that points at the same
    // notify.cjs path but with different case — should be recognised as
    // self and NOT spawned.
    files.set(
      "C:\\pew\\state\\codex_notify_original.json",
      JSON.stringify({
        notify: ["C:\\PEW\\STATE\\bin\\notify.cjs", "--source=codex"],
      }),
    );
    const spawns: Array<{ cmd: string }> = [];
    const sandboxGlobals: Record<string, unknown> = {
      require(mod: string) {
        if (mod === "node:fs") {
          return {
            appendFileSync: () => {},
            readFileSync: (p: string) => {
              const v = files.get(p);
              if (v === undefined) {
                const e = new Error("ENOENT") as NodeJS.ErrnoException;
                e.code = "ENOENT";
                throw e;
              }
              return v;
            },
            writeFileSync: (p: string, d: string, opts?: { flag?: string }) => {
              if (opts?.flag === "wx" && files.has(p)) {
                const e = new Error("EEXIST") as NodeJS.ErrnoException;
                e.code = "EEXIST";
                throw e;
              }
              files.set(p, String(d));
            },
            mkdirSync: () => {},
            unlinkSync: () => {},
            existsSync: (p: string) => files.has(p),
            readdirSync: () => [],
          };
        }
        if (mod === "node:child_process") {
          return {
            spawn: (cmd: string) => {
              spawns.push({ cmd });
              return { unref: () => {} };
            },
          };
        }
        if (mod === "node:path") return require("node:path");
        if (mod === "node:os") return { homedir: () => "C:\\Users\\Test" };
        if (mod === "node:crypto") return require("node:crypto");
        throw new Error(`unstubbed ${mod}`);
      },
      process: {
        argv: ["node", "notify.cjs", "--source=codex"],
        env: {},
        platform: "win32",
        exit: (code: number) => {
          throw new Error(`__exit_${code}`);
        },
        pid: 42,
      },
      __filename: "C:\\pew\\state\\bin\\notify.cjs",
      __dirname: "C:\\pew\\state\\bin",
      __pewNow: () => 1_700_000_000_000,
      console: { error: () => {}, log: () => {} },
      Date,
      JSON,
      Math,
      Object,
      Array,
      String,
      Number,
      Boolean,
      Error,
    };
    sandboxGlobals.globalThis = sandboxGlobals;
    const sandbox = vm.createContext(sandboxGlobals);
    try {
      script.runInContext(sandbox);
    } catch (err) {
      if (!(err instanceof Error) || !err.message.startsWith("__exit_")) throw err;
    }
    // The saved-original points at the same notify.cjs (case-folded on
    // Windows), so no third-party spawn should happen. The Pew worker
    // spawn is a separate branch — filter for the non-self forward.
    const foreign = spawns.filter(
      (s) =>
        !s.cmd.endsWith("pew.cmd") &&
        !s.cmd.endsWith("pew") &&
        s.cmd !== "npx",
    );
    expect(foreign).toHaveLength(0);
  });
});
