import { execFile } from "node:child_process";

export interface UpdateOptions {
  /** Current CLI version (from CLI_VERSION) */
  currentVersion: string;
  /** Override for testing — replaces the actual exec */
  execFn?: (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
}

export interface UpdateResult {
  success: boolean;
  output: string;
  error?: string;
}

function defaultExec(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 60_000 }, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve({ stdout, stderr });
    });
  });
}

/**
 * Update pew to the latest version from npm.
 * Runs `npm install -g @nocoo/pew@latest`.
 */
export async function executeUpdate(opts: UpdateOptions): Promise<UpdateResult> {
  const exec = opts.execFn ?? defaultExec;

  try {
    const { stdout, stderr } = await exec("npm", ["install", "-g", "@nocoo/pew@latest"]);
    const output = (stdout + stderr).trim();
    return { success: true, output };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, output: "", error: message };
  }
}
