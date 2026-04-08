import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NotifierPaths } from "../notifier/paths.js";
import {
  getAllDrivers,
  getDriver,
  installAll,
  statusAll,
  uninstallAll,
} from "../notifier/registry.js";

describe("notifier registry", () => {
  let tempDir: string;
  let paths: NotifierPaths;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-registry-"));
    paths = {
      stateDir: join(tempDir, "state"),
      binDir: join(tempDir, "state", "bin"),
      notifyPath: join(tempDir, "state", "bin", "notify.cjs"),
      lockPath: join(tempDir, "state", "sync.lock"),
      signalPath: join(tempDir, "state", "notify.signal"),
      claudeDir: join(tempDir, ".claude"),
      claudeSettingsPath: join(tempDir, ".claude", "settings.json"),
      geminiDir: join(tempDir, ".gemini"),
      geminiSettingsPath: join(tempDir, ".gemini", "settings.json"),
      opencodeConfigDir: join(tempDir, ".config", "opencode"),
      opencodePluginDir: join(tempDir, ".config", "opencode", "plugin"),
      openclawHome: join(tempDir, ".openclaw"),
      openclawConfigPath: join(tempDir, ".openclaw", "openclaw.json"),
      openclawPluginDir: join(tempDir, "state", "openclaw-plugin"),
      codexHome: join(tempDir, ".codex"),
      codexConfigPath: join(tempDir, ".codex", "config.toml"),
      codexNotifyOriginalPath: join(tempDir, "state", "codex_notify_original.json"),
    };

    await mkdir(paths.codexHome, { recursive: true });
    await writeFile(paths.codexConfigPath, 'model = "gpt-5"\n', "utf8");
    await mkdir(paths.openclawHome, { recursive: true });
    await writeFile(paths.openclawConfigPath, "{}\n", "utf8");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("registers all 5 drivers", () => {
    const drivers = getAllDrivers();
    expect(drivers).toHaveLength(5);
    expect(drivers.map((driver) => driver.source)).toEqual([
      "claude-code",
      "codex",
      "gemini-cli",
      "opencode",
      "openclaw",
    ]);
  });

  it("returns a driver by source", () => {
    expect(getDriver("codex")?.displayName).toBe("Codex");
    expect(getDriver("claude-code")?.displayName).toBe("Claude Code");
  });

  it("installs and uninstalls all drivers without stopping on openclaw CLI skip", async () => {
    const spawn = vi.fn(() => {
      const err = new Error("missing") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    });

    const installed = await installAll(paths, { spawn });
    const uninstalled = await uninstallAll(paths, { spawn });

    expect(installed).toHaveLength(5);
    expect(installed.find((item) => item.source === "openclaw")?.action).toBe("skip");
    expect(installed.find((item) => item.source === "codex")?.changed).toBe(true);
    expect(uninstalled).toHaveLength(5);
  });

  it("reports status for all sources", async () => {
    const statuses = await statusAll(paths);

    expect(Object.keys(statuses)).toHaveLength(5);
    expect(statuses.codex).toBe("not-installed");
    expect(statuses["claude-code"]).toBe("not-installed");
  });

  it("installAll catches driver.install errors and returns skip result", { timeout: 15_000 }, async () => {
    // Mock the claude-hook install to throw
    const claudeHook = await import("../notifier/claude-hook.js");
    const spy = vi
      .spyOn(claudeHook, "installClaudeHook")
      .mockRejectedValue(new Error("Claude install boom"));

    try {
      const results = await installAll(paths);
      const claudeResult = results.find((r) => r.source === "claude-code");

      expect(claudeResult).toBeDefined();
      expect(claudeResult!.action).toBe("skip");
      expect(claudeResult!.changed).toBe(false);
      expect(claudeResult!.detail).toBe("Claude install boom");
      expect(claudeResult!.warnings).toContain("Driver install failed");

      // Other drivers should still have completed
      expect(results).toHaveLength(5);
    } finally {
      spy.mockRestore();
    }
  });

  it("uninstallAll catches driver.uninstall errors and returns skip result", async () => {
    // First install so there's something to uninstall
    const spawn = vi.fn(() => {
      const err = new Error("missing") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    });
    await installAll(paths, { spawn });

    // Mock gemini-hook uninstall to throw
    const geminiHook = await import("../notifier/gemini-hook.js");
    const spy = vi
      .spyOn(geminiHook, "uninstallGeminiHook")
      .mockRejectedValue(new Error("Gemini uninstall crash"));

    try {
      const results = await uninstallAll(paths, { spawn });
      const geminiResult = results.find((r) => r.source === "gemini-cli");

      expect(geminiResult).toBeDefined();
      expect(geminiResult!.action).toBe("skip");
      expect(geminiResult!.changed).toBe(false);
      expect(geminiResult!.detail).toBe("Gemini uninstall crash");
      expect(geminiResult!.warnings).toContain("Driver uninstall failed");

      // Other drivers should still have completed
      expect(results).toHaveLength(5);
    } finally {
      spy.mockRestore();
    }
  });

  it("statusAll catches driver.status errors and returns 'error'", async () => {
    // Mock codex status to throw
    const codexNotifier = await import("../notifier/codex-notifier.js");
    const spy = vi
      .spyOn(codexNotifier, "getCodexNotifierStatus")
      .mockRejectedValue(new Error("Status check failed"));

    try {
      const statuses = await statusAll(paths);

      expect(statuses.codex).toBe("error");
      // Other sources should still report their status normally
      expect(statuses["claude-code"]).toBe("not-installed");
    } finally {
      spy.mockRestore();
    }
  });
});
