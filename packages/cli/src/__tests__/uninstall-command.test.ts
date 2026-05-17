import { describe, expect, it, vi } from "vitest";
import type { NotifierOperationResult, Source } from "@pew/core";
import { executeUninstall } from "../commands/uninstall.js";
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

describe("executeUninstall", () => {
  it("uninstalls all drivers and removes shared notifier artifacts", async () => {
    const hooks: NotifierOperationResult[] = [
      {
        source: "claude-code",
        action: "uninstall",
        changed: true,
        detail: "ok",
      },
      {
        source: "codex",
        action: "uninstall",
        changed: true,
        detail: "ok",
      },
    ];
    const removeNotifyHandlerFn = vi.fn(async () => ({
      changed: true,
      path: "/tmp/pew/bin/notify.cjs",
      detail: "notify.cjs removed",
    }));
    const removeCodexBackupFn = vi.fn(async () => ({
      changed: true,
      path: "/tmp/pew/codex_notify_original.json",
      detail: "Codex backup removed",
    }));

    const result = await executeUninstall({
      stateDir: "/tmp/pew",
      home: "/tmp",
      resolveNotifierPathsFn: createPaths,
      uninstallAllFn: vi.fn(async () => hooks),
      removeNotifyHandlerFn,
      removeCodexBackupFn,
    });

    expect(result.hooks).toEqual(hooks);
    expect(removeNotifyHandlerFn).toHaveBeenCalled();
    expect(removeCodexBackupFn).toHaveBeenCalled();
    expect(result.notifyHandler.changed).toBe(true);
    expect(result.codexBackup.changed).toBe(true);
  });

  it("dry-run with partial sources preserves shared notify handler + codex backup", async () => {
    const result = await executeUninstall({
      stateDir: "/tmp/pew",
      home: "/tmp",
      dryRun: true,
      sources: ["claude-code" as Source], // partial — not all sources
      resolveNotifierPathsFn: createPaths,
      getAllDriversFn: () => [
        { source: "claude-code", displayName: "Claude Code" },
        { source: "codex", displayName: "Codex" },
      ] as Array<{ source: Source; displayName: string }>,
    });
    // Partial dry-run → "shared artifact kept" / "not selected" detail strings.
    expect(result.notifyHandler.detail).toBe("shared artifact kept");
    expect(result.codexBackup.detail).toBe("not selected");
    expect(result.notifyHandler.changed).toBe(false);
    expect(result.codexBackup.changed).toBe(false);
  });

  it("dry-run with only codex selected marks codex backup as dry-run", async () => {
    const result = await executeUninstall({
      stateDir: "/tmp/pew",
      home: "/tmp",
      dryRun: true,
      sources: ["codex" as Source],
      resolveNotifierPathsFn: createPaths,
      getAllDriversFn: () => [
        { source: "claude-code", displayName: "Claude Code" },
        { source: "codex", displayName: "Codex" },
      ] as Array<{ source: Source; displayName: string }>,
    });
    // shouldRemoveCodexBackup is true → dry-run; not fullUninstall → shared kept.
    expect(result.codexBackup.detail).toBe("dry-run");
    expect(result.notifyHandler.detail).toBe("shared artifact kept");
  });

  it("does not write files during dry-run", async () => {
    const uninstallAllFn = vi.fn();
    const uninstallDriverFn = vi.fn();
    const removeNotifyHandlerFn = vi.fn();
    const removeCodexBackupFn = vi.fn();

    const result = await executeUninstall({
      stateDir: "/tmp/pew",
      home: "/tmp",
      dryRun: true,
      resolveNotifierPathsFn: createPaths,
      getAllDriversFn: () => [
        { source: "claude-code", displayName: "Claude Code" },
        { source: "codex", displayName: "Codex" },
      ] as Array<{ source: Source; displayName: string }>,
      uninstallAllFn,
      uninstallDriverFn,
      removeNotifyHandlerFn,
      removeCodexBackupFn,
    });

    expect(uninstallAllFn).not.toHaveBeenCalled();
    expect(uninstallDriverFn).not.toHaveBeenCalled();
    expect(removeNotifyHandlerFn).not.toHaveBeenCalled();
    expect(removeCodexBackupFn).not.toHaveBeenCalled();
    expect(result.hooks).toHaveLength(2);
    expect(result.hooks.every((hook) => hook.detail === "dry-run")).toBe(true);
  });

  it("filters uninstall to selected sources and keeps shared notify.cjs", async () => {
    const uninstallDriverFn = vi.fn(async (_source: Source) => ({
      source: "codex" as Source,
      action: "uninstall" as const,
      changed: true,
      detail: "ok",
    }));
    const removeNotifyHandlerFn = vi.fn();
    const removeCodexBackupFn = vi.fn(async () => ({
      changed: true,
      path: "/tmp/pew/codex_notify_original.json",
      detail: "Codex backup removed",
    }));

    const result = await executeUninstall({
      stateDir: "/tmp/pew",
      home: "/tmp",
      sources: ["codex"],
      resolveNotifierPathsFn: createPaths,
      uninstallDriverFn,
      removeNotifyHandlerFn,
      removeCodexBackupFn,
    });

    expect(uninstallDriverFn).toHaveBeenCalledTimes(1);
    expect(removeNotifyHandlerFn).not.toHaveBeenCalled();
    expect(removeCodexBackupFn).toHaveBeenCalledTimes(1);
    expect(result.hooks).toHaveLength(1);
  });

  it("continues filtering uninstalls when one selected source throws", async () => {
    const uninstallDriverFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({
        source: "gemini-cli",
        action: "uninstall",
        changed: true,
        detail: "ok",
      });

    const result = await executeUninstall({
      stateDir: "/tmp/pew",
      home: "/tmp",
      sources: ["codex", "gemini-cli"],
      resolveNotifierPathsFn: createPaths,
      uninstallDriverFn,
      removeNotifyHandlerFn: vi.fn(),
      removeCodexBackupFn: vi.fn(async () => ({
        changed: true,
        path: "/tmp/pew/codex_notify_original.json",
        detail: "Codex backup removed",
      })),
    });

    expect(result.hooks).toHaveLength(2);
    expect(result.hooks[0]?.action).toBe("skip");
    expect(result.hooks[1]?.source).toBe("gemini-cli");
  });

  it("invokes real driver lookup for a known source when uninstallDriverFn is not provided", async () => {
    // Pi driver is the simplest built-in driver; it succeeds without filesystem side effects
    // when run against a non-existent stateDir (returns skip-with-detail rather than throwing).
    const result = await executeUninstall({
      stateDir: "/tmp/pew",
      home: "/tmp",
      sources: ["pi" as Source],
      resolveNotifierPathsFn: createPaths,
      removeNotifyHandlerFn: vi.fn().mockResolvedValue({
        changed: false,
        path: "/tmp/pew/bin/notify.cjs",
        detail: "not present",
      }),
      removeCodexBackupFn: vi.fn().mockResolvedValue({
        changed: false,
        path: "/tmp/pew/codex_notify_original.json",
        detail: "not selected",
      }),
    });
    expect(result.hooks).toHaveLength(1);
    expect(result.hooks[0]?.source).toBe("pi");
    // Whatever the pi driver returns is fine; the goal is to exercise the
    // default-lookup branch (driver.uninstall path), not a specific outcome.
  });

  it("returns skip for an unknown source when using the built-in driver lookup", async () => {
    const result = await executeUninstall({
      stateDir: "/tmp/pew",
      home: "/tmp",
      sources: ["unknown-source" as Source],
      resolveNotifierPathsFn: createPaths,
      removeNotifyHandlerFn: vi.fn(),
      removeCodexBackupFn: vi.fn(),
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

  it("uses real removeOptionalFile to remove codex backup file", async () => {
    // Create a temporary file to serve as the codex backup
    const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const tmpDir = await mkdtemp(join(tmpdir(), "pew-uninstall-ro-"));

    try {
      const backupPath = join(tmpDir, "codex_notify_original.json");
      await writeFile(backupPath, '{"original": true}', "utf8");

      const pathsWithRealBackup = {
        ...createPaths(),
        codexNotifyOriginalPath: backupPath,
      };

      const result = await executeUninstall({
        stateDir: "/tmp/pew",
        home: "/tmp",
        sources: ["codex"],
        resolveNotifierPathsFn: () => pathsWithRealBackup,
        uninstallDriverFn: vi.fn(async () => ({
          source: "codex" as Source,
          action: "uninstall" as const,
          changed: true,
          detail: "ok",
        })),
        removeNotifyHandlerFn: vi.fn(),
        // NOT providing removeCodexBackupFn — exercises the real removeOptionalFile
      });

      expect(result.codexBackup.changed).toBe(true);
      expect(result.codexBackup.detail).toBe("artifact removed");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("real removeOptionalFile returns 'not found' for missing file", async () => {
    const pathsWithMissing = {
      ...createPaths(),
      codexNotifyOriginalPath: "/tmp/nonexistent-codex-backup-12345.json",
    };

    const result = await executeUninstall({
      stateDir: "/tmp/pew",
      home: "/tmp",
      sources: ["codex"],
      resolveNotifierPathsFn: () => pathsWithMissing,
      uninstallDriverFn: vi.fn(async () => ({
        source: "codex" as Source,
        action: "uninstall" as const,
        changed: true,
        detail: "ok",
      })),
      removeNotifyHandlerFn: vi.fn(),
      // NOT providing removeCodexBackupFn
    });

    expect(result.codexBackup.changed).toBe(false);
    expect(result.codexBackup.detail).toBe("artifact not found");
  });

  it("real removeOptionalFile rethrows non-ENOENT errors", async () => {
    const pathsWithDir = {
      ...createPaths(),
      // Use a path that will throw a permission error or EISDIR
      codexNotifyOriginalPath: "/",
    };

    await expect(
      executeUninstall({
        stateDir: "/tmp/pew",
        home: "/tmp",
        sources: ["codex"],
        resolveNotifierPathsFn: () => pathsWithDir,
        uninstallDriverFn: vi.fn(async () => ({
          source: "codex" as Source,
          action: "uninstall" as const,
          changed: true,
          detail: "ok",
        })),
        removeNotifyHandlerFn: vi.fn(),
        // NOT providing removeCodexBackupFn
      }),
    ).rejects.toThrow();
  });

  it("does not remove codex backup when codex is not selected", async () => {
    const removeCodexBackupFn = vi.fn();

    const result = await executeUninstall({
      stateDir: "/tmp/pew",
      home: "/tmp",
      sources: ["claude-code"],
      resolveNotifierPathsFn: createPaths,
      uninstallDriverFn: vi.fn(async () => ({
        source: "claude-code" as Source,
        action: "uninstall" as const,
        changed: true,
        detail: "ok",
      })),
      removeNotifyHandlerFn: vi.fn(),
      removeCodexBackupFn,
    });

    expect(removeCodexBackupFn).not.toHaveBeenCalled();
    expect(result.codexBackup.detail).toBe("not selected");
  });

  it("handles non-Error throws when driver uninstall fails", async () => {
    const uninstallDriverFn = vi.fn().mockRejectedValueOnce("string error");

    const result = await executeUninstall({
      stateDir: "/tmp/pew",
      home: "/tmp",
      sources: ["codex"],
      resolveNotifierPathsFn: createPaths,
      uninstallDriverFn,
      removeNotifyHandlerFn: vi.fn(),
      removeCodexBackupFn: vi.fn(async () => ({
        changed: false,
        path: "/tmp/pew/codex_notify_original.json",
        detail: "not found",
      })),
    });

    expect(result.hooks).toHaveLength(1);
    expect(result.hooks[0]?.action).toBe("skip");
    expect(result.hooks[0]?.detail).toBe("string error");
  });

  it("uses default resolveNotifierPaths + removeNotifyHandler when no overrides are provided", async () => {
    // Exercises the `opts.resolveNotifierPathsFn ?? resolveNotifierPaths` and
    // `opts.removeNotifyHandlerFn ?? removeNotifyHandler` default-fallback branches.
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const home = await mkdtemp(join(tmpdir(), "pew-uninstall-real-paths-"));
    try {
      const result = await executeUninstall({
        stateDir: join(home, "pew"),
        home,
        sources: ["pi" as Source],
        // No resolveNotifierPathsFn, no removeNotifyHandlerFn, no removeCodexBackupFn.
        // These defaults will run against the real (clean) tmpdir filesystem.
      });
      // Partial uninstall (only pi) → notify handler is preserved with
      // "shared artifact kept" message, regardless of default-fn implementation.
      expect(result.notifyHandler.changed).toBe(false);
      expect(result.notifyHandler.detail).toBe("shared artifact kept");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("uses default uninstallAll when full uninstall is requested without override", async () => {
    // Exercises the `opts.uninstallAllFn ?? uninstallAll` default branch by
    // *not* providing uninstallAllFn for a fullUninstall (all sources, default list).
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const home = await mkdtemp(join(tmpdir(), "pew-uninstall-real-all-"));
    try {
      const result = await executeUninstall({
        stateDir: join(home, "pew"),
        home,
        // sources omitted → fullUninstall = true → default uninstallAll runs
        // against the empty tmpdir, returning a no-op result per source.
      });
      // All sources discovered; results array is populated by the real uninstallAll.
      expect(Array.isArray(result.hooks)).toBe(true);
      expect(result.hooks.length).toBeGreaterThan(0);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
