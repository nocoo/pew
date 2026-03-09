import { access, mkdir, readFile, writeFile } from "node:fs/promises";
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

export interface WriteNotifyHandlerOptions {
  binDir: string;
  source: string;
  fs?: WriteNotifyHandlerFs;
  now?: () => string;
}

export function buildNotifyHandler(opts: BuildNotifyHandlerOptions): string {
  const { stateDir, pewBin } = opts;

  return `#!/usr/bin/env node
// PEW_NOTIFY_HANDLER — Auto-generated, do not edit
"use strict";

const { appendFileSync, readFileSync, mkdirSync, existsSync } = require("node:fs");
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
  mkdirSync(STATE_DIR, { recursive: true });
  appendFileSync(join(STATE_DIR, "notify.signal"), "\\n", "utf8");
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

export async function resolvePewBin(): Promise<string> {
  const fromArgv =
    typeof process.argv[1] === "string" ? join(dirname(process.argv[1]), "pew") : null;

  if (fromArgv && (await isExecutable(fromArgv))) {
    return fromArgv;
  }

  try {
    const result = await execFileAsync("which", ["pew"]);
    const candidate = result.stdout.trim();
    if (candidate && (await isExecutable(candidate))) {
      return candidate;
    }
  } catch {
    // Fall through to the final error.
  }

  throw new Error("Unable to resolve pew binary. Ensure `pew` is available in PATH.");
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
