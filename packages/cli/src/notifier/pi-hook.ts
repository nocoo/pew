/**
 * Pi notification hook.
 *
 * Pi supports extensions via ~/.pi/agent/extensions/*.ts files.
 * We install a simple extension that fires `pew notify --source=pi`
 * on `session_shutdown` events.
 *
 * Unlike Claude/Gemini (which modify settings.json), pi hooks are
 * standalone TypeScript files — install = write file, uninstall = delete file.
 */

import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { NotifierOperationResult, NotifierStatus } from "@pew/core";

interface PiHookFs {
  readFile: (path: string, encoding: BufferEncoding) => Promise<string>;
  writeFile: (path: string, data: string, encoding: BufferEncoding) => Promise<unknown>;
  mkdir: (path: string, options: { recursive: boolean }) => Promise<unknown>;
  unlink: (path: string) => Promise<unknown>;
}

export interface PiHookOptions {
  /** Path to the pew extension file, e.g. ~/.pi/agent/extensions/pew-sync.ts */
  extensionPath: string;
  /** Path to notify.cjs handler */
  notifyPath: string;
  fs?: PiHookFs;
}

const SOURCE = "pi";
const MARKER = "PEW_PI_HOOK";

function buildExtensionContent(notifyPath: string): string {
  return `// ${MARKER} — managed by pew, do not edit
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { spawn } from "node:child_process";

export default function (pi: ExtensionAPI) {
  pi.on("session_shutdown", async () => {
    try {
      const child = spawn("node", [${JSON.stringify(notifyPath)}, "--source=pi"], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
    } catch {}
  });
}
`;
}

export async function installPiHook(
  opts: PiHookOptions,
): Promise<NotifierOperationResult> {
  const fs = opts.fs ?? { readFile, writeFile, mkdir, unlink };
  const content = buildExtensionContent(opts.notifyPath);

  // Check if already installed
  let existing: string | null = null;
  try {
    existing = await fs.readFile(opts.extensionPath, "utf8");
  } catch {
    // File doesn't exist — will install
  }

  if (existing && existing.includes(MARKER)) {
    // Already installed — check if content matches
    if (existing === content) {
      return {
        source: SOURCE,
        action: "install",
        changed: false,
        detail: "Pi hook already installed",
      };
    }
    // Update to latest version
  }

  await fs.mkdir(dirname(opts.extensionPath), { recursive: true });
  await fs.writeFile(opts.extensionPath, content, "utf8");

  return {
    source: SOURCE,
    action: "install",
    changed: true,
    detail: "Pi hook installed",
  };
}

export async function uninstallPiHook(
  opts: PiHookOptions,
): Promise<NotifierOperationResult> {
  const fs = opts.fs ?? { readFile, writeFile, mkdir, unlink };

  let existing: string;
  try {
    existing = await fs.readFile(opts.extensionPath, "utf8");
  } catch {
    return {
      source: SOURCE,
      action: "skip",
      changed: false,
      detail: "Pi hook not found",
    };
  }

  if (!existing.includes(MARKER)) {
    return {
      source: SOURCE,
      action: "skip",
      changed: false,
      detail: "Pi hook not managed by pew",
    };
  }

  try {
    await fs.unlink(opts.extensionPath);
  } catch {
    // Ignore removal errors
  }

  return {
    source: SOURCE,
    action: "uninstall",
    changed: true,
    detail: "Pi hook removed",
  };
}

export async function getPiHookStatus(
  opts: PiHookOptions,
): Promise<NotifierStatus> {
  const fs = opts.fs ?? { readFile, writeFile, mkdir, unlink };

  try {
    const content = await fs.readFile(opts.extensionPath, "utf8");
    if (content.includes(MARKER)) return "installed";
    return "not-installed";
  } catch {
    return "not-installed";
  }
}
