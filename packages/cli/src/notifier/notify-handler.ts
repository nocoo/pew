import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface BuildNotifyHandlerOptions {
  stateDir: string;
  pewBin: string;
}

interface WriteNotifyHandlerFs {
  readFile: (path: string, encoding: BufferEncoding) => Promise<string>;
  writeFile: (path: string, data: string, encoding: BufferEncoding) => Promise<unknown>;
  mkdir: (path: string, options: { recursive: boolean }) => Promise<unknown>;
}

interface RemoveNotifyHandlerFs {
  readFile: (path: string, encoding: BufferEncoding) => Promise<string>;
  unlink: (path: string) => Promise<unknown>;
}

export interface WriteNotifyHandlerOptions {
  binDir: string;
  source: string;
  fs?: WriteNotifyHandlerFs;
  now?: () => string;
}

export interface RemoveNotifyHandlerOptions {
  notifyPath: string;
  fs?: RemoveNotifyHandlerFs;
}

export const NOTIFY_HANDLER_MARKER = "PEW_NOTIFY_HANDLER";

export function buildNotifyHandler(opts: BuildNotifyHandlerOptions): string {
  const { stateDir, pewBin } = opts;

  return `#!/usr/bin/env node
// ${NOTIFY_HANDLER_MARKER} — Auto-generated, do not edit
"use strict";

const { appendFileSync, readFileSync, mkdirSync, existsSync, chmodSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { spawn } = require("node:child_process");
const { homedir } = require("node:os");

const STATE_DIR = ${JSON.stringify(stateDir)};
const PEW_BIN = ${JSON.stringify(pewBin)};
const SELF_PATH = resolve(__filename);
const HOME_DIR = homedir();

const rawArgs = process.argv.slice(2);
let source = "";
const payloadArgs = [];
for (let i = 0; i < rawArgs.length; i++) {
  const arg = rawArgs[i];
  if (arg === "--source") {
    source = rawArgs[i + 1] || source;
    i += 1;
    continue;
  }
  if (arg.startsWith("--source=")) {
    source = arg.slice("--source=".length) || source;
    continue;
  }
  payloadArgs.push(arg);
}

try {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  const signalPath = join(STATE_DIR, "notify.signal");
  appendFileSync(signalPath, "\\n", "utf8");
  chmodSync(signalPath, 0o600);
} catch (_) {}

const bin = existsSync(PEW_BIN) ? PEW_BIN : "npx";
const args = bin === PEW_BIN
  ? ["notify", "--source=" + source, ...payloadArgs]
  : ["@nocoo/pew", "notify", "--source=" + source, ...payloadArgs];

try {
  const child = spawn(bin, args, {
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
  });
  child.unref();
} catch (_) {}

if (source === "codex") {
  try {
    const original = JSON.parse(
      readFileSync(join(STATE_DIR, "codex_notify_original.json"), "utf8"),
    );
    const cmd = Array.isArray(original && original.notify) ? original.notify : null;
    if (cmd && cmd.length > 0 && !isSelfNotify(cmd)) {
      const child = spawn(cmd[0], cmd.slice(1), {
        detached: true,
        stdio: "ignore",
        env: { ...process.env },
      });
      child.unref();
    }
  } catch (_) {}
}

process.exit(0);

function isSelfNotify(cmd) {
  return cmd.some((part) => {
    if (typeof part !== "string") return false;
    if (!part.includes("notify.cjs")) return false;
    const resolved = part.startsWith("~/")
      ? join(HOME_DIR, part.slice(2))
      : resolve(part);
    return resolved === SELF_PATH;
  });
}
`;
}

export async function writeNotifyHandler(
  opts: WriteNotifyHandlerOptions,
): Promise<{ changed: boolean; path: string; backupPath?: string }> {
  const fs = opts.fs ?? { readFile, writeFile, mkdir };
  const now = opts.now ?? (() => new Date().toISOString());
  const notifyPath = join(opts.binDir, "notify.cjs");

  await fs.mkdir(opts.binDir, { recursive: true });

  let existing: string | null = null;
  try {
    existing = await fs.readFile(notifyPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") throw err;
  }

  if (existing === opts.source) {
    return { changed: false, path: notifyPath };
  }

  let backupPath: string | undefined;
  if (existing !== null) {
    backupPath = `${notifyPath}.bak.${now().replace(/[:.]/g, "-")}`;
    await fs.writeFile(backupPath, existing, "utf8");
  }

  await fs.writeFile(notifyPath, opts.source, "utf8");
  return { changed: true, path: notifyPath, backupPath };
}

export async function removeNotifyHandler(
  opts: RemoveNotifyHandlerOptions,
): Promise<{ changed: boolean; path: string; detail: string; warnings?: string[] }> {
  const fs = opts.fs ?? { readFile, unlink };
  let existing: string;

  try {
    existing = await fs.readFile(opts.notifyPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return {
        changed: false,
        path: opts.notifyPath,
        detail: "notify.cjs not found",
      };
    }
    throw err;
  }

  if (!existing.includes(NOTIFY_HANDLER_MARKER)) {
    return {
      changed: false,
      path: opts.notifyPath,
      detail: "notify.cjs did not match pew marker",
      warnings: ["File does not contain pew marker"],
    };
  }

  await fs.unlink(opts.notifyPath);
  return {
    changed: true,
    path: opts.notifyPath,
    detail: "notify.cjs removed",
  };
}

export interface ResolvePewBinDeps {
  platform?: NodeJS.Platform;
  execFile?: typeof execFileAsync;
}

export async function resolvePewBin(deps?: ResolvePewBinDeps): Promise<string> {
  const platform = deps?.platform ?? process.platform;
  const isWin = platform === "win32";
  const exec = deps?.execFile ?? execFileAsync;

  // Step 1: Check sibling binary next to argv[1].
  // On Windows, npm installs pew.cmd (shim), so check both pew and pew.cmd.
  if (typeof process.argv[1] === "string") {
    const dir = dirname(process.argv[1]);
    const candidates = isWin ? [join(dir, "pew"), join(dir, "pew.cmd")] : [join(dir, "pew")];
    for (const candidate of candidates) {
      if (await fileExists(candidate, isWin)) {
        return candidate;
      }
    }
  }

  // Step 2: Look up via PATH — `where.exe` on Windows, `which` everywhere else.
  try {
    const [cmd, args] = isWin ? ["where.exe", ["pew"]] : ["which", ["pew"]];
    const result = await exec(cmd, args);
    // where.exe may return multiple lines; take the first.
    const candidate = result.stdout.trim().split(/\r?\n/)[0]?.trim();
    if (candidate && (await fileExists(candidate, isWin))) {
      return candidate;
    }
  } catch {
    // Fall through to the final error.
  }

  throw new Error("Unable to resolve pew binary. Ensure `pew` is available in PATH.");
}

/**
 * Check whether a file exists and is usable as a binary.
 * On Windows, X_OK is meaningless (NTFS has no Unix execute bit), so we
 * check R_OK (file exists and is readable) instead.
 */
async function fileExists(filePath: string, isWin: boolean): Promise<boolean> {
  try {
    await access(filePath, isWin ? constants.R_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
