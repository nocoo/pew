import type { Source } from "@pew/core";
import { readFile } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import type { QueueState } from "../storage/base-queue.js";

export const RETIRED_SOURCES: Source[] = [
  "gemini-cli",
  "kosmos",
  "omp",
  "zcode",
  "pmstudio",
  "vscode-copilot",
];
export const isRetiredSource = (source: string): boolean =>
  RETIRED_SOURCES.includes(source as Source);

export function isRetiredCursorPath(
  path: string,
  activePaths: ReadonlyArray<string | undefined> = [],
): boolean {
  if (
    activePaths.some((root) => {
      if (!root) return false;
      const child = relative(root, path);
      return (
        !isAbsolute(child) &&
        child !== ".." &&
        !child.startsWith("../") &&
        !child.startsWith("..\\")
      );
    })
  )
    return false;
  return /(?:^|[/\\])(?:\.gemini[/\\]tmp|\.omp|\.zcode|kosmos-app|pm-studio-app|Code(?: - Insiders)?[/\\]User)(?:[/\\]|$)/.test(
    path,
  );
}

export async function readRetainedQueueState(stateDir: string, file: string): Promise<QueueState> {
  let raw: string;
  try {
    raw = await readFile(join(stateDir, file), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { offset: 0 };
    throw error;
  }
  try {
    const state = JSON.parse(raw);
    const offset = state.offset ?? 0;
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      (state.dirtyKeys !== undefined &&
        (!Array.isArray(state.dirtyKeys) ||
          state.dirtyKeys.some((key: unknown) => typeof key !== "string")))
    )
      throw new Error();
    return { offset, dirtyKeys: state.dirtyKeys };
  } catch {
    throw new Error("Cannot verify retained queue upload state");
  }
}
