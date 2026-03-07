import { defineCommand } from "citty";
import { consola } from "consola";
import pc from "picocolors";
import { resolveDefaultPaths } from "./utils/paths.js";
import { executeSync } from "./commands/sync.js";
import { executeStatus } from "./commands/status.js";
import { executeLogin } from "./commands/login.js";
import { executeUpload } from "./commands/upload.js";

const initCommand = defineCommand({
  meta: {
    name: "init",
    description: "Set up Zebra hooks for your AI coding tools",
  },
  async run() {
    // TODO: Phase 2.8 — install hooks for Claude Code, Gemini CLI, OpenCode, OpenClaw
    consola.info("zebra init — not yet implemented");
  },
});

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
    api: {
      type: "string",
      description: "Override the Zebra API URL",
      default: "https://zebra.nocoo.dev",
    },
  },
  async run({ args }) {
    const paths = resolveDefaultPaths();
    consola.start("Syncing token usage from AI coding tools...\n");

    const result = await executeSync({
      stateDir: paths.stateDir,
      claudeDir: paths.claudeDir,
      geminiDir: paths.geminiDir,
      openCodeMessageDir: paths.openCodeMessageDir,
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

    // Summary
    consola.log("");
    if (result.totalDeltas === 0) {
      consola.info("No new token usage found.");
    } else {
      consola.success(
        `Synced ${pc.bold(String(result.totalDeltas))} events → ${pc.bold(String(result.totalRecords))} queue records`,
      );
      const parts: string[] = [];
      if (result.sources.claude > 0) parts.push(`Claude: ${result.sources.claude}`);
      if (result.sources.gemini > 0) parts.push(`Gemini: ${result.sources.gemini}`);
      if (result.sources.opencode > 0) parts.push(`OpenCode: ${result.sources.opencode}`);
      if (result.sources.openclaw > 0) parts.push(`OpenClaw: ${result.sources.openclaw}`);
      if (parts.length > 0) {
        consola.info(`  ${pc.dim(parts.join("  |  "))}`);
      }
    }

    // Auto-upload if logged in
    if (args.upload) {
      await runUpload(paths.stateDir, args.api);
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
    consola.log(pc.bold("Zebra Status"));
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
    description: "Connect your CLI to the Zebra dashboard via browser OAuth",
  },
  args: {
    force: {
      type: "boolean",
      description: "Force re-login even if already authenticated",
      default: false,
    },
    api: {
      type: "string",
      description: "Override the Zebra API URL",
      default: "https://zebra.nocoo.dev",
    },
  },
  async run({ args }) {
    const paths = resolveDefaultPaths();
    const { exec } = await import("node:child_process");

    consola.start("Opening browser for authentication...\n");

    const result = await executeLogin({
      configDir: paths.stateDir,
      apiUrl: args.api,
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
        `Already logged in. Use ${pc.cyan("zebra login --force")} to re-authenticate.`,
      );
      return;
    }

    if (result.success) {
      consola.success(
        `Logged in as ${pc.bold(result.email ?? "unknown")}`,
      );
      consola.info(
        `Token saved to ${pc.dim(paths.stateDir + "/config.json")}`,
      );
    } else {
      consola.error(`Login failed: ${result.error}`);
      process.exitCode = 1;
    }
  },
});

// ---------------------------------------------------------------------------
// Shared upload helper (used by both `sync --upload` and standalone `upload`)
// ---------------------------------------------------------------------------

async function runUpload(stateDir: string, apiUrl: string): Promise<void> {
  consola.log("");
  consola.start("Uploading to dashboard...");

  const uploadResult = await executeUpload({
    stateDir,
    apiUrl,
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
      `Not logged in — skipping upload. Run ${pc.cyan("zebra login")} to enable.`,
    );
    return;
  }

  if (uploadResult.success) {
    if (uploadResult.uploaded === 0) {
      consola.info("No pending records to upload.");
    } else {
      consola.success(
        `Uploaded ${pc.bold(String(uploadResult.uploaded))} records in ${uploadResult.batches} batch(es).`,
      );
    }
  } else {
    consola.error(`Upload failed: ${uploadResult.error}`);
    if (uploadResult.uploaded > 0) {
      consola.info(
        `  ${pc.yellow(String(uploadResult.uploaded))} records uploaded before failure.`,
      );
    }
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// Upload command (standalone)
// ---------------------------------------------------------------------------

const uploadCommand = defineCommand({
  meta: {
    name: "upload",
    description: "Upload pending queue records to the Zebra dashboard",
  },
  args: {
    api: {
      type: "string",
      description: "Override the Zebra API URL",
      default: "https://zebra.nocoo.dev",
    },
  },
  async run({ args }) {
    const paths = resolveDefaultPaths();
    await runUpload(paths.stateDir, args.api);
  },
});

export const main = defineCommand({
  meta: {
    name: "zebra",
    version: "0.1.0",
    description: "Track token usage from your local AI coding tools",
  },
  subCommands: {
    init: initCommand,
    sync: syncCommand,
    upload: uploadCommand,
    status: statusCommand,
    login: loginCommand,
  },
});
