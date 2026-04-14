import { mkdir } from "node:fs/promises";
import type { NotifierOperationResult, Source } from "@pew/core";
import {
  buildNotifyHandler,
  resolvePewBin,
  writeNotifyHandler,
} from "../notifier/notify-handler.js";
import { resolveNotifierPaths, type NotifierPaths } from "../notifier/paths.js";
import {
  getAllDrivers,
  getDriver,
  installAll,
} from "../notifier/registry.js";
import { SECURE_DIR_MODE, ensureSecureDir } from "../storage/secure-mkdir.js";

export interface InitOptions {
  stateDir: string;
  home: string;
  env?: Record<string, string | undefined>;
  dryRun?: boolean;
  sources?: Source[];
  pewBin?: string;
  writeNotifyHandlerFn?: typeof writeNotifyHandler;
  resolveNotifierPathsFn?: typeof resolveNotifierPaths;
  resolvePewBinFn?: typeof resolvePewBin;
  installAllFn?: typeof installAll;
  installDriverFn?: (
    source: Source,
    paths: NotifierPaths,
    deps?: { spawn?: (cmd: string, args: string[], opts?: object) => { status: number | null } },
  ) => Promise<NotifierOperationResult>;
  getAllDriversFn?: typeof getAllDrivers;
  mkdirFn?: typeof mkdir;
  ensureSecureDirFn?: typeof ensureSecureDir;
  spawn?: (cmd: string, args: string[], opts?: object) => { status: number | null };
}

export interface InitResult {
  pewBin: string;
  notifyHandler: { changed: boolean; path: string; backupPath?: string };
  hooks: NotifierOperationResult[];
}

export async function executeInit(opts: InitOptions): Promise<InitResult> {
  const resolveNotifierPathsFn = opts.resolveNotifierPathsFn ?? resolveNotifierPaths;
  const writeNotifyHandlerFn = opts.writeNotifyHandlerFn ?? writeNotifyHandler;
  const resolvePewBinFn = opts.resolvePewBinFn ?? resolvePewBin;
  const getAllDriversFn = opts.getAllDriversFn ?? getAllDrivers;
  const mkdirFn = opts.mkdirFn ?? mkdir;
  const ensureSecureDirFn = opts.ensureSecureDirFn ?? ensureSecureDir;

  const pewBin = opts.pewBin ?? (await resolvePewBinFn());
  const paths = resolveNotifierPathsFn(opts.home, opts.env);

  if (opts.dryRun) {
    const selectedSources = opts.sources ?? getAllDriversFn().map((driver) => driver.source);
    return {
      pewBin,
      notifyHandler: { changed: false, path: paths.notifyPath },
      hooks: selectedSources.map((source) => ({
        source,
        action: "skip",
        changed: false,
        detail: "dry-run",
      })),
    };
  }

  await mkdirFn(paths.stateDir, { recursive: true, mode: SECURE_DIR_MODE });
  await mkdirFn(paths.binDir, { recursive: true, mode: SECURE_DIR_MODE });
  // Repair existing directory permissions if they were created with a looser mode
  ensureSecureDirFn(paths.stateDir);
  ensureSecureDirFn(paths.binDir);

  const notifySource = buildNotifyHandler({
    stateDir: paths.stateDir,
    pewBin,
  });
  const notifyHandler = await writeNotifyHandlerFn({
    binDir: paths.binDir,
    source: notifySource,
  });

  let hooks: NotifierOperationResult[];
  if (!opts.sources || opts.sources.length === 0) {
    const installAllFn = opts.installAllFn ?? installAll;
    hooks = await installAllFn(paths, { spawn: opts.spawn });
  } else {
    const installDriverFn =
      opts.installDriverFn ??
      (async (source, notifierPaths, deps) => {
        const driver = getDriver(source);
        if (!driver) {
          return {
            source,
            action: "skip",
            changed: false,
            detail: "Unknown source",
          } satisfies NotifierOperationResult;
        }
        return driver.install(notifierPaths, deps);
      });

    hooks = [];
    for (const source of opts.sources) {
      try {
        hooks.push(await installDriverFn(source, paths, { spawn: opts.spawn }));
      } catch (error) {
        hooks.push({
          source,
          action: "skip",
          changed: false,
          detail: error instanceof Error ? error.message : String(error),
          warnings: ["Driver install failed"],
        });
      }
    }
  }

  return { pewBin, notifyHandler, hooks };
}
