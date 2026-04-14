import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { NotifierOperationResult, NotifierStatus } from "@pew/core";

interface ClaudeHookFs {
  readFile: (path: string, encoding: BufferEncoding) => Promise<string>;
  writeFile: (path: string, data: string, encoding: BufferEncoding) => Promise<unknown>;
  mkdir: (path: string, options: { recursive: boolean }) => Promise<unknown>;
}

export interface ClaudeHookOptions {
  settingsPath: string;
  notifyPath: string;
  fs?: ClaudeHookFs;
}

const EVENT_NAME = "SessionEnd";
const SOURCE = "claude-code";

export async function installClaudeHook(
  opts: ClaudeHookOptions,
): Promise<NotifierOperationResult> {
  const fs = opts.fs ?? { readFile, writeFile, mkdir };
  const command = buildClaudeHookCommand(opts.notifyPath);
  const loaded = await loadSettings(opts.settingsPath, fs);
  if (loaded.status === "invalid") {
    return {
      source: SOURCE,
      action: "skip",
      changed: false,
      detail: "Invalid Claude settings.json",
    };
  }

  const settings = loaded.settings ?? {};
  const hooks = normalizeObject(settings.hooks);
  const entries = normalizeArray(hooks[EVENT_NAME]);

  let changed = false;
  const nextEntries = entries.map((entry) => {
    const normalized = normalizeEntry(entry, command);
    if (normalized !== entry) changed = true;
    return normalized;
  });

  if (!hasCommand(nextEntries, command)) {
    nextEntries.push({
      hooks: [{ type: "command", command }],
    });
    changed = true;
  }

  if (!changed) {
    return {
      source: SOURCE,
      action: "install",
      changed: false,
      detail: "Claude hook already installed",
    };
  }

  const nextSettings = {
    ...settings,
    hooks: {
      ...hooks,
      [EVENT_NAME]: nextEntries,
    },
  };

  const backupPath = await writeSettings(opts.settingsPath, nextSettings, loaded.raw, fs);
  return {
    source: SOURCE,
    action: "install",
    changed: true,
    detail: "Claude hook installed",
    backupPath: backupPath ?? undefined,
  };
}

export async function uninstallClaudeHook(
  opts: ClaudeHookOptions,
): Promise<NotifierOperationResult> {
  const fs = opts.fs ?? { readFile, writeFile, mkdir };
  const command = buildClaudeHookCommand(opts.notifyPath);
  const loaded = await loadSettings(opts.settingsPath, fs);

  if (loaded.status === "missing") {
    return {
      source: SOURCE,
      action: "skip",
      changed: false,
      detail: "Claude settings.json not found",
    };
  }
  if (loaded.status === "invalid" || !loaded.settings) {
    return {
      source: SOURCE,
      action: "skip",
      changed: false,
      detail: "Invalid Claude settings.json",
    };
  }

  const settings = loaded.settings;
  const hooks = normalizeObject(settings.hooks);
  const entries = normalizeArray(hooks[EVENT_NAME]);
  let removed = false;
  const nextEntries = entries
    .map((entry) => {
      const stripped = stripCommand(entry, command);
      if (stripped !== entry) removed = true;
      return stripped;
    })
    .filter(Boolean);

  if (!removed) {
    return {
      source: SOURCE,
      action: "skip",
      changed: false,
      detail: "Claude hook not installed",
    };
  }

  const nextHooks = { ...hooks };
  if (nextEntries.length > 0) nextHooks[EVENT_NAME] = nextEntries;
  else delete nextHooks[EVENT_NAME];

  const nextSettings = { ...settings };
  if (Object.keys(nextHooks).length > 0) nextSettings.hooks = nextHooks;
  else delete nextSettings.hooks;

  const backupPath = await writeSettings(opts.settingsPath, nextSettings, loaded.raw, fs);
  return {
    source: SOURCE,
    action: "uninstall",
    changed: true,
    detail: "Claude hook removed",
    backupPath: backupPath ?? undefined,
  };
}

export async function getClaudeHookStatus(opts: ClaudeHookOptions): Promise<NotifierStatus> {
  const fs = opts.fs ?? { readFile, writeFile, mkdir };
  const loaded = await loadSettings(opts.settingsPath, fs);
  if (loaded.status === "missing") return "not-installed";
  if (loaded.status === "invalid" || !loaded.settings) return "error";
  return hasCommand(
    normalizeArray(normalizeObject(loaded.settings.hooks)[EVENT_NAME]),
    buildClaudeHookCommand(opts.notifyPath),
  )
    ? "installed"
    : "not-installed";
}

function buildClaudeHookCommand(notifyPath: string): string {
  if (/[`${}\\]/.test(notifyPath)) {
    throw new Error("Notify path contains unsafe characters");
  }
  return `/usr/bin/env node ${shellEscape(notifyPath)} --source=${SOURCE}`;
}

async function loadSettings(
  settingsPath: string,
  fs: ClaudeHookFs,
): Promise<
  | { status: "missing"; settings: null; raw: null }
  | { status: "invalid"; settings: null; raw: string | null }
  | { status: "ok"; settings: Record<string, unknown>; raw: string | null }
> {
  try {
    const raw = await fs.readFile(settingsPath, "utf8");
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { status: "invalid", settings: null, raw };
      }
      return { status: "ok", settings: parsed as Record<string, unknown>, raw };
    } catch {
      return { status: "invalid", settings: null, raw };
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return { status: "missing", settings: null, raw: null };
    }
    throw err;
  }
}

function normalizeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function normalizeArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object"))
    : [];
}

function normalizeEntry(entry: Record<string, unknown>, command: string): Record<string, unknown> {
  const hooks = Array.isArray(entry.hooks) ? entry.hooks : null;
  if (!hooks) return entry;

  let changed = false;
  const nextHooks = hooks.map((hook) => {
    if (!hook || typeof hook !== "object") return hook;
    const hookObject = hook as Record<string, unknown>;
    if (!commandMatches(hookObject.command, command)) return hookObject;
    if (hookObject.type === "command") return hookObject;
    changed = true;
    return { ...hookObject, type: "command" };
  });

  return changed ? { ...entry, hooks: nextHooks } : entry;
}

function stripCommand(
  entry: Record<string, unknown>,
  command: string,
): Record<string, unknown> | null {
  const hooks = Array.isArray(entry.hooks) ? entry.hooks : null;
  if (!hooks) return entry;

  const nextHooks = hooks.filter((hook) => {
    if (!hook || typeof hook !== "object") return true;
    return !commandMatches((hook as Record<string, unknown>).command, command);
  });

  if (nextHooks.length === hooks.length) return entry;
  if (nextHooks.length === 0) return null;
  return { ...entry, hooks: nextHooks };
}

function hasCommand(entries: Record<string, unknown>[], command: string): boolean {
  return entries.some((entry) => {
    const hooks = Array.isArray(entry.hooks) ? entry.hooks : [];
    return hooks.some((hook) => {
      if (!hook || typeof hook !== "object") return false;
      return commandMatches((hook as Record<string, unknown>).command, command);
    });
  });
}

function commandMatches(value: unknown, command: string): boolean {
  return value === command;
}

async function writeSettings(
  settingsPath: string,
  settings: Record<string, unknown>,
  previousRaw: string | null,
  fs: ClaudeHookFs,
): Promise<string | null> {
  const backupPath =
    previousRaw !== null
      ? `${settingsPath}.bak.${new Date().toISOString().replace(/[:.]/g, "-")}`
      : null;

  await fs.mkdir(new URL(".", `file://${settingsPath}`).pathname, { recursive: true }).catch(
    async () => {
      const lastSlash = settingsPath.lastIndexOf("/");
      const dir = lastSlash >= 0 ? settingsPath.slice(0, lastSlash) : ".";
      await fs.mkdir(dir, { recursive: true });
    },
  );

  if (backupPath && previousRaw !== null) {
    await fs.writeFile(backupPath, previousRaw, "utf8");
  }

  await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return backupPath;
}

/**
 * POSIX single-quote escaping: wraps in single quotes and escapes
 * embedded single quotes as '\'' to prevent ALL shell expansion
 * (including $(...) command substitution).
 */
function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
