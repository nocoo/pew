import { describe, expect, it, vi } from "vitest";
import type { NotifierOperationResult, Source } from "@pew/core";
import { executeInit } from "../commands/init.js";
import type { NotifierPaths } from "../notifier/paths.js";

function createPaths(): NotifierPaths {
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

describe("executeInit", () => {
  it("writes notify.cjs and installs all drivers", async () => {
    const hooks: NotifierOperationResult[] = [
      {
        source: "claude-code",
        action: "install",
        changed: true,
        detail: "ok",
      },
      {
        source: "codex",
        action: "install",
        changed: true,
        detail: "ok",
      },
    ];

    const result = await executeInit({
      stateDir: "/tmp/pew",
      home: "/tmp",
      pewBin: "/tmp/bin/pew",
      resolveNotifierPathsFn: createPaths,
      writeNotifyHandlerFn: vi.fn(async () => ({
        changed: true,
        path: "/tmp/pew/bin/notify.cjs",
      })),
      installAllFn: vi.fn(async () => hooks),
      mkdirFn: vi.fn(async () => {}),
      ensureSecureDirFn: vi.fn(),
    });

    expect(result.pewBin).toBe("/tmp/bin/pew");
    expect(result.notifyHandler.path).toBe("/tmp/pew/bin/notify.cjs");
    expect(result.hooks).toEqual(hooks);
  });

  it("does not write files during dry-run", async () => {
    const writeNotifyHandlerFn = vi.fn();
    const installAllFn = vi.fn();
    const mkdirFn = vi.fn();

    const result = await executeInit({
      stateDir: "/tmp/pew",
      home: "/tmp",
      dryRun: true,
      pewBin: "/tmp/bin/pew",
      resolveNotifierPathsFn: createPaths,
      writeNotifyHandlerFn,
      installAllFn,
      getAllDriversFn: () => [
        { source: "claude-code", displayName: "Claude Code" },
        { source: "codex", displayName: "Codex" },
      ] as Array<{ source: Source; displayName: string }>,
      mkdirFn,
    });

    expect(mkdirFn).not.toHaveBeenCalled();
    expect(writeNotifyHandlerFn).not.toHaveBeenCalled();
    expect(installAllFn).not.toHaveBeenCalled();
    expect(result.hooks).toHaveLength(2);
    expect(result.hooks.every((hook) => hook.detail === "dry-run")).toBe(true);
  });

  it("filters install to selected sources", async () => {
    const installDriverFn = vi.fn(async (_source: Source) => ({
      source: "codex" as Source,
      action: "install" as const,
      changed: true,
      detail: "ok",
    }));

    const result = await executeInit({
      stateDir: "/tmp/pew",
      home: "/tmp",
      pewBin: "/tmp/bin/pew",
      sources: ["codex"],
      resolveNotifierPathsFn: createPaths,
      writeNotifyHandlerFn: vi.fn(async () => ({
        changed: true,
        path: "/tmp/pew/bin/notify.cjs",
      })),
      installDriverFn,
      mkdirFn: vi.fn(async () => {}),
      ensureSecureDirFn: vi.fn(),
    });

    expect(installDriverFn).toHaveBeenCalledTimes(1);
    expect(installDriverFn).toHaveBeenCalledWith("codex", createPaths(), {
      spawn: undefined,
    });
    expect(result.hooks).toHaveLength(1);
  });

  it("continues filtering installs when one selected source throws", async () => {
    const installDriverFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({
        source: "gemini-cli",
        action: "install",
        changed: true,
        detail: "ok",
      });

    const result = await executeInit({
      stateDir: "/tmp/pew",
      home: "/tmp",
      pewBin: "/tmp/bin/pew",
      sources: ["codex", "gemini-cli"],
      resolveNotifierPathsFn: createPaths,
      writeNotifyHandlerFn: vi.fn(async () => ({
        changed: true,
        path: "/tmp/pew/bin/notify.cjs",
      })),
      installDriverFn,
      mkdirFn: vi.fn(async () => {}),
      ensureSecureDirFn: vi.fn(),
    });

    expect(result.hooks).toHaveLength(2);
    expect(result.hooks[0]?.action).toBe("skip");
    expect(result.hooks[1]?.source).toBe("gemini-cli");
  });

  it("returns skip for an unknown source when using the built-in driver lookup", async () => {
    const result = await executeInit({
      stateDir: "/tmp/pew",
      home: "/tmp",
      pewBin: "/tmp/bin/pew",
      sources: ["unknown-source" as Source],
      resolveNotifierPathsFn: createPaths,
      writeNotifyHandlerFn: vi.fn(async () => ({
        changed: true,
        path: "/tmp/pew/bin/notify.cjs",
      })),
      mkdirFn: vi.fn(async () => {}),
      ensureSecureDirFn: vi.fn(),
    });

    expect(result.hooks).toEqual([
      {
        source: "unknown-source",
        action: "skip",
        changed: false,
        detail: "Unknown source",
      },
    ]);
  });

  it("uses getAllDrivers for dry-run when sources not specified", async () => {
    const getAllDriversFn = vi.fn(() => [
      { source: "claude-code" as Source, displayName: "Claude Code" },
    ]);

    const result = await executeInit({
      stateDir: "/tmp/pew",
      home: "/tmp",
      dryRun: true,
      pewBin: "/tmp/bin/pew",
      resolveNotifierPathsFn: createPaths,
      writeNotifyHandlerFn: vi.fn(),
      getAllDriversFn,
      mkdirFn: vi.fn(),
    });

    expect(getAllDriversFn).toHaveBeenCalled();
    expect(result.hooks).toHaveLength(1);
    expect(result.hooks[0]?.source).toBe("claude-code");
  });

  it("uses provided sources for dry-run when specified", async () => {
    const getAllDriversFn = vi.fn();

    const result = await executeInit({
      stateDir: "/tmp/pew",
      home: "/tmp",
      dryRun: true,
      pewBin: "/tmp/bin/pew",
      sources: ["codex", "gemini-cli"],
      resolveNotifierPathsFn: createPaths,
      writeNotifyHandlerFn: vi.fn(),
      getAllDriversFn,
      mkdirFn: vi.fn(),
    });

    // getAllDriversFn should NOT be called when sources are provided
    expect(getAllDriversFn).not.toHaveBeenCalled();
    expect(result.hooks).toHaveLength(2);
    expect(result.hooks.map((h) => h.source)).toEqual(["codex", "gemini-cli"]);
  });

  it("handles non-Error throws when driver install fails", async () => {
    const installDriverFn = vi.fn().mockRejectedValueOnce("string error");

    const result = await executeInit({
      stateDir: "/tmp/pew",
      home: "/tmp",
      pewBin: "/tmp/bin/pew",
      sources: ["codex"],
      resolveNotifierPathsFn: createPaths,
      writeNotifyHandlerFn: vi.fn(async () => ({
        changed: true,
        path: "/tmp/pew/bin/notify.cjs",
      })),
      installDriverFn,
      mkdirFn: vi.fn(async () => {}),
      ensureSecureDirFn: vi.fn(),
    });

    expect(result.hooks).toHaveLength(1);
    expect(result.hooks[0]?.action).toBe("skip");
    expect(result.hooks[0]?.detail).toBe("string error");
  });
});
