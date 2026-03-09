import { defineCommand } from "citty";
import { consola } from "consola";
import pc from "picocolors";
import { resolveDefaultPaths } from "./utils/paths.js";
import { executeSync } from "./commands/sync.js";
import { executeSessionSync } from "./commands/session-sync.js";
import { executeStatus } from "./commands/status.js";
import { executeLogin, resolveHost } from "./commands/login.js";
import { executeUpload } from "./commands/upload.js";
import { executeSessionUpload } from "./commands/session-upload.js";

// ---------------------------------------------------------------------------
// Dev mode detection (otter pattern)
// ---------------------------------------------------------------------------

function isDevMode(): boolean {
  return process.argv.includes("--dev");
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
    try {
      const mod = await import("./parsers/opencode-sqlite-db.js");
      openMessageDb = mod.openMessageDb;
    } catch {
      // bun:sqlite not available — SQLite sync will be skipped
    }

    const result = await executeSync({
      stateDir: paths.stateDir,
      claudeDir: paths.claudeDir,
      geminiDir: paths.geminiDir,
      openCodeMessageDir: paths.openCodeMessageDir,
      openCodeDbPath: paths.openCodeDbPath,
      openMessageDb,
      openclawDir: paths.openclawDir,
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
      if (result.sources.gemini > 0) deltaParts.push(`Gemini: ${result.sources.gemini}`);
      if (result.sources.opencode > 0) deltaParts.push(`OpenCode: ${result.sources.opencode}`);
      if (result.sources.openclaw > 0) deltaParts.push(`OpenClaw: ${result.sources.openclaw}`);
      if (deltaParts.length > 0) {
        consola.info(`  ${pc.dim(deltaParts.join("  |  "))}`);
      }
    }

    // Always show files scanned
    const fs = result.filesScanned;
    const scanParts: string[] = [];
    if (fs.claude > 0) scanParts.push(`Claude: ${fs.claude}`);
    if (fs.gemini > 0) scanParts.push(`Gemini: ${fs.gemini}`);
    if (fs.opencode > 0) scanParts.push(`OpenCode: ${fs.opencode}`);
    if (fs.openclaw > 0) scanParts.push(`OpenClaw: ${fs.openclaw}`);
    if (scanParts.length > 0) {
      consola.info(`  Files scanned: ${pc.dim(scanParts.join("  |  "))}`);
    }

    // ---------- Session sync ----------
    consola.log("");
    consola.start("Syncing session statistics...\n");

    // Dynamic import for session DB adapter (same bun:sqlite constraint)
    let openSessionDb: typeof import("./parsers/opencode-sqlite-db.js").openSessionDb | undefined;
    try {
      const mod = await import("./parsers/opencode-sqlite-db.js");
      openSessionDb = mod.openSessionDb;
    } catch {
      // bun:sqlite not available — SQLite session sync will be skipped
    }

    const sessionResult = await executeSessionSync({
      stateDir: paths.stateDir,
      claudeDir: paths.claudeDir,
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
      if (sessionResult.sources.gemini > 0) sessParts.push(`Gemini: ${sessionResult.sources.gemini}`);
      if (sessionResult.sources.opencode > 0) sessParts.push(`OpenCode: ${sessionResult.sources.opencode}`);
      if (sessionResult.sources.openclaw > 0) sessParts.push(`OpenClaw: ${sessionResult.sources.openclaw}`);
      if (sessParts.length > 0) {
        consola.info(`  ${pc.dim(sessParts.join("  |  "))}`);
      }
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
    const result = await executeStatus({ stateDir: paths.stateDir });

    consola.log("");
    consola.log(pc.bold("Pew Status"));
    consola.log(pc.dim("─".repeat(40)));
    consola.log(`  Tracked files:   ${pc.cyan(String(result.trackedFiles))}`);
    consola.log(
      `  Last sync:       ${result.lastSync ? pc.green(result.lastSync) : pc.dim("never")}`,
    );
    consola.log(
      `  Pending upload:  ${result.pendingRecords > 0 ? pc.yellow(String(result.pendingRecords)) : pc.dim("0")} records`,
    );

    if (Object.keys(result.sources).length > 0) {
      consola.log("");
      consola.log(pc.bold("  Files by source:"));
      for (const [source, count] of Object.entries(result.sources)) {
        consola.log(`    ${pc.cyan(source.padEnd(14))} ${count}`);
      }
    }
    consola.log("");
  },
});

const loginCommand = defineCommand({
  meta: {
    name: "login",
    description: "Connect your CLI to the Pew dashboard via browser OAuth",
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
    version: "0.4.0",
    description: "Track token usage from your local AI coding tools",
  },
  subCommands: {
    sync: syncCommand,
    status: statusCommand,
    login: loginCommand,
  },
});
