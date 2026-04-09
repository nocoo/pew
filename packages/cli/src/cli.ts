import { defineCommand, showUsage, pc, readVersion, openBrowser } from "@nocoo/cli-base";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./log.js";
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
import { executeReset } from "./commands/reset.js";
import { executeUpdate } from "./commands/update.js";
import { resolveNotifierPaths } from "./notifier/paths.js";
import { statusAll } from "./notifier/registry.js";
import { ConfigManager } from "./config/manager.js";

// ---------------------------------------------------------------------------
// CLI version — read from package.json (single source of truth)
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_VERSION = readVersion(dirname(__dirname));

// ---------------------------------------------------------------------------
// Dev mode detection (otter pattern)
// ---------------------------------------------------------------------------

function isDevMode(): boolean {
  return process.argv.includes("--dev");
}

/** Shared handler for corrupted JSONL lines in queue files */
function handleCorruptLine(line: string, _error: unknown): void {
  log.warn(`${pc.yellow("Skipping corrupt queue line:")} ${pc.dim(line.slice(0, 80))}${line.length > 80 ? "…" : ""}`);}

function isSource(value: string): value is Source {
  return [
    "claude-code",
    "codex",
    "gemini-cli",
    "kosmos",
    "opencode",
    "openclaw",
    "pi",
    "vscode-copilot",
    "copilot-cli",
    "hermes",
  ].includes(value);
}

// Allow self-signed certs (mkcert) in dev mode
if (isDevMode()) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

// ---------------------------------------------------------------------------
// Inline progress — TTY gets a single overwritten line, non-TTY is silent.
// Warnings always print on their own line (log.warn).
// ---------------------------------------------------------------------------

const isTTY = process.stderr.isTTY === true;
let lastProgressLine = "";

function writeProgress(text: string) {
  if (!isTTY) return;
  // Clear previous line, write new one (no trailing newline → stays on same line)
  const cols = process.stderr.columns ?? 80;
  const padded = text.length < cols ? text + " ".repeat(cols - text.length) : text.slice(0, cols);
  process.stderr.write(`\r${padded}`);
  lastProgressLine = text;
}

function clearProgress() {
  if (!isTTY || !lastProgressLine) return;
  const cols = process.stderr.columns ?? 80;
  process.stderr.write(`\r${" ".repeat(cols)}\r`);
  lastProgressLine = "";
}

function logSyncProgress(event: {
  source: string;
  phase: "discover" | "parse" | "aggregate" | "done" | "warn";
  current?: number;
  total?: number;
  message?: string;
}) {
  if (event.phase === "parse" && event.current && event.total) {
    writeProgress(`  ${event.source} ${event.current}/${event.total} files`);
    return;
  }

  // SQLite-backed OpenCode sync emits descriptive messages instead of
  // file counters. Surface them so the CLI shows DB activity explicitly.
  if (
    event.source === "opencode-sqlite" &&
    event.message &&
    (event.phase === "discover" || event.phase === "parse")
  ) {
    writeProgress(`  ${event.source} ${event.message}`);
    return;
  }

  if (event.phase === "warn" && event.message) {
    clearProgress();
    log.warn(pc.yellow(event.message));
  }
}

function logSessionSyncProgress(event: {
  source: string;
  phase: "discover" | "parse" | "dedup" | "done" | "warn";
  current?: number;
  total?: number;
  message?: string;
}) {
  if (event.phase === "parse" && event.current && event.total) {
    writeProgress(`  ${event.source} ${event.current}/${event.total} files`);
    return;
  }

  if (
    event.source === "opencode-sqlite" &&
    event.message &&
    (event.phase === "discover" || event.phase === "parse")
  ) {
    writeProgress(`  ${event.source} ${event.message}`);
    return;
  }

  if (event.phase === "warn" && event.message) {
    clearProgress();
    log.warn(pc.yellow(event.message));
  }
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
    log.start("Syncing token usage from AI coding tools...");
    log.blank();

    // Dynamic import: opencode-sqlite-db.ts uses platform SQLite bindings
    // (bun:sqlite or node:sqlite) which may not be available on older Node.js.
    let openMessageDb: typeof import("./parsers/opencode-sqlite-db.js").openMessageDb | undefined;
    let openSessionDb: typeof import("./parsers/opencode-sqlite-db.js").openSessionDb | undefined;
    let openHermesDb: typeof import("./parsers/hermes-sqlite-db.js").openHermesDb | undefined;
    try {
      const mod = await import("./parsers/opencode-sqlite-db.js");
      openMessageDb = mod.openMessageDb;
      openSessionDb = mod.openSessionDb;
    } catch {
      // Native SQLite module not available — SQLite sync will be skipped
    }
    try {
      const hermesModule = await import("./parsers/hermes-sqlite-db.js");
      openHermesDb = hermesModule.openHermesDb;
    } catch {
      // Native SQLite module not available — Hermes SQLite sync will be skipped
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
      kosmosDataDirs: paths.kosmosDataDirs,
      openCodeMessageDir: paths.openCodeMessageDir,
      openCodeDbPath: paths.openCodeDbPath,
      openMessageDb,
      hermesDbPath: paths.hermesDbPath,
      hermesProfileDbPaths: paths.hermesProfileDbPaths,
      openHermesDb,
      openclawDir: paths.openclawDir,
      piSessionsDir: paths.piSessionsDir,
      vscodeCopilotDirs: paths.vscodeCopilotDirs,
      copilotCliLogsDir: paths.copilotCliLogsDir,
      onCorruptLine: handleCorruptLine,
      onProgress(event) {
        logSyncProgress(event);
      },
    });

    // Token summary
    clearProgress();
    log.blank();
    if (result.totalDeltas === 0) {
      log.info("No new token usage found.");
    } else {
      log.success(
        `Synced ${pc.bold(String(result.totalDeltas))} new events → ${pc.bold(String(result.totalRecords))} queue records`,
      );
      const deltaParts: string[] = [];
      if (result.sources.claude > 0) deltaParts.push(`Claude: ${result.sources.claude}`);
      if (result.sources.codex > 0) deltaParts.push(`Codex: ${result.sources.codex}`);
      if (result.sources.gemini > 0) deltaParts.push(`Gemini: ${result.sources.gemini}`);
      if (result.sources.kosmos > 0) deltaParts.push(`Kosmos: ${result.sources.kosmos}`);
      if (result.sources.opencode > 0) deltaParts.push(`OpenCode: ${result.sources.opencode}`);
      if (result.sources.openclaw > 0) deltaParts.push(`OpenClaw: ${result.sources.openclaw}`);
      if (result.sources.pi > 0) deltaParts.push(`Pi: ${result.sources.pi}`);
      if (result.sources.vscodeCopilot > 0) deltaParts.push(`VSCode Copilot: ${result.sources.vscodeCopilot}`);
      if (result.sources.copilotCli > 0) deltaParts.push(`Copilot CLI: ${result.sources.copilotCli}`);
      if (result.sources.hermes > 0) deltaParts.push(`Hermes: ${result.sources.hermes}`);
      if (deltaParts.length > 0) {
        log.text(pc.dim(deltaParts.join("  |  ")));
      }
    }

    // Always show files scanned
    const fs = result.filesScanned;
    const scanParts: string[] = [];
    if (fs.claude > 0) scanParts.push(`Claude: ${fs.claude}`);
    if (fs.codex > 0) scanParts.push(`Codex: ${fs.codex}`);
    if (fs.gemini > 0) scanParts.push(`Gemini: ${fs.gemini}`);
    if (fs.kosmos > 0) scanParts.push(`Kosmos: ${fs.kosmos}`);
    if (fs.opencode > 0) scanParts.push(`OpenCode: ${fs.opencode}`);
    if (fs.openclaw > 0) scanParts.push(`OpenClaw: ${fs.openclaw}`);
    if (fs.pi > 0) scanParts.push(`Pi: ${fs.pi}`);
    if (fs.vscodeCopilot > 0) scanParts.push(`VSCode Copilot: ${fs.vscodeCopilot}`);
    if (fs.copilotCli > 0) scanParts.push(`Copilot CLI: ${fs.copilotCli}`);
    if (fs.hermes > 0) scanParts.push(`Hermes: ${fs.hermes}`);
    if (scanParts.length > 0) {
      log.text(`Files scanned: ${pc.dim(scanParts.join("  |  "))}`);
    }

    // ---------- Session sync ----------
    log.blank();
    log.start("Syncing session statistics...");
    log.blank();

    const sessionResult = await executeSessionSync({
      stateDir: paths.stateDir,
      claudeDir: paths.claudeDir,
      codexSessionsDir: paths.codexSessionsDir,
      geminiDir: paths.geminiDir,
      kosmosDataDirs: paths.kosmosDataDirs,
      openCodeMessageDir: paths.openCodeMessageDir,
      openCodeDbPath: paths.openCodeDbPath,
      openSessionDb,
      openclawDir: paths.openclawDir,
      piSessionsDir: paths.piSessionsDir,
      onCorruptLine: handleCorruptLine,
      onProgress(event) {
        logSessionSyncProgress(event);
      },
    });

    // Session summary
    clearProgress();
    if (sessionResult.totalSnapshots === 0) {
      log.info("No new sessions found.");
    } else {
      log.success(
        `Synced ${pc.bold(String(sessionResult.totalSnapshots))} sessions → ${pc.bold(String(sessionResult.totalRecords))} queue records`,
      );
      const sessParts: string[] = [];
      if (sessionResult.sources.claude > 0) sessParts.push(`Claude: ${sessionResult.sources.claude}`);
      if (sessionResult.sources.codex > 0) sessParts.push(`Codex: ${sessionResult.sources.codex}`);
      if (sessionResult.sources.gemini > 0) sessParts.push(`Gemini: ${sessionResult.sources.gemini}`);
      if (sessionResult.sources.kosmos > 0) sessParts.push(`Kosmos: ${sessionResult.sources.kosmos}`);
      if (sessionResult.sources.opencode > 0) sessParts.push(`OpenCode: ${sessionResult.sources.opencode}`);
      if (sessionResult.sources.openclaw > 0) sessParts.push(`OpenClaw: ${sessionResult.sources.openclaw}`);
      if (sessionResult.sources.pi > 0) sessParts.push(`Pi: ${sessionResult.sources.pi}`);
      if (sessParts.length > 0) {
        log.text(pc.dim(sessParts.join("  |  ")));
      }
    }

    // Always show session files scanned
    const sfs = sessionResult.filesScanned;
    const sessScanParts: string[] = [];
    if (sfs.claude > 0) sessScanParts.push(`Claude: ${sfs.claude}`);
    if (sfs.codex > 0) sessScanParts.push(`Codex: ${sfs.codex}`);
    if (sfs.gemini > 0) sessScanParts.push(`Gemini: ${sfs.gemini}`);
    if (sfs.kosmos > 0) sessScanParts.push(`Kosmos: ${sfs.kosmos}`);
    if (sfs.opencode > 0) sessScanParts.push(`OpenCode: ${sfs.opencode}`);
    if (sfs.openclaw > 0) sessScanParts.push(`OpenClaw: ${sfs.openclaw}`);
    if (sfs.pi > 0) sessScanParts.push(`Pi: ${sfs.pi}`);
    if (sessScanParts.length > 0) {
      log.text(`Files scanned: ${pc.dim(sessScanParts.join("  |  "))}`);
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
        kosmosDataDirs: paths.kosmosDataDirs,
        openCodeMessageDir: paths.openCodeMessageDir,
        openclawDir: paths.openclawDir,
        piSessionsDir: paths.piSessionsDir,
        vscodeCopilotDirs: paths.vscodeCopilotDirs,
        copilotCliLogsDir: paths.copilotCliLogsDir,
      },
      notifierStatuses,
      onCorruptLine: handleCorruptLine,
    });

    log.blank();
    log.text(pc.bold("pew status"));
    log.text(pc.dim("─".repeat(40)));
    log.text(`Tracked files:   ${pc.cyan(String(result.trackedFiles))}`);
    log.text(
      `Last sync:       ${result.lastSync ? pc.green(new Date(result.lastSync).toLocaleString()) : pc.dim("never")}`,
    );
    log.text(
      `Pending upload:  ${result.pendingRecords > 0 ? pc.yellow(String(result.pendingRecords)) : pc.dim("0")} records`,
    );

    if (Object.keys(result.sources).length > 0) {
      log.blank();
      log.text(pc.bold("Files by source:"));
      for (const [source, count] of Object.entries(result.sources).sort(([a], [b]) => a.localeCompare(b))) {
        log.text(`  ${pc.cyan(source.padEnd(14))} ${count}`);
      }
    }

    if (Object.keys(result.notifiers).length > 0) {
      log.blank();
      log.text(pc.bold("Notifiers:"));
      for (const [source, status] of Object.entries(result.notifiers).sort(([a], [b]) => a.localeCompare(b))) {
        const renderedStatus =
          status === "installed"
            ? pc.green(status)
            : status === "error"
              ? pc.red(status)
              : status === "outdated"
                ? pc.yellow(status)
                : pc.dim(status);
        log.text(`  ${pc.cyan(source.padEnd(14))} ${renderedStatus}`);
      }
    }
    log.blank();
  },
});

const loginCommand = defineCommand({
  meta: {
    name: "login",
    description: "Connect your CLI to the pew dashboard via browser OAuth or one-time code",
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
    code: {
      type: "string",
      description: "One-time code from web UI (for headless login)",
      required: false,
    },
  },
  async run({ args }) {
    const paths = resolveDefaultPaths();
    const dev = isDevMode();
    const host = resolveHost(dev);

    if (args.code) {
      log.start("Verifying authentication code...");
    } else {
      log.start("Opening browser for authentication...");
    }

    const result = await executeLogin({
      configDir: paths.stateDir,
      apiUrl: host,
      dev,
      force: args.force,
      openBrowser,
      code: args.code,
    });

    if (result.alreadyLoggedIn) {
      log.info(
        `Already logged in. Use ${pc.cyan("pew login --force")} to re-authenticate.`,
      );
      return;
    }

    if (result.success) {
      log.success(
        `Logged in as ${pc.bold(result.email ?? "unknown")}`,
      );
      log.info(
        `Token saved to ${pc.dim(paths.stateDir + (dev ? "/config.dev.json" : "/config.json"))}`,
      );
    } else {
      log.error(`Login failed: ${result.error}`);
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
      log.error(`Invalid source: ${String(args.source ?? "")}`);
      process.exitCode = 1;
      return;
    }

    const paths = resolveDefaultPaths();

    // Dynamic import: opencode-sqlite-db.ts uses platform SQLite bindings
    // (bun:sqlite or node:sqlite) which may not be available on older Node.js.
    let openMessageDb2: typeof import("./parsers/opencode-sqlite-db.js").openMessageDb | undefined;
    let openSessionDb2: typeof import("./parsers/opencode-sqlite-db.js").openSessionDb | undefined;
    let openHermesDb2: typeof import("./parsers/hermes-sqlite-db.js").openHermesDb | undefined;
    try {
      const mod = await import("./parsers/opencode-sqlite-db.js");
      openMessageDb2 = mod.openMessageDb;
      openSessionDb2 = mod.openSessionDb;
    } catch {
      // Native SQLite module not available — SQLite sync will be skipped
    }
    try {
      const hermesModule = await import("./parsers/hermes-sqlite-db.js");
      openHermesDb2 = hermesModule.openHermesDb;
    } catch {
      // Native SQLite module not available — Hermes SQLite sync will be skipped
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
      kosmosDataDirs: paths.kosmosDataDirs,
      openCodeMessageDir: paths.openCodeMessageDir,
      openCodeDbPath: paths.openCodeDbPath,
      openMessageDb: openMessageDb2,
      hermesDbPath: paths.hermesDbPath,
      openHermesDb: openHermesDb2,
      openSessionDb: openSessionDb2,
      openclawDir: paths.openclawDir,
      piSessionsDir: paths.piSessionsDir,
      vscodeCopilotDirs: paths.vscodeCopilotDirs,
      copilotCliLogsDir: paths.copilotCliLogsDir,
      version: CLI_VERSION,
    });

    if (result.error) {
      log.warn(`notify finished with warning: ${result.error}`);
    }

    for (const [i, cycle] of result.cycles.entries()) {
      const prefix = result.cycles.length > 1 ? `cycle ${i + 1}: ` : "";
      if (cycle.tokenSyncError) {
        log.warn(`${prefix}token sync failed: ${cycle.tokenSyncError}`);
      }
      if (cycle.sessionSyncError) {
        log.warn(`${prefix}session sync failed: ${cycle.sessionSyncError}`);
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
      log.error(`Invalid source: ${args.source}`);
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

    log.blank();
    log.text(pc.bold(args.dryRun ? "pew init (dry run)" : "pew init"));
    log.text(`pew binary: ${pc.cyan(result.pewBin)}`);
    log.text(`notify.cjs: ${pc.dim(result.notifyHandler.path)}`);
    for (const hook of result.hooks) {
      const symbol = hook.changed ? pc.green("✓") : pc.dim("•");
      log.text(`${symbol} ${hook.source}  ${hook.detail}`);
      if (hook.warnings?.length) {
        for (const warning of hook.warnings) {
          log.text(`  ${pc.yellow(warning)}`);
        }
      }
    }
    log.blank();
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
      log.error(`Invalid source: ${args.source}`);
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

    log.blank();
    log.text(pc.bold(args.dryRun ? "pew uninstall (dry run)" : "pew uninstall"));
    log.text(`notify.cjs: ${pc.dim(result.notifyHandler.path)}  ${result.notifyHandler.detail}`);
    log.text(`codex backup: ${pc.dim(result.codexBackup.path)}  ${result.codexBackup.detail}`);
    for (const hook of result.hooks) {
      const symbol = hook.changed ? pc.green("✓") : pc.dim("•");
      log.text(`${symbol} ${hook.source}  ${hook.detail}`);
      if (hook.warnings?.length) {
        for (const warning of hook.warnings) {
          log.text(`  ${pc.yellow(warning)}`);
        }
      }
    }
    log.blank();
  },
});

// ---------------------------------------------------------------------------
// Upload helper (used by `sync --upload`)
// ---------------------------------------------------------------------------

async function runUpload(stateDir: string, apiUrl: string, dev: boolean): Promise<void> {
  log.blank();
  log.start("Uploading tokens to dashboard...");

  const uploadResult = await executeUpload({
    stateDir,
    apiUrl,
    dev,
    fetch: globalThis.fetch,
    clientVersion: CLI_VERSION,
    onCorruptLine: handleCorruptLine,
    onProgress(event) {
      if (event.phase === "uploading") {
        log.text(pc.dim(`Batch ${event.batch}/${event.totalBatches}`) + ` (${event.message})`);
      }
    },
  });

  if (!uploadResult.success && uploadResult.error?.match(/not logged in/i)) {
    log.info(
      `Not logged in — skipping upload. Run ${pc.cyan("pew login")} to enable.`,
    );
    return;
  }

  if (uploadResult.success) {
    if (uploadResult.uploaded === 0) {
      log.info("No pending token records to upload.");
    } else {
      log.success(
        `Uploaded ${pc.bold(String(uploadResult.uploaded))} token records in ${uploadResult.batches} batch(es).`,
      );
    }
  } else {
    log.error(`Token upload failed: ${uploadResult.error}`);
    if (uploadResult.uploaded > 0) {
      log.text(`${pc.yellow(String(uploadResult.uploaded))} records uploaded before failure.`);
    }
    process.exitCode = 1;
  }
}

async function runSessionUpload(stateDir: string, apiUrl: string, dev: boolean): Promise<void> {
  log.blank();
  log.start("Uploading sessions to dashboard...");

  const uploadResult = await executeSessionUpload({
    stateDir,
    apiUrl,
    dev,
    fetch: globalThis.fetch,
    clientVersion: CLI_VERSION,
    onCorruptLine: handleCorruptLine,
    onProgress(event) {
      if (event.phase === "uploading") {
        log.text(pc.dim(`Batch ${event.batch}/${event.totalBatches}`) + ` (${event.message})`);
      }
    },
  });

  if (!uploadResult.success && uploadResult.error?.match(/not logged in/i)) {
    // Already shown by token upload — skip redundant message
    return;
  }

  if (uploadResult.success) {
    if (uploadResult.uploaded === 0) {
      log.info("No pending session records to upload.");
    } else {
      log.success(
        `Uploaded ${pc.bold(String(uploadResult.uploaded))} session records in ${uploadResult.batches} batch(es).`,
      );
    }
  } else {
    log.error(`Session upload failed: ${uploadResult.error}`);
    if (uploadResult.uploaded > 0) {
      log.text(`${pc.yellow(String(uploadResult.uploaded))} records uploaded before failure.`);
    }
    process.exitCode = 1;
  }
}

const resetCommand = defineCommand({
  meta: {
    name: "reset",
    description: "Clear all sync/upload state for a clean re-sync",
  },
  async run() {
    const paths = resolveDefaultPaths();
    log.start("Resetting pew state...");

    const result = await executeReset({ stateDir: paths.stateDir });

    const deleted = result.files.filter((f) => f.deleted);
    const skipped = result.files.filter((f) => !f.deleted);

    if (deleted.length > 0) {
      for (const f of deleted) {
        log.text(`${pc.green("✓")} ${f.file}`);
      }
    }
    if (skipped.length > 0) {
      for (const f of skipped) {
        log.text(`${pc.dim("•")} ${pc.dim(f.file)} (not found)`);
      }
    }

    log.blank();
    log.success(
      `Cleared ${deleted.length} state file(s). Run ${pc.cyan("pew sync")} to rebuild.`,
    );
  },
});

const updateCommand = defineCommand({
  meta: {
    name: "update",
    description: "Update pew to the latest version from npm",
  },
  async run() {
    log.start(`Updating pew from v${CLI_VERSION}...`);

    const result = await executeUpdate({ currentVersion: CLI_VERSION });

    if (result.success) {
      if (result.output) {
        log.text(pc.dim(result.output));
      }
      log.blank();
      log.success("pew has been updated to the latest version.");
    } else {
      log.error(`Update failed: ${result.error}`);
      log.text(`You can also update manually: ${pc.cyan("npm install -g @nocoo/pew@latest")}`);
      process.exitCode = 1;
    }
  },
});

export const main = defineCommand({
  meta: {
    name: "pew",
    version: CLI_VERSION,    description: "The contribution graph for AI-native developers",
  },
  subCommands: {
    sync: syncCommand,
    status: statusCommand,
    login: loginCommand,
    notify: notifyCommand,
    init: initCommand,
    uninstall: uninstallCommand,
    reset: resetCommand,
    update: updateCommand,
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
