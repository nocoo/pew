import { unlink } from "node:fs/promises";
import type { NotifierOperationResult, Source } from "@pew/core";
import { removeNotifyHandler } from "../notifier/notify-handler.js";
import { resolveNotifierPaths, type NotifierPaths } from "../notifier/paths.js";
import {
  getAllDrivers,
  getDriver,
  uninstallAll,
} from "../notifier/registry.js";

interface ArtifactRemovalResult {
  changed: boolean;
  path: string;
  detail: string;
  warnings?: string[];
}

export interface UninstallOptions {
  stateDir: string;
  home: string;
  env?: Record<string, string | undefined>;
  dryRun?: boolean;
  sources?: Source[];
  resolveNotifierPathsFn?: typeof resolveNotifierPaths;
  uninstallAllFn?: typeof uninstallAll;
  uninstallDriverFn?: (
    source: Source,
    paths: NotifierPaths,
    deps?: { spawn?: (cmd: string, args: string[], opts?: object) => { status: number | null } },
  ) => Promise<NotifierOperationResult>;
  getAllDriversFn?: typeof getAllDrivers;
  spawn?: (cmd: string, args: string[], opts?: object) => { status: number | null };
  removeNotifyHandlerFn?: (opts: {
    notifyPath: string;
  }) => Promise<ArtifactRemovalResult>;
  removeCodexBackupFn?: (path: string) => Promise<ArtifactRemovalResult>;
}

export interface UninstallResult {
  notifyHandler: ArtifactRemovalResult;
  codexBackup: ArtifactRemovalResult;
  hooks: NotifierOperationResult[];
}

export async function executeUninstall(opts: UninstallOptions): Promise<UninstallResult> {
  const resolveNotifierPathsFn = opts.resolveNotifierPathsFn ?? resolveNotifierPaths;
  const getAllDriversFn = opts.getAllDriversFn ?? getAllDrivers;
  const paths = resolveNotifierPathsFn(opts.home, opts.env);
  const allSources = getAllDriversFn().map((driver) => driver.source);
  const selectedSources = opts.sources && opts.sources.length > 0 ? opts.sources : allSources;
  const fullUninstall = selectedSources.length === allSources.length &&
    allSources.every((source) => selectedSources.includes(source));
  const shouldRemoveCodexBackup = fullUninstall || selectedSources.includes("codex");

  if (opts.dryRun) {
    return {
      notifyHandler: {
        changed: false,
        path: paths.notifyPath,
        detail: fullUninstall ? "dry-run" : "shared artifact kept",
      },
      codexBackup: {
        changed: false,
        path: paths.codexNotifyOriginalPath,
        detail: shouldRemoveCodexBackup ? "dry-run" : "not selected",
      },
      hooks: selectedSources.map((source) => ({
        source,
        action: "skip",
        changed: false,
        detail: "dry-run",
      })),
    };
  }

  let hooks: NotifierOperationResult[];
  if (fullUninstall) {
    const uninstallAllFn = opts.uninstallAllFn ?? uninstallAll;
    hooks = await uninstallAllFn(paths, { spawn: opts.spawn });
  } else {
    const uninstallDriverFn =
      opts.uninstallDriverFn ??
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
        return driver.uninstall(notifierPaths, deps);
      });

    hooks = [];
    for (const source of selectedSources) {
      try {
        hooks.push(await uninstallDriverFn(source, paths, { spawn: opts.spawn }));
      } catch (error) {
        hooks.push({
          source,
          action: "skip",
          changed: false,
          detail: error instanceof Error ? error.message : String(error),
          warnings: ["Driver uninstall failed"],
        });
      }
    }
  }

  const removeNotifyHandlerFn = opts.removeNotifyHandlerFn ?? removeNotifyHandler;
  const removeCodexBackupFn = opts.removeCodexBackupFn ?? removeOptionalFile;

  const notifyHandler = fullUninstall
    ? await removeNotifyHandlerFn({ notifyPath: paths.notifyPath })
    : {
      changed: false,
      path: paths.notifyPath,
      detail: "shared artifact kept",
    };

  // Doc 45 §8: the outer uninstall command must NOT delete
  // codex_notify_original.json unconditionally — the Codex driver already
  // removes it on its own happy path, and refuses to remove it on
  // ownership_conflict / cycle_detected / any error. Rubber-stamping the
  // deletion here would defeat that refusal and re-open Issue #318.
  //
  // Rule: only allow the outer removal when Codex was selected AND the
  // driver reported a clean uninstall (`changed: true` with no warnings).
  // Any skip / warning / error keeps the backup on disk for manual
  // inspection.
  const codexHook = hooks.find((h) => h.source === "codex");
  const codexDriverClean =
    codexHook !== undefined &&
    codexHook.changed === true &&
    (codexHook.warnings?.length ?? 0) === 0;
  const codexBackup =
    shouldRemoveCodexBackup && codexDriverClean
      ? await removeCodexBackupFn(paths.codexNotifyOriginalPath)
      : {
        changed: false,
        path: paths.codexNotifyOriginalPath,
        detail: shouldRemoveCodexBackup
          ? "backup preserved: Codex driver did not report a clean uninstall"
          : "not selected",
      };

  return { notifyHandler, codexBackup, hooks };
}

async function removeOptionalFile(path: string): Promise<ArtifactRemovalResult> {
  try {
    await unlink(path);
    return {
      changed: true,
      path,
      detail: "artifact removed",
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return {
        changed: false,
        path,
        detail: "artifact not found",
      };
    }
    throw err;
  }
}
