import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { NotifierOperationResult, NotifierStatus } from "@pew/core";

interface OpenClawHookFs {
  readFile: (path: string, encoding: BufferEncoding) => Promise<string>;
  writeFile: (path: string, data: string, encoding: BufferEncoding) => Promise<unknown>;
  mkdir: (path: string, options: { recursive: boolean }) => Promise<unknown>;
  rm: (path: string, options: { recursive: boolean; force: boolean }) => Promise<unknown>;
}

interface SpawnResult {
  status: number | null;
}

export interface OpenClawHookOptions {
  pluginBaseDir: string;
  notifyPath: string;
  openclawConfigPath: string;
  fs?: OpenClawHookFs;
  spawn?: (cmd: string, args: string[], opts?: SpawnSyncOptions) => SpawnResult;
}

const SOURCE = "openclaw";
const PLUGIN_ID = "pew-session-sync";

export async function installOpenClawHook(
  opts: OpenClawHookOptions,
): Promise<NotifierOperationResult> {
  const fs = opts.fs ?? { readFile, writeFile, mkdir, rm };
  const spawn = opts.spawn ?? defaultSpawn;
  const pluginDir = join(opts.pluginBaseDir, PLUGIN_ID);

  await fs.mkdir(pluginDir, { recursive: true });
  await fs.writeFile(join(pluginDir, "package.json"), buildPackageJson(), "utf8");
  await fs.writeFile(join(pluginDir, "openclaw.plugin.json"), buildPluginMeta(), "utf8");
  await fs.writeFile(
    join(pluginDir, "index.js"),
    buildPluginIndex(opts.notifyPath, dirname(opts.pluginBaseDir)),
    "utf8",
  );

  try {
    const installResult = spawn(
      "openclaw",
      ["plugins", "install", "--link", "--dangerously-force-unsafe-install", pluginDir],
      { cwd: pluginDir },
    );
    const enableResult = spawn(
      "openclaw",
      ["plugins", "enable", PLUGIN_ID],
      { cwd: pluginDir },
    );

    const warnings: string[] = [];
    if ((installResult.status ?? 1) !== 0) warnings.push("openclaw plugin install failed");
    if ((enableResult.status ?? 1) !== 0) warnings.push("openclaw plugin enable failed");

    return {
      source: SOURCE,
      action: warnings.length > 0 ? "skip" : "install",
      changed: true,
      detail:
        warnings.length > 0
          ? "OpenClaw plugin installation needs attention"
          : "OpenClaw plugin installed",
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return {
        source: SOURCE,
        action: "skip",
        changed: false,
        detail: "OpenClaw CLI not found",
        warnings: ["openclaw CLI not found"],
      };
    }
    throw err;
  }
}

export async function uninstallOpenClawHook(
  opts: OpenClawHookOptions,
): Promise<NotifierOperationResult> {
  const fs = opts.fs ?? { readFile, writeFile, mkdir, rm };
  const pluginDir = join(opts.pluginBaseDir, PLUGIN_ID);
  const loaded = await loadConfig(opts.openclawConfigPath, fs);
  if (loaded.status === "missing") {
    await fs.rm(pluginDir, { recursive: true, force: true });
    return {
      source: SOURCE,
      action: "skip",
      changed: false,
      detail: "OpenClaw config not found",
    };
  }
  if (loaded.status === "invalid") {
    return {
      source: SOURCE,
      action: "skip",
      changed: false,
      detail: "Invalid OpenClaw config",
    };
  }

  const config = loaded.config;
  let changed = false;
  const plugins = normalizeObject(config.plugins);
  const entries = normalizeObject(plugins.entries);
  if (entries[PLUGIN_ID]) {
    delete entries[PLUGIN_ID];
    changed = true;
  }

  const load = normalizeObject(plugins.load);
  const paths = Array.isArray(load.paths) ? load.paths : [];
  const resolvedPluginDir = resolve(pluginDir);
  const nextPaths = paths.filter((entry) => resolve(String(entry)) !== resolvedPluginDir);
  if (nextPaths.length !== paths.length) {
    load.paths = nextPaths;
    changed = true;
  }

  const installs = normalizeObject(plugins.installs);
  for (const [key, value] of Object.entries(installs)) {
    const sourcePath = typeof (value as Record<string, unknown>).sourcePath === "string"
      ? resolve(String((value as Record<string, unknown>).sourcePath))
      : null;
    const installPath = typeof (value as Record<string, unknown>).installPath === "string"
      ? resolve(String((value as Record<string, unknown>).installPath))
      : null;
    if (key === PLUGIN_ID || sourcePath === resolvedPluginDir || installPath === resolvedPluginDir) {
      delete installs[key];
      changed = true;
    }
  }

  const nextPlugins: Record<string, unknown> = {};
  if (Object.keys(entries).length > 0) nextPlugins.entries = entries;
  if (Array.isArray(load.paths) && load.paths.length > 0) nextPlugins.load = load;
  if (Object.keys(installs).length > 0) nextPlugins.installs = installs;

  if (changed) {
    const nextConfig = { ...config };
    if (Object.keys(nextPlugins).length > 0) nextConfig.plugins = nextPlugins;
    else delete nextConfig.plugins;
    await fs.writeFile(opts.openclawConfigPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
  }

  await fs.rm(pluginDir, { recursive: true, force: true });
  return {
    source: SOURCE,
    action: "uninstall",
    changed,
    detail: changed ? "OpenClaw plugin removed" : "OpenClaw plugin not installed",
  };
}

export async function getOpenClawHookStatus(
  opts: OpenClawHookOptions,
): Promise<NotifierStatus> {
  const fs = opts.fs ?? { readFile, writeFile, mkdir, rm };
  const pluginDir = join(opts.pluginBaseDir, PLUGIN_ID);
  const loaded = await loadConfig(opts.openclawConfigPath, fs);
  if (loaded.status === "missing") return "not-installed";
  if (loaded.status === "invalid") return "error";

  const config = loaded.config;
  const plugins = normalizeObject(config.plugins);
  const entries = normalizeObject(plugins.entries);
  const load = normalizeObject(plugins.load);
  const installs = normalizeObject(plugins.installs);
  const paths = Array.isArray(load.paths) ? load.paths.map((entry) => resolve(String(entry))) : [];
  const resolvedPluginDir = resolve(pluginDir);

  const filesReady = await hasPluginFiles(pluginDir, fs);
  return Boolean(entries[PLUGIN_ID]) &&
    paths.includes(resolvedPluginDir) &&
    Boolean(installs[PLUGIN_ID]) &&
    filesReady
    ? "installed"
    : "not-installed";
}

async function loadConfig(
  configPath: string,
  fs: OpenClawHookFs,
): Promise<
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "ok"; config: Record<string, unknown> }
> {
  try {
    const raw = await fs.readFile(configPath, "utf8");
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? { status: "ok", config: parsed as Record<string, unknown> }
        : { status: "invalid" };
    } catch {
      return { status: "invalid" };
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return { status: "missing" };
    throw err;
  }
}

async function hasPluginFiles(pluginDir: string, fs: OpenClawHookFs): Promise<boolean> {
  const files = ["package.json", "openclaw.plugin.json", "index.js"];
  for (const file of files) {
    try {
      await fs.readFile(join(pluginDir, file), "utf8");
    } catch {
      return false;
    }
  }
  return true;
}

function buildPackageJson(): string {
  return `${JSON.stringify(
    {
      name: "@pew/openclaw-session-sync",
      version: "0.0.0",
      private: true,
      type: "module",
      openclaw: { extensions: ["./index.js"] },
    },
    null,
    2,
  )}\n`;
}

function buildPluginMeta(): string {
  return `${JSON.stringify(
    {
      id: PLUGIN_ID,
      name: "pew OpenClaw Session Sync",
      description: "Trigger pew sync on OpenClaw agent/session lifecycle events.",
      configSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    },
    null,
    2,
  )}\n`;
}

function buildPluginIndex(notifyPath: string, stateDir: string): string {
  return `import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const NOTIFY_PATH = ${JSON.stringify(notifyPath)};
const THROTTLE_STATE_PATH = ${JSON.stringify(join(stateDir, "openclaw.session-sync.trigger-state.json"))};
const SESSION_TRIGGER_THROTTLE_MS = 15_000;

export default function register(api) {
  api.on("agent_end", async () => {
    await triggerSync();
  });

  api.on("gateway_start", async () => {
    await triggerSync();
  });

  api.on("gateway_stop", async () => {
    await triggerSync();
  });
}

async function triggerSync() {
  try {
    if (await isThrottled()) return;
    const child = spawn("/usr/bin/env", ["node", NOTIFY_PATH, "--source=openclaw"], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env },
    });
    child.unref();
  } catch (_) {}
}

async function isThrottled() {
  const now = Date.now();
  let lastTriggeredAt = 0;

  try {
    const raw = await readFile(THROTTLE_STATE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.lastTriggeredAt === "number") {
      lastTriggeredAt = parsed.lastTriggeredAt;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") return false;
  }

  if (now - lastTriggeredAt < SESSION_TRIGGER_THROTTLE_MS) {
    return true;
  }

  try {
    await writeFile(
      THROTTLE_STATE_PATH,
      JSON.stringify({ lastTriggeredAt: now }) + "\\n",
      "utf8",
    );
  } catch (_) {}

  return false;
}
`;
}

function normalizeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function defaultSpawn(cmd: string, args: string[], opts?: SpawnSyncOptions): SpawnResult {
  const result = spawnSync(cmd, args, {
    timeout: 30_000,
    stdio: "ignore",
    ...opts,
  });
  if (result.error) throw result.error;
  return { status: result.status };
}
