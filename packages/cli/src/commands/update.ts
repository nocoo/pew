/**
 * Update pew to the latest version.
 *
 * Uses cli-base utilities for version checking and update execution.
 */

import { detectPackageManager, getUpdateCommand } from "@nocoo/cli-base";
import { exec as execCallback } from "node:child_process";

const PACKAGE_NAME = "@nocoo/pew";

export interface UpdateOptions {
  /** Current CLI version (from CLI_VERSION) */
  currentVersion: string;
  /** Override for testing — replaces the actual exec */
  execFn?: (cmd: string) => Promise<{ stdout: string; stderr: string }>;
}

export interface UpdateResult {
  success: boolean;
  output: string;
  error?: string;
}

function defaultExec(cmd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execCallback(cmd, { timeout: 60_000 }, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve({ stdout, stderr });
    });
  });
}

/**
 * Update pew to the latest version.
 * Detects package manager and runs appropriate install command.
 */
export async function executeUpdate(opts: UpdateOptions): Promise<UpdateResult> {
  const exec = opts.execFn ?? defaultExec;
  const pm = detectPackageManager(PACKAGE_NAME);

  // Fallback to npm if package manager detection fails
  const command = pm ? getUpdateCommand(pm, PACKAGE_NAME) : `npm install -g ${PACKAGE_NAME}@latest`;

  try {
    const { stdout, stderr } = await exec(command);
    const output = (stdout + stderr).trim();
    return { success: true, output };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, output: "", error: message };
  }
}
