import { defineCommand, showUsage } from "citty";
import { consola } from "consola";
import pc from "picocolors";
import { homedir } from "node:os";
import type { Source } from "@pew/core";
import { resolveDefaultPaths } from "./utils/paths.js";
import { executeSync } from "./commands/sync.js";
import { executeSessionSync } from "./commands/session-sync.js";
import { executeStatus } from "./commands/status.js";
import { executeLogin, resolveHost } from "./commands/login.js";
import { executeUpload } from "./commands/upload.js";
import { executeSessionUpload } from "./commands/session-upload.js";
import { executeNotify } from "./commands/notify.js";
import { executeInit } from "./commands/init.js";
import { executeUninstall } from "./commands/uninstall.js";
import { resolveNotifierPaths } from "./notifier/paths.js";
import { statusAll } from "./notifier/registry.js";
import { ConfigManager } from "./config/manager.js";

// ---------------------------------------------------------------------------
// Dev mode detection (otter pattern)
// ---------------------------------------------------------------------------

function isDevMode(): boolean {
  return process.argv.includes("--dev");
}

function isSource(value: string): value is Source {
  return [
    "claude-code",
    "codex",
    "gemini-cli",
    "opencode",
    "openclaw",
    "vscode-copilot",
  ].includes(value);
}

// Allow self-signed certs (mkcert) in dev mode
if (isDevMode()) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const syncCommand = defineCommand({
  meta: {
    name: "sync",
    description: "Parse local AI tool usage and upload to dashboard",
  },
  args: {
    upload: {
      type: "boolean",
      description: "Upload to dashboard after syncing (default: true if logged in)",
      default: true,
    },
    dev: {
      type: "boolean",
      description: "Use the dev host (pew.dev.hexly.ai)",
      default: false,
    },
  },
  async run({ args }) {
    const paths = resolveDefaultPaths();
    consola.start("Syncing token usage from AI coding tools...\n");

    // Dynamic import: opencode-sqlite-db.ts uses bun:sqlite which is
    // only available at runtime under Bun, not in Vitest/Node test env.
    let openMessageDb: typeof import("./parsers/opencode-sqlite-db.js").openMessageDb | undefined;
    let openSessionDb: typeof import("./parsers/opencode-sqlite-db.js").openSessionDb | undefined;
    try {
      const mod = await import("./parsers/opencode-sqlite-db.js");
      openMessageDb = mod.openMessageDb;
      openSessionDb = mod.openSessionDb;
    } catch {
      // bun:sqlite not available — SQLite sync will be skipped
    }

    // Ensure a stable device ID exists for multi-device dedup
    const configManager = new ConfigManager(paths.stateDir, args.dev);
    const deviceId = await configManager.ensureDeviceId();

    const result = await executeSync({
      stateDir: paths.stateDir,
      deviceId,
      claudeDir: paths.claudeDir,
      codexSessionsDir: paths.codexSessionsDir,
      geminiDir: paths.geminiDir,
      openCodeMessageDir: paths.openCodeMessageDir,
      openCodeDbPath: paths.openCodeDbPath,
      openMessageDb,
      openclawDir: paths.openclawDir,
      vscodeCopilotDirs: paths.vscodeCopilotDirs,
      onProgress(event) {
        if (event.phase === "parse" && event.current && event.total) {
          // Only log at 25% intervals or small counts
          if (
            event.total <= 10 ||
            event.current === event.total ||
            event.current % Math.ceil(event.total / 4) === 0
          ) {
            consola.info(
              `  ${pc.cyan(event.source)} ${event.current}/${event.total} files`,
            );
          }
        }
      },
    });

    // Token summary
    consola.log("");
    if (result.totalDeltas === 0) {
      consola.info("No new token usage found.");
    } else {
      consola.success(
        `Synced ${pc.bold(String(result.totalDeltas))} new events → ${pc.bold(String(result.totalRecords))} queue records`,
      );
      const deltaParts: string[] = [];
      if (result.sources.claude > 0) deltaParts.push(`Claude: ${result.sources.claude}`);
      if (result.sources.codex > 0) deltaParts.push(`Codex: ${result.sources.codex}`);
      if (result.sources.gemini > 0) deltaParts.push(`Gemini: ${result.sources.gemini}`);
      if (result.sources.opencode > 0) deltaParts.push(`OpenCode: ${result.sources.opencode}`);
      if (result.sources.openclaw > 0) deltaParts.push(`OpenClaw: ${result.sources.openclaw}`);
      if (result.sources.vscodeCopilot > 0) deltaParts.push(`VSCode Copilot: ${result.sources.vscodeCopilot}`);
      if (deltaParts.length > 0) {
        consola.info(`  ${pc.dim(deltaParts.join("  |  "))}`);
      }
    }

    // Always show files scanned
    const fs = result.filesScanned;
    const scanParts: string[] = [];
    if (fs.claude > 0) scanParts.push(`Claude: ${fs.claude}`);
    if (fs.codex > 0) scanParts.push(`Codex: ${fs.codex}`);
    if (fs.gemini > 0) scanParts.push(`Gemini: ${fs.gemini}`);
    if (fs.opencode > 0) scanParts.push(`OpenCode: ${fs.opencode}`);
    if (fs.openclaw > 0) scanParts.push(`OpenClaw: ${fs.openclaw}`);
    if (fs.vscodeCopilot > 0) scanParts.push(`VSCode Copilot: ${fs.vscodeCopilot}`);
    if (scanParts.length > 0) {
      consola.info(`  Files scanned: ${pc.dim(scanParts.join("  |  "))}`);
    }

    // ---------- Session sync ----------
    consola.log("");
    consola.start("Syncing session statistics...\n");

    const sessionResult = await executeSessionSync({
      stateDir: paths.stateDir,
      claudeDir: paths.claudeDir,
      codexSessionsDir: paths.codexSessionsDir,
      geminiDir: paths.geminiDir,
      openCodeMessageDir: paths.openCodeMessageDir,
      openCodeDbPath: paths.openCodeDbPath,
      openSessionDb,
      openclawDir: paths.openclawDir,
      onProgress(event) {
        if (event.phase === "parse" && event.current && event.total) {
          if (
            event.total <= 10 ||
            event.current === event.total ||
            event.current % Math.ceil(event.total / 4) === 0
          ) {
            consola.info(
              `  ${pc.cyan(event.source)} ${event.current}/${event.total} files`,
            );
          }
        }
      },
    });

    // Session summary
    if (sessionResult.totalSnapshots === 0) {
      consola.info("No new sessions found.");
    } else {
      consola.success(
        `Synced ${pc.bold(String(sessionResult.totalSnapshots))} sessions → ${pc.bold(String(sessionResult.totalRecords))} queue records`,
      );
      const sessParts: string[] = [];
      if (sessionResult.sources.claude > 0) sessParts.push(`Claude: ${sessionResult.sources.claude}`);
      if (sessionResult.sources.codex > 0) sessParts.push(`Codex: ${sessionResult.sources.codex}`);
      if (sessionResult.sources.gemini > 0) sessParts.push(`Gemini: ${sessionResult.sources.gemini}`);
      if (sessionResult.sources.opencode > 0) sessParts.push(`OpenCode: ${sessionResult.sources.opencode}`);
      if (sessionResult.sources.openclaw > 0) sessParts.push(`OpenClaw: ${sessionResult.sources.openclaw}`);
      if (sessionResult.sources.vscodeCopilot > 0) sessParts.push(`VSCode Copilot: ${sessionResult.sources.vscodeCopilot}`);
      if (sessParts.length > 0) {
        consola.info(`  ${pc.dim(sessParts.join("  |  "))}`);
      }
    }

    // Always show session files scanned
    const sfs = sessionResult.filesScanned;
    const sessScanParts: string[] = [];
    if (sfs.claude > 0) sessScanParts.push(`Claude: ${sfs.claude}`);
    if (sfs.codex > 0) sessScanParts.push(`Codex: ${sfs.codex}`);
    if (sfs.gemini > 0) sessScanParts.push(`Gemini: ${sfs.gemini}`);
    if (sfs.opencode > 0) sessScanParts.push(`OpenCode: ${sfs.opencode}`);
    if (sfs.openclaw > 0) sessScanParts.push(`OpenClaw: ${sfs.openclaw}`);
    if (sfs.vscodeCopilot > 0) sessScanParts.push(`VSCode Copilot: ${sfs.vscodeCopilot}`);
    if (sessScanParts.length > 0) {
      consola.info(`  Files scanned: ${pc.dim(sessScanParts.join("  |  "))}`);
    }

    // Auto-upload if logged in
    if (args.upload) {
      const dev = isDevMode();
      const host = resolveHost(dev);
      await runUpload(paths.stateDir, host, dev);
      await runSessionUpload(paths.stateDir, host, dev);
    }
  },
});

const statusCommand = defineCommand({
  meta: {
    name: "status",
    description: "Show current sync status and token usage summary",
  },
  async run() {
    const paths = resolveDefaultPaths();
    const notifierPaths = resolveNotifierPaths(homedir(), process.env);
    const notifierStatuses = await statusAll(notifierPaths);
    const result = await executeStatus({
      stateDir: paths.stateDir,
      sourceDirs: {
        claudeDir: paths.claudeDir,
        codexSessionsDir: paths.codexSessionsDir,
        geminiDir: paths.geminiDir,
        openCodeMessageDir: paths.openCodeMessageDir,
        openclawDir: paths.openclawDir,
        vscodeCopilotDirs: paths.vscodeCopilotDirs,
      },
      notifierStatuses,
    });

    consola.log("");
    consola.log(pc.bold("pew status"));
    consola.log(pc.dim("─".repeat(40)));
    consola.log(`  Tracked files:   ${pc.cyan(String(result.trackedFiles))}`);
    consola.log(
      `  Last sync:       ${result.lastSync ? pc.green(new Date(result.lastSync).toLocaleString()) : pc.dim("never")}`,
    );
    consola.log(
      `  Pending upload:  ${result.pendingRecords > 0 ? pc.yellow(String(result.pendingRecords)) : pc.dim("0")} records`,
    );

    if (Object.keys(result.sources).length > 0) {
      consola.log("");
      consola.log(pc.bold("  Files by source:"));
      for (const [source, count] of Object.entries(result.sources).sort(([a], [b]) => a.localeCompare(b))) {
        consola.log(`    ${pc.cyan(source.padEnd(14))} ${count}`);
      }
    }

    if (Object.keys(result.notifiers).length > 0) {
      consola.log("");
      consola.log(pc.bold("  Notifiers:"));
      for (const [source, status] of Object.entries(result.notifiers).sort(([a], [b]) => a.localeCompare(b))) {
        const renderedStatus =
          status === "installed"
            ? pc.green(status)
            : status === "error"
              ? pc.red(status)
              : status === "outdated"
                ? pc.yellow(status)
                : pc.dim(status);
        consola.log(`    ${pc.cyan(source.padEnd(14))} ${renderedStatus}`);
      }
    }
    consola.log("");
  },
});

const loginCommand = defineCommand({
  meta: {
    name: "login",
    description: "Connect your CLI to the pew dashboard via browser OAuth",
  },
  args: {
    force: {
      type: "boolean",
      description: "Force re-login even if already authenticated",
      default: false,
    },
    dev: {
      type: "boolean",
      description: "Use the dev host (pew.dev.hexly.ai)",
      default: false,
    },
  },
  async run({ args }) {
    const paths = resolveDefaultPaths();
    const dev = isDevMode();
    const host = resolveHost(dev);
    const { exec } = await import("node:child_process");

    consola.start("Opening browser for authentication...\n");

    const result = await executeLogin({
      configDir: paths.stateDir,
      apiUrl: host,
      dev,
      force: args.force,
      openBrowser: async (url) => {
        const cmd =
          process.platform === "darwin"
            ? "open"
            : process.platform === "win32"
              ? "start"
              : "xdg-open";
        exec(`${cmd} "${url}"`);
      },
    });

    if (result.alreadyLoggedIn) {
      consola.info(
        `Already logged in. Use ${pc.cyan("pew login --force")} to re-authenticate.`,
      );
      return;
    }

    if (result.success) {
      consola.success(
        `Logged in as ${pc.bold(result.email ?? "unknown")}`,
      );
      consola.info(
        `Token saved to ${pc.dim(paths.stateDir + (dev ? "/config.dev.json" : "/config.json"))}`,
      );
    } else {
      consola.error(`Login failed: ${result.error}`);
      process.exitCode = 1;
    }
  },
});

const notifyCommand = defineCommand({
  meta: {
    name: "notify",
    description: "Run a coordinated sync from an AI tool hook",
  },
  args: {
    source: {
      type: "string",
      description: "Source that triggered the notify hook",
      required: true,
    },
    file: {
      type: "string",
      description: "Optional file path hint from the hook",
      required: false,
    },
  },
  async run({ args }) {
    if (!args.source || !isSource(args.source)) {
      consola.error(`Invalid source: ${String(args.source ?? "")}`);
      process.exitCode = 1;
      return;
    }

    const paths = resolveDefaultPaths();

    let openMessageDb: typeof import("./parsers/opencode-sqlite-db.js").openMessageDb | undefined;
    let openSessionDb: typeof import("./parsers/opencode-sqlite-db.js").openSessionDb | undefined;
    try {
      const mod = await import("./parsers/opencode-sqlite-db.js");
      openMessageDb = mod.openMessageDb;
      openSessionDb = mod.openSessionDb;
    } catch {
      // bun:sqlite not available — SQLite sync will be skipped
    }

    // Ensure a stable device ID exists for multi-device dedup
    const notifyConfigManager = new ConfigManager(paths.stateDir);
    const notifyDeviceId = await notifyConfigManager.ensureDeviceId();

    const result = await executeNotify({
      source: args.source,
      fileHint: args.file ?? null,
      stateDir: paths.stateDir,
      deviceId: notifyDeviceId,
      claudeDir: paths.claudeDir,
      codexSessionsDir: paths.codexSessionsDir,
      geminiDir: paths.geminiDir,
      openCodeMessageDir: paths.openCodeMessageDir,
      openCodeDbPath: paths.openCodeDbPath,
      openMessageDb,
      openSessionDb,
      openclawDir: paths.openclawDir,
      vscodeCopilotDirs: paths.vscodeCopilotDirs,
      version: "1.3.0",
    });

    if (result.error) {
      consola.warn(`notify finished with warning: ${result.error}`);
    }

    for (const [i, cycle] of result.cycles.entries()) {
      const prefix = result.cycles.length > 1 ? `cycle ${i + 1}: ` : "";
      if (cycle.tokenSyncError) {
        consola.warn(`${prefix}token sync failed: ${cycle.tokenSyncError}`);
      }
      if (cycle.sessionSyncError) {
        consola.warn(`${prefix}session sync failed: ${cycle.sessionSyncError}`);
      }
    }
  },
});

const initCommand = defineCommand({
  meta: {
    name: "init",
    description: "Install notifier hooks for supported AI tools",
  },
  args: {
    dryRun: {
      type: "boolean",
      description: "Preview changes without writing files",
      default: false,
    },
    source: {
      type: "string",
      description: "Only install hooks for a specific source",
      required: false,
    },
  },
  async run({ args }) {
    const selectedSources =
      args.source && isSource(args.source) ? [args.source] : undefined;
    if (args.source && !selectedSources) {
      consola.error(`Invalid source: ${args.source}`);
      process.exitCode = 1;
      return;
    }

    const result = await executeInit({
      stateDir: resolveDefaultPaths().stateDir,
      home: homedir(),
      env: process.env,
      dryRun: args.dryRun,
      sources: selectedSources,
    });

    consola.log("");
    consola.log(pc.bold(args.dryRun ? "pew init (dry run)" : "pew init"));
    consola.log(`  pew binary: ${pc.cyan(result.pewBin)}`);
    consola.log(`  notify.cjs: ${pc.dim(result.notifyHandler.path)}`);
    for (const hook of result.hooks) {
      const symbol = hook.changed ? pc.green("✓") : pc.dim("•");
      consola.log(`  ${symbol} ${hook.source}  ${hook.detail}`);
      if (hook.warnings?.length) {
        for (const warning of hook.warnings) {
          consola.log(`    ${pc.yellow(warning)}`);
        }
      }
    }
    consola.log("");
  },
});

const uninstallCommand = defineCommand({
  meta: {
    name: "uninstall",
    description: "Remove notifier hooks for supported AI tools",
  },
  args: {
    dryRun: {
      type: "boolean",
      description: "Preview changes without writing files",
      default: false,
    },
    source: {
      type: "string",
      description: "Only uninstall hooks for a specific source",
      required: false,
    },
  },
  async run({ args }) {
    const selectedSources =
      args.source && isSource(args.source) ? [args.source] : undefined;
    if (args.source && !selectedSources) {
      consola.error(`Invalid source: ${args.source}`);
      process.exitCode = 1;
      return;
    }

    const result = await executeUninstall({
      stateDir: resolveDefaultPaths().stateDir,
      home: homedir(),
      env: process.env,
      dryRun: args.dryRun,
      sources: selectedSources,
    });

    consola.log("");
    consola.log(pc.bold(args.dryRun ? "pew uninstall (dry run)" : "pew uninstall"));
    consola.log(`  notify.cjs: ${pc.dim(result.notifyHandler.path)}  ${result.notifyHandler.detail}`);
    consola.log(`  codex backup: ${pc.dim(result.codexBackup.path)}  ${result.codexBackup.detail}`);
    for (const hook of result.hooks) {
      const symbol = hook.changed ? pc.green("✓") : pc.dim("•");
      consola.log(`  ${symbol} ${hook.source}  ${hook.detail}`);
      if (hook.warnings?.length) {
        for (const warning of hook.warnings) {
          consola.log(`    ${pc.yellow(warning)}`);
        }
      }
    }
    consola.log("");
  },
});

// ---------------------------------------------------------------------------
// Upload helper (used by `sync --upload`)
// ---------------------------------------------------------------------------

async function runUpload(stateDir: string, apiUrl: string, dev: boolean): Promise<void> {
  consola.log("");
  consola.start("Uploading tokens to dashboard...");

  const uploadResult = await executeUpload({
    stateDir,
    apiUrl,
    dev,
    fetch: globalThis.fetch,
    onProgress(event) {
      if (event.phase === "uploading") {
        consola.info(
          `  ${pc.dim(`Batch ${event.batch}/${event.totalBatches}`)} (${event.message})`,
        );
      }
    },
  });

  if (!uploadResult.success && uploadResult.error?.match(/not logged in/i)) {
    consola.info(
      `Not logged in — skipping upload. Run ${pc.cyan("pew login")} to enable.`,
    );
    return;
  }

  if (uploadResult.success) {
    if (uploadResult.uploaded === 0) {
      consola.info("No pending token records to upload.");
    } else {
      consola.success(
        `Uploaded ${pc.bold(String(uploadResult.uploaded))} token records in ${uploadResult.batches} batch(es).`,
      );
    }
  } else {
    consola.error(`Token upload failed: ${uploadResult.error}`);
    if (uploadResult.uploaded > 0) {
      consola.info(
        `  ${pc.yellow(String(uploadResult.uploaded))} records uploaded before failure.`,
      );
    }
    process.exitCode = 1;
  }
}

async function runSessionUpload(stateDir: string, apiUrl: string, dev: boolean): Promise<void> {
  consola.log("");
  consola.start("Uploading sessions to dashboard...");

  const uploadResult = await executeSessionUpload({
    stateDir,
    apiUrl,
    dev,
    fetch: globalThis.fetch,
    onProgress(event) {
      if (event.phase === "uploading") {
        consola.info(
          `  ${pc.dim(`Batch ${event.batch}/${event.totalBatches}`)} (${event.message})`,
        );
      }
    },
  });

  if (!uploadResult.success && uploadResult.error?.match(/not logged in/i)) {
    // Already shown by token upload — skip redundant message
    return;
  }

  if (uploadResult.success) {
    if (uploadResult.uploaded === 0) {
      consola.info("No pending session records to upload.");
    } else {
      consola.success(
        `Uploaded ${pc.bold(String(uploadResult.uploaded))} session records in ${uploadResult.batches} batch(es).`,
      );
    }
  } else {
    consola.error(`Session upload failed: ${uploadResult.error}`);
    if (uploadResult.uploaded > 0) {
      consola.info(
        `  ${pc.yellow(String(uploadResult.uploaded))} records uploaded before failure.`,
      );
    }
    process.exitCode = 1;
  }
}

export const main = defineCommand({
  meta: {
    name: "pew",
    version: "1.3.0",
    description: "The contribution graph for AI-native developers",
  },
  subCommands: {
    sync: syncCommand,
    status: statusCommand,
    login: loginCommand,
    notify: notifyCommand,
    init: initCommand,
    uninstall: uninstallCommand,
  },
  run({ rawArgs }) {
    // Show usage only when invoked directly without a subcommand.
    // citty still calls the parent run() after executing a subcommand,
    // but rawArgs will be non-empty (e.g. ["status"]) in that case.
    if (rawArgs.length === 0) {
      showUsage(main);
    }
  },
});
