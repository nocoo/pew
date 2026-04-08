import type { NotifierOperationResult, NotifierStatus, Source } from "@pew/core";
import type { NotifierPaths } from "./paths.js";
import { installClaudeHook, uninstallClaudeHook, getClaudeHookStatus } from "./claude-hook.js";
import { installGeminiHook, uninstallGeminiHook, getGeminiHookStatus } from "./gemini-hook.js";
import {
  installOpenCodePlugin,
  uninstallOpenCodePlugin,
  getOpenCodePluginStatus,
} from "./opencode-plugin.js";
import {
  installOpenClawHook,
  uninstallOpenClawHook,
  getOpenClawHookStatus,
} from "./openclaw-hook.js";
import {
  installCodexNotifier,
  uninstallCodexNotifier,
  getCodexNotifierStatus,
} from "./codex-notifier.js";

interface RegistryDeps {
  spawn?: (cmd: string, args: string[], opts?: object) => { status: number | null };
}

export interface NotifierDriver {
  source: Source;
  displayName: string;
  install(paths: NotifierPaths, deps?: RegistryDeps): Promise<NotifierOperationResult>;
  uninstall(paths: NotifierPaths, deps?: RegistryDeps): Promise<NotifierOperationResult>;
  status(paths: NotifierPaths): Promise<NotifierStatus>;
}

const DRIVERS: NotifierDriver[] = [
  {
    source: "claude-code",
    displayName: "Claude Code",
    install: (paths) =>
      installClaudeHook({
        settingsPath: paths.claudeSettingsPath,
        notifyPath: paths.notifyPath,
      }),
    uninstall: (paths) =>
      uninstallClaudeHook({
        settingsPath: paths.claudeSettingsPath,
        notifyPath: paths.notifyPath,
      }),
    status: (paths) =>
      getClaudeHookStatus({
        settingsPath: paths.claudeSettingsPath,
        notifyPath: paths.notifyPath,
      }),
  },
  {
    source: "codex",
    displayName: "Codex",
    install: (paths) =>
      installCodexNotifier({
        configPath: paths.codexConfigPath,
        notifyPath: paths.notifyPath,
        originalBackupPath: paths.codexNotifyOriginalPath,
      }),
    uninstall: (paths) =>
      uninstallCodexNotifier({
        configPath: paths.codexConfigPath,
        notifyPath: paths.notifyPath,
        originalBackupPath: paths.codexNotifyOriginalPath,
      }),
    status: (paths) =>
      getCodexNotifierStatus({
        configPath: paths.codexConfigPath,
        notifyPath: paths.notifyPath,
        originalBackupPath: paths.codexNotifyOriginalPath,
      }),
  },
  {
    source: "gemini-cli",
    displayName: "Gemini CLI",
    install: (paths) =>
      installGeminiHook({
        settingsPath: paths.geminiSettingsPath,
        notifyPath: paths.notifyPath,
      }),
    uninstall: (paths) =>
      uninstallGeminiHook({
        settingsPath: paths.geminiSettingsPath,
        notifyPath: paths.notifyPath,
      }),
    status: (paths) =>
      getGeminiHookStatus({
        settingsPath: paths.geminiSettingsPath,
        notifyPath: paths.notifyPath,
      }),
  },
  {
    source: "opencode",
    displayName: "OpenCode",
    install: (paths) =>
      installOpenCodePlugin({
        pluginDir: paths.opencodePluginDir,
        notifyPath: paths.notifyPath,
      }),
    uninstall: (paths) =>
      uninstallOpenCodePlugin({
        pluginDir: paths.opencodePluginDir,
        notifyPath: paths.notifyPath,
      }),
    status: (paths) =>
      getOpenCodePluginStatus({
        pluginDir: paths.opencodePluginDir,
        notifyPath: paths.notifyPath,
      }),
  },
  {
    source: "openclaw",
    displayName: "OpenClaw",
    install: (paths, deps) =>
      installOpenClawHook({
        pluginBaseDir: paths.openclawPluginDir,
        notifyPath: paths.notifyPath,
        openclawConfigPath: paths.openclawConfigPath,
        spawn: deps?.spawn,
      }),
    uninstall: (paths, deps) =>
      uninstallOpenClawHook({
        pluginBaseDir: paths.openclawPluginDir,
        notifyPath: paths.notifyPath,
        openclawConfigPath: paths.openclawConfigPath,
        spawn: deps?.spawn,
      }),
    status: (paths) =>
      getOpenClawHookStatus({
        pluginBaseDir: paths.openclawPluginDir,
        notifyPath: paths.notifyPath,
        openclawConfigPath: paths.openclawConfigPath,
      }),
  },
];

export function getAllDrivers(): NotifierDriver[] {
  return DRIVERS.slice();
}

export function getDriver(source: Source): NotifierDriver | undefined {
  return DRIVERS.find((driver) => driver.source === source);
}

export async function installAll(
  paths: NotifierPaths,
  deps?: RegistryDeps,
): Promise<NotifierOperationResult[]> {
  return Promise.all(
    DRIVERS.map(async (driver) => {
      try {
        return await driver.install(paths, deps);
      } catch (error) {
        return {
          source: driver.source,
          action: "skip",
          changed: false,
          detail: error instanceof Error ? error.message : String(error),
          warnings: ["Driver install failed"],
        } satisfies NotifierOperationResult;
      }
    }),
  );
}

export async function uninstallAll(
  paths: NotifierPaths,
  deps?: RegistryDeps,
): Promise<NotifierOperationResult[]> {
  return Promise.all(
    DRIVERS.map(async (driver) => {
      try {
        return await driver.uninstall(paths, deps);
      } catch (error) {
        return {
          source: driver.source,
          action: "skip",
          changed: false,
          detail: error instanceof Error ? error.message : String(error),
          warnings: ["Driver uninstall failed"],
        } satisfies NotifierOperationResult;
      }
    }),
  );
}

export async function statusAll(
  paths: NotifierPaths,
): Promise<Record<Source, NotifierStatus>> {
  const entries = await Promise.all(
    DRIVERS.map(async (driver) => {
      try {
        return [driver.source, await driver.status(paths)] as const;
      } catch {
        return [driver.source, "error"] as const;
      }
    }),
  );

  return Object.fromEntries(entries) as Record<Source, NotifierStatus>;
}
