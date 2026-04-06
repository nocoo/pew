/**
 * CLI login command — browser-based OAuth flow.
 *
 * Uses cli-base performLogin for the OAuth callback flow.
 * Pew-specific: host resolution (dev vs prod) and accent color.
 */

import { openBrowser, performLogin } from "@nocoo/cli-base";
import { ConfigManager } from "../config/manager.js";

// ---------------------------------------------------------------------------
// Host constants
// ---------------------------------------------------------------------------

export const DEFAULT_HOST = "https://pew.md";
export const DEV_HOST = "https://pew.dev.hexly.ai";

export function resolveHost(dev: boolean): string {
  return dev ? DEV_HOST : DEFAULT_HOST;
}

// Pew accent color (green)
const PEW_ACCENT_COLOR = "#22c55e";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LoginOptions {
  /** Directory for config file */
  configDir: string;
  /** Base URL of the pew SaaS */
  apiUrl: string;
  /** Whether dev mode is active (uses config.dev.json) */
  dev?: boolean;
  /** Timeout in milliseconds (default: 120000) */
  timeoutMs?: number;
  /** Force re-login even if already authenticated */
  force?: boolean;
  /** Injected browser opener (for testing) */
  openBrowser: (url: string) => Promise<void>;
  /** Injected nonce generator (for testing determinism) */
  generateNonce?: () => string;
}

export interface LoginResult {
  success: boolean;
  email?: string;
  alreadyLoggedIn?: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export async function executeLogin(options: LoginOptions): Promise<LoginResult> {
  const {
    configDir,
    apiUrl,
    dev = false,
    timeoutMs = 120_000,
    force = false,
    openBrowser: openBrowserFn,
    generateNonce,
  } = options;

  const configManager = new ConfigManager(configDir, dev);

  // 1. Check existing login
  if (!force) {
    const existing = await configManager.load();
    if (existing.token) {
      return { success: true, alreadyLoggedIn: true };
    }
  }

  // 2. Perform OAuth login flow using cli-base
  const result = await performLogin({
    openBrowser: openBrowserFn,
    onSaveToken: (token) => {
      configManager.write({ token });
    },
    apiUrl,
    timeoutMs,
    generateNonce,
    accentColor: PEW_ACCENT_COLOR,
  });

  return {
    success: result.success,
    email: result.email,
    error: result.error,
  };
}

// Re-export for CLI default browser opener
export { openBrowser };
