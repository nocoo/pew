import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { NotifierOperationResult, NotifierStatus } from "@pew/core";

interface OpenCodePluginFs {
  readFile: (path: string, encoding: BufferEncoding) => Promise<string>;
  writeFile: (path: string, data: string, encoding: BufferEncoding) => Promise<unknown>;
  mkdir: (path: string, options: { recursive: boolean }) => Promise<unknown>;
  unlink: (path: string) => Promise<unknown>;
}

export interface OpenCodePluginOptions {
  pluginDir: string;
  notifyPath: string;
  pluginName?: string;
  fs?: OpenCodePluginFs;
}

const SOURCE = "opencode";
const DEFAULT_PLUGIN_NAME = "pew-tracker.js";
const PLUGIN_MARKER = "PEW_TRACKER_PLUGIN";

export async function installOpenCodePlugin(
  opts: OpenCodePluginOptions,
): Promise<NotifierOperationResult> {
  const fs = opts.fs ?? { readFile, writeFile, mkdir, unlink };
  const pluginName = opts.pluginName ?? DEFAULT_PLUGIN_NAME;
  const pluginPath = join(opts.pluginDir, pluginName);
  const nextSource = buildOpenCodePlugin({ notifyPath: opts.notifyPath });
  const existing = await readOptional(pluginPath, fs);

  if (existing === nextSource) {
    return {
      source: SOURCE,
      action: "install",
      changed: false,
      detail: "OpenCode plugin already installed",
    };
  }

  await fs.mkdir(opts.pluginDir, { recursive: true });

  let backupPath: string | undefined;
  if (existing !== null) {
    backupPath = `${pluginPath}.bak.${new Date().toISOString().replace(/[:.]/g, "-")}`;
    await fs.writeFile(backupPath, existing, "utf8");
  }

  await fs.writeFile(pluginPath, nextSource, "utf8");
  return {
    source: SOURCE,
    action: "install",
    changed: true,
    detail: "OpenCode plugin installed",
    backupPath,
  };
}

export async function uninstallOpenCodePlugin(
  opts: OpenCodePluginOptions,
): Promise<NotifierOperationResult> {
  const fs = opts.fs ?? { readFile, writeFile, mkdir, unlink };
  const pluginName = opts.pluginName ?? DEFAULT_PLUGIN_NAME;
  const pluginPath = join(opts.pluginDir, pluginName);
  const existing = await readOptional(pluginPath, fs);

  if (existing === null) {
    return {
      source: SOURCE,
      action: "skip",
      changed: false,
      detail: "OpenCode plugin not found",
    };
  }

  if (!existing.includes(PLUGIN_MARKER)) {
    return {
      source: SOURCE,
      action: "skip",
      changed: false,
      detail: "OpenCode plugin file did not match pew marker",
      warnings: ["File does not contain pew marker"],
    };
  }

  await fs.unlink(pluginPath);
  return {
    source: SOURCE,
    action: "uninstall",
    changed: true,
    detail: "OpenCode plugin removed",
  };
}

export async function getOpenCodePluginStatus(
  opts: OpenCodePluginOptions,
): Promise<NotifierStatus> {
  const fs = opts.fs ?? { readFile, writeFile, mkdir, unlink };
  const pluginName = opts.pluginName ?? DEFAULT_PLUGIN_NAME;
  let existing: string | null;
  try {
    existing = await readOptional(join(opts.pluginDir, pluginName), fs);
  } catch {
    return "error";
  }

  if (existing === null) return "not-installed";
  return existing.includes(PLUGIN_MARKER) ? "installed" : "error";
}

function buildOpenCodePlugin({ notifyPath }: { notifyPath: string }): string {
  if (/[`${}\\]/.test(notifyPath)) {
    throw new Error("Notify path contains unsafe characters");
  }
  const escapedPath = shellEscape(notifyPath);
  return `// ${PLUGIN_MARKER}
const notifyPath = ${JSON.stringify(notifyPath)};
export const PewTrackerPlugin = async ({ $ }) => {
  return {
    event: async ({ event }) => {
      if (!event || event.type !== "session.updated") return;
      try {
        if (!notifyPath) return;
        const proc = $\`/usr/bin/env node ${escapedPath} --source=opencode\`;
        if (proc && typeof proc.catch === "function") proc.catch(() => {});
      } catch (_) {}
    }
  };
};
`;
}

async function readOptional(
  filePath: string,
  fs: OpenCodePluginFs,
): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return null;
    throw err;
  }
}

/**
 * POSIX single-quote escaping: wraps in single quotes and escapes
 * embedded single quotes as '\'' to prevent ALL shell expansion
 * (including $(...) command substitution).
 */
function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
