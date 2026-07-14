import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface BuildNotifyHandlerOptions {
  stateDir: string;
  pewBin: string;
  /**
   * Platform to canonicalize `stateDir` for INSTANCE_ID. Windows is
   * case-insensitive at the filesystem level so we lowercase there;
   * POSIX stays as-is (§4.1). Defaults to `process.platform`.
   */
  platform?: NodeJS.Platform;
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

const NOTIFY_HANDLER_MARKER = "PEW_NOTIFY_HANDLER";
const ADMISSION_WINDOW_MS = 2_000;
const CHAIN_MAX_LENGTH = 2_048;

/**
 * Compute the stable per-installation identity used by chain guard.
 * See docs/45 §4.1 for canonicalization rules.
 */
export function computeInstanceId(
  stateDir: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const resolved = resolve(stateDir);
  const canonical = platform === "win32" ? resolved.toLowerCase() : resolved;
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

export function buildNotifyHandler(opts: BuildNotifyHandlerOptions): string {
  const { stateDir, pewBin } = opts;
  const platform = opts.platform ?? process.platform;
  const instanceId = computeInstanceId(stateDir, platform);

  return `#!/usr/bin/env node
// ${NOTIFY_HANDLER_MARKER} — Auto-generated, do not edit
// See docs/45-codex-notifier-cycle-containment.md.
"use strict";

const { appendFileSync, readFileSync, mkdirSync, writeFileSync, unlinkSync, existsSync, readdirSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { spawn } = require("node:child_process");
const { homedir } = require("node:os");

const STATE_DIR = ${JSON.stringify(stateDir)};
const PEW_BIN = ${JSON.stringify(pewBin)};
const INSTANCE_ID = ${JSON.stringify(instanceId)};
const ADMISSION_WINDOW_MS = ${ADMISSION_WINDOW_MS};
const CHAIN_MAX_LENGTH = ${CHAIN_MAX_LENGTH};
const SELF_PATH = resolve(__filename);
const HOME_DIR = homedir();
const IS_WIN = process.platform === "win32";
const SELF_PATH_KEY = IS_WIN ? SELF_PATH.toLowerCase() : SELF_PATH;
const ADMISSION_DIR = join(STATE_DIR, "notify-admission");
const DIAGNOSTIC_PATH = join(STATE_DIR, "last-notify-guard.json");

// Injectable clock — production is Date.now(); tests set globalThis.__pewNow
// to a fixed / two-step function via vm.Context. Both callers ultimately
// exercise the same code paths.
const now = () => (typeof globalThis.__pewNow === "function" ? globalThis.__pewNow() : Date.now());

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
  if (typeof arg === "string" && arg.startsWith("--source=")) {
    source = arg.slice("--source=".length) || source;
    continue;
  }
  payloadArgs.push(arg);
}

// -----------------------------------------------------------------------
// §4.1 chain guard — inspect PEW_NOTIFY_CHAIN before any spawn.
// -----------------------------------------------------------------------
const chainRaw = typeof process.env.PEW_NOTIFY_CHAIN === "string" ? process.env.PEW_NOTIFY_CHAIN : "";
if (chainRaw.length > CHAIN_MAX_LENGTH) {
  writeDiagnostic({ reason: "chain_too_long", chainLen: chainRaw.length });
  process.exit(0);
}
const chainIds = chainRaw ? chainRaw.split(",").filter(Boolean) : [];
if (chainIds.includes(INSTANCE_ID)) {
  writeDiagnostic({ reason: "chain_reentry", chainLen: chainRaw.length });
  process.exit(0);
}

// -----------------------------------------------------------------------
// §4.3 handler ordering:
//   append notify.signal → sample now → compute bucket →
//   sync-gate wx → post-create expiry check → forward-gate wx (Codex).
// -----------------------------------------------------------------------
try {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  appendFileSync(join(STATE_DIR, "notify.signal"), "\\n", "utf8");
} catch (_) {}

const t0 = now();
const bucket = Math.floor(t0 / ADMISSION_WINDOW_MS);
const notBefore = (bucket + 1) * ADMISSION_WINDOW_MS;

try {
  mkdirSync(ADMISSION_DIR, { recursive: true, mode: 0o700 });
} catch (_) {}

// -----------------------------------------------------------------------
// sync gate — shared across sources.
// -----------------------------------------------------------------------
const syncGate = join(ADMISSION_DIR, "sync-" + bucket + ".lock");
const syncOwnership = tryAcquire(syncGate);
if (syncOwnership === "owner") {
  spawnPewWorker();
}

// -----------------------------------------------------------------------
// forward gate — Codex only. Compete independently of sync gate outcome.
// -----------------------------------------------------------------------
if (source === "codex") {
  const forwardGate = join(ADMISSION_DIR, "forward-codex-" + bucket + ".lock");
  const forwardOwnership = tryAcquire(forwardGate);
  if (forwardOwnership === "owner") {
    forwardSavedOriginal();
  }
}

process.exit(0);

// =======================================================================
// Helpers
// =======================================================================

/**
 * Attempt exclusive-create of a bucket gate. Returns:
 *   "owner"  → this handler owns the gate (post-expiry check passed)
 *   "loser"  → gate already existed or bucket has advanced
 *   "error"  → any other errno; diagnostic already written
 */
function tryAcquire(gatePath) {
  try {
    writeFileSync(gatePath, "", { flag: "wx" });
  } catch (err) {
    const code = err && err.code;
    if (code === "EEXIST") return "loser";
    writeDiagnostic({
      reason: "gate_error",
      gate: gatePath,
      errno: code || "unknown",
    });
    return "error";
  }
  // §4.3 post-create expiry check: re-sample the clock. If bucket has
  // advanced, the gate file we just created might occupy a slot that was
  // already claimed and cleaned up. Do not spawn for the stale bucket.
  const t1 = now();
  if (Math.floor(t1 / ADMISSION_WINDOW_MS) !== bucket) {
    writeDiagnostic({
      reason: "gate_expired",
      gate: gatePath,
      sampled: t0,
      recheck: t1,
    });
    return "loser";
  }
  return "owner";
}

function spawnPewWorker() {
  const bin = existsSync(PEW_BIN) ? PEW_BIN : "npx";
  const args = bin === PEW_BIN
    ? ["notify", "--source=" + source, "--not-before=" + notBefore, ...payloadArgs]
    : ["@nocoo/pew", "notify", "--source=" + source, "--not-before=" + notBefore, ...payloadArgs];
  const nextChain = chainIds.concat(INSTANCE_ID).join(",");
  try {
    const child = spawn(bin, args, {
      detached: true,
      stdio: "ignore",
      env: Object.assign({}, process.env, { PEW_NOTIFY_CHAIN: nextChain }),
    });
    if (child && typeof child.unref === "function") child.unref();
  } catch (err) {
    writeDiagnostic({
      reason: "pew_worker_spawn_error",
      errno: (err && err.code) || "unknown",
      message: (err && err.message) || String(err),
    });
  }
}

function forwardSavedOriginal() {
  let cmd = null;
  try {
    const original = JSON.parse(
      readFileSync(join(STATE_DIR, "codex_notify_original.json"), "utf8"),
    );
    cmd = Array.isArray(original && original.notify) ? original.notify : null;
  } catch (err) {
    // Backup missing or malformed: forward slot consumed but zero spawn.
    // This is the §4.5 fail-closed for the forward gate.
    writeDiagnostic({
      reason: "backup_unreadable",
      errno: (err && err.code) || "unknown",
    });
    return;
  }
  if (!cmd || cmd.length === 0) return;
  if (isSelfNotify(cmd)) return;
  const nextChain = chainIds.concat(INSTANCE_ID).join(",");
  try {
    const child = spawn(cmd[0], cmd.slice(1), {
      detached: true,
      stdio: "ignore",
      env: Object.assign({}, process.env, { PEW_NOTIFY_CHAIN: nextChain }),
    });
    if (child && typeof child.unref === "function") child.unref();
  } catch (err) {
    writeDiagnostic({
      reason: "forward_spawn_error",
      errno: (err && err.code) || "unknown",
      message: (err && err.message) || String(err),
    });
  }
}

function isSelfNotify(cmd) {
  return cmd.some((part) => {
    if (typeof part !== "string") return false;
    if (!part.includes("notify.cjs")) return false;
    const resolved = part.startsWith("~/")
      ? join(HOME_DIR, part.slice(2))
      : resolve(part);
    // Windows: NTFS/ReFS are case-insensitive by default, so compare
    // lowercased forms; POSIX stays case-sensitive.
    const key = IS_WIN ? resolved.toLowerCase() : resolved;
    return key === SELF_PATH_KEY;
  });
}

/**
 * Overwrite-only diagnostic. §5.1: writing may itself fail with the same
 * underlying errno as gate creation; we swallow that and never re-raise —
 * the spawn decision has already been made.
 */
function writeDiagnostic(payload) {
  try {
    mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
    // Sample the clock locally; do NOT reference the outer \`t0\` because
    // early-exit branches (chain_reentry, chain_too_long) fire before
    // t0 is assigned, and touching a TDZ binding would throw
    // ReferenceError — the outer try/catch swallows it and no diagnostic
    // is written. See doc 45 §4.1 review item 3.
    var stamp;
    try {
      stamp = typeof globalThis.__pewNow === "function"
        ? new Date(globalThis.__pewNow()).toISOString()
        : new Date().toISOString();
    } catch (_) {
      stamp = new Date().toISOString();
    }
    writeFileSync(
      DIAGNOSTIC_PATH,
      JSON.stringify({
        at: stamp,
        instanceId: INSTANCE_ID,
        ...payload,
      }, null, 2),
    );
  } catch (_) {}
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
