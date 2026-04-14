import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { NotifierOperationResult, NotifierStatus } from "@pew/core";

interface GeminiHookFs {
  readFile: (path: string, encoding: BufferEncoding) => Promise<string>;
  writeFile: (path: string, data: string, encoding: BufferEncoding) => Promise<unknown>;
  mkdir: (path: string, options: { recursive: boolean }) => Promise<unknown>;
}

export interface GeminiHookOptions {
  settingsPath: string;
  notifyPath: string;
  fs?: GeminiHookFs;
}

const EVENT_NAME = "SessionEnd";
const SOURCE = "gemini-cli";
const HOOK_NAME = "pew-tracker";
const MATCHER = "exit|clear|logout|prompt_input_exit|other";

export async function installGeminiHook(
  opts: GeminiHookOptions,
): Promise<NotifierOperationResult> {
  const fs = opts.fs ?? { readFile, writeFile, mkdir };
  const command = buildGeminiHookCommand(opts.notifyPath);
  const loaded = await loadSettings(opts.settingsPath, fs);
  if (loaded.status === "invalid") {
    return {
      source: SOURCE,
      action: "skip",
      changed: false,
      detail: "Invalid Gemini settings.json",
    };
  }

  const settings = loaded.settings ?? {};
  const tools = normalizeObject(settings.tools);
  const hooks = normalizeObject(settings.hooks);
  const entries = normalizeArray(hooks[EVENT_NAME]);
  let changed = tools.enableHooks !== true;

  const nextEntries = entries.map((entry) => {
    const normalized = normalizeEntry(entry, command);
    if (normalized !== entry) changed = true;
    return normalized;
  });

  if (!hasHook(nextEntries, command)) {
    nextEntries.push({
      matcher: MATCHER,
      hooks: [{ name: HOOK_NAME, type: "command", command }],
    });
    changed = true;
  }

  if (!changed) {
    return {
      source: SOURCE,
      action: "install",
      changed: false,
      detail: "Gemini hook already installed",
    };
  }

  const nextSettings = {
    ...settings,
    tools: {
      ...tools,
      enableHooks: true,
    },
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
    detail: "Gemini hook installed",
    backupPath: backupPath ?? undefined,
  };
}

export async function uninstallGeminiHook(
  opts: GeminiHookOptions,
): Promise<NotifierOperationResult> {
  const fs = opts.fs ?? { readFile, writeFile, mkdir };
  const command = buildGeminiHookCommand(opts.notifyPath);
  const loaded = await loadSettings(opts.settingsPath, fs);
  if (loaded.status === "missing") {
    return {
      source: SOURCE,
      action: "skip",
      changed: false,
      detail: "Gemini settings.json not found",
    };
  }
  if (loaded.status === "invalid" || !loaded.settings) {
    return {
      source: SOURCE,
      action: "skip",
      changed: false,
      detail: "Invalid Gemini settings.json",
    };
  }

  const settings = loaded.settings;
  const hooks = normalizeObject(settings.hooks);
  const entries = normalizeArray(hooks[EVENT_NAME]);
  let removed = false;
  const nextEntries = entries
    .map((entry) => {
      const stripped = stripHook(entry, command);
      if (stripped !== entry) removed = true;
      return stripped;
    })
    .filter(Boolean);

  if (!removed) {
    return {
      source: SOURCE,
      action: "skip",
      changed: false,
      detail: "Gemini hook not installed",
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
    detail: "Gemini hook removed",
    backupPath: backupPath ?? undefined,
  };
}

export async function getGeminiHookStatus(opts: GeminiHookOptions): Promise<NotifierStatus> {
  const fs = opts.fs ?? { readFile, writeFile, mkdir };
  const loaded = await loadSettings(opts.settingsPath, fs);
  if (loaded.status === "missing") return "not-installed";
  if (loaded.status === "invalid" || !loaded.settings) return "error";
  return hasHook(
    normalizeArray(normalizeObject(loaded.settings.hooks)[EVENT_NAME]),
    buildGeminiHookCommand(opts.notifyPath),
  )
    ? "installed"
    : "not-installed";
}

function buildGeminiHookCommand(notifyPath: string): string {
  if (/[`${}\\]/.test(notifyPath)) {
    throw new Error("Notify path contains unsafe characters");
  }
  return `/usr/bin/env node ${shellEscape(notifyPath)} --source=${SOURCE}`;
}

async function loadSettings(
  settingsPath: string,
  fs: GeminiHookFs,
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

  let changed = entry.matcher !== MATCHER;
  const nextHooks = hooks.map((hook) => {
    if (!hook || typeof hook !== "object") return hook;
    const hookObject = hook as Record<string, unknown>;
    if (!matchesHook(hookObject, command)) return hookObject;

    const nextHook = { ...hookObject };
    if (nextHook.name !== HOOK_NAME) {
      nextHook.name = HOOK_NAME;
      changed = true;
    }
    if (nextHook.type !== "command") {
      nextHook.type = "command";
      changed = true;
    }
    if (nextHook.command !== command) {
      nextHook.command = command;
      changed = true;
    }
    return nextHook;
  });

  if (!changed) return entry;
  return { ...entry, matcher: MATCHER, hooks: nextHooks };
}

function stripHook(
  entry: Record<string, unknown>,
  command: string,
): Record<string, unknown> | null {
  const hooks = Array.isArray(entry.hooks) ? entry.hooks : null;
  if (!hooks) return entry;

  const nextHooks = hooks.filter((hook) => {
    if (!hook || typeof hook !== "object") return true;
    return !matchesHook(hook as Record<string, unknown>, command);
  });

  if (nextHooks.length === hooks.length) return entry;
  if (nextHooks.length === 0) return null;
  return { ...entry, hooks: nextHooks };
}

function hasHook(entries: Record<string, unknown>[], command: string): boolean {
  return entries.some((entry) => {
    const hooks = Array.isArray(entry.hooks) ? entry.hooks : [];
    return hooks.some((hook) => {
      if (!hook || typeof hook !== "object") return false;
      return matchesHook(hook as Record<string, unknown>, command);
    });
  });
}

function matchesHook(hook: Record<string, unknown>, command: string): boolean {
  return hook.command === command || hook.name === HOOK_NAME;
}

async function writeSettings(
  settingsPath: string,
  settings: Record<string, unknown>,
  previousRaw: string | null,
  fs: GeminiHookFs,
): Promise<string | null> {
  await fs.mkdir(dirname(settingsPath), { recursive: true });
  const backupPath =
    previousRaw !== null
      ? `${settingsPath}.bak.${new Date().toISOString().replace(/[:.]/g, "-")}`
      : null;

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
