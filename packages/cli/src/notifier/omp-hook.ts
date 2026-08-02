/**
 * Oh My Pi notification hook.
 *
 * omp is a pi fork and reuses pi's extension protocol: ~/.omp/agent/extensions
 * holds standalone TypeScript files exporting an `(pi: ExtensionAPI) => void`
 * factory. We install one that fires `pew notify --source=omp` on
 * `session_shutdown`.
 *
 * Install = write file, uninstall = delete file (no settings.json to merge).
 * The only difference from pi-hook is the type-import package
 * (`@oh-my-pi/pi-coding-agent`) and the `--source` tag.
 */

import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { NotifierOperationResult, NotifierStatus } from "@pew/core";

interface OmpHookFs {
  readFile: (path: string, encoding: BufferEncoding) => Promise<string>;
  writeFile: (path: string, data: string, encoding: BufferEncoding) => Promise<unknown>;
  mkdir: (path: string, options: { recursive: boolean }) => Promise<unknown>;
  unlink: (path: string) => Promise<unknown>;
}

export interface OmpHookOptions {
  /** Path to the pew extension file, e.g. ~/.omp/agent/extensions/pew-sync.ts */
  extensionPath: string;
  /** Path to notify.cjs handler */
  notifyPath: string;
  fs?: OmpHookFs;
}

const SOURCE = "omp";
const MARKER = "PEW_OMP_HOOK";

function buildExtensionContent(notifyPath: string): string {
  return `// ${MARKER} — managed by pew, do not edit
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { spawn } from "node:child_process";

export default function (pi: ExtensionAPI) {
  pi.on("session_shutdown", async () => {
    try {
      const child = spawn("node", [${JSON.stringify(notifyPath)}, "--source=omp"], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
    } catch {}
  });
}
`;
}

export async function installOmpHook(
  opts: OmpHookOptions,
): Promise<NotifierOperationResult> {
  const fs = opts.fs ?? { readFile, writeFile, mkdir, unlink };
  const content = buildExtensionContent(opts.notifyPath);

  let existing: string | null = null;
  try {
    existing = await fs.readFile(opts.extensionPath, "utf8");
  } catch {
    // File doesn't exist — will install
  }

  if (existing === content) {
    return {
      source: SOURCE,
      action: "install",
      changed: false,
      detail: "Oh My Pi hook already installed",
    };
  }

  await fs.mkdir(dirname(opts.extensionPath), { recursive: true });
  await fs.writeFile(opts.extensionPath, content, "utf8");

  return {
    source: SOURCE,
    action: "install",
    changed: true,
    detail: "Oh My Pi hook installed",
  };
}

export async function uninstallOmpHook(
  opts: OmpHookOptions,
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
      detail: "Oh My Pi hook not found",
    };
  }

  if (!existing.includes(MARKER)) {
    return {
      source: SOURCE,
      action: "skip",
      changed: false,
      detail: "Oh My Pi hook not managed by pew",
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
    detail: "Oh My Pi hook removed",
  };
}

export async function getOmpHookStatus(
  opts: OmpHookOptions,
): Promise<NotifierStatus> {
  const fs = opts.fs ?? { readFile, writeFile, mkdir, unlink };

  try {
    const content = await fs.readFile(opts.extensionPath, "utf8");
    return content.includes(MARKER) ? "installed" : "not-installed";
  } catch {
    return "not-installed";
  }
}
