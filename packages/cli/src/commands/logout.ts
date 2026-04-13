/**
 * CLI logout command — clears stored authentication token.
 *
 * Removes the API token from the pew config file, effectively
 * logging the user out. After logout, `pew login` must be run
 * again to re-authenticate.
 */

import { ConfigManager } from "../config/manager.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LogoutOptions {
  /** Directory for config file */
  configDir: string;
  /** Whether dev mode is active (uses config.dev.json) */
  dev?: boolean;
}

export interface LogoutResult {
  success: boolean;
  alreadyLoggedOut?: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export async function executeLogout(options: LogoutOptions): Promise<LogoutResult> {
  const { configDir, dev = false } = options;

  try {
    const configManager = new ConfigManager(configDir, dev);
    const config = await configManager.load();

    if (!config.token) {
      return { success: true, alreadyLoggedOut: true };
    }

    // Clear the token
    configManager.write({ ...config, token: undefined });

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to clear credentials",
    };
  }
}
