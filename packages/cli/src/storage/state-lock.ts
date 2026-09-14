import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { acquireLock, releaseLock } from "../notifier/lockfile.js";
import { SECURE_DIR_MODE } from "./secure-mkdir.js";

/** Serializes all Pew queue/cursor mutations, including direct CLI invocations. */
export async function withStateLock<T>(stateDir: string, action: () => Promise<T>): Promise<T> {
  await mkdir(stateDir, { recursive: true, mode: SECURE_DIR_MODE });
  const path = join(stateDir, "state.lock");
  const opts = { fs: { writeFile, unlink, readFile: (p: string) => readFile(p, "utf8") }, process };
  // ponytail: fail closed on stale locks; remove state.lock only after verifying
  // its process has exited. Automatic stale reclamation needs an OS lock/CAS,
  // otherwise two reclaimers can delete a newly acquired lock.
  if (!await acquireLock(path, opts)) throw new Error("Pew state is busy; retry after the active operation finishes. After a crash, verify the owner stopped before removing state.lock.");
  try { return await action(); }
  finally { await releaseLock(path, opts); }
}
