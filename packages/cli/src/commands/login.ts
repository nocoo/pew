/**
 * CLI login command — browser-based OAuth flow or code-based authentication.
 *
 * Two modes:
 * 1. Browser flow (default): Uses cli-base performLogin for the OAuth callback flow.
 * 2. Code flow (--code): Uses a one-time code generated in the web UI.
 *
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
  /** One-time auth code from web UI (skips browser flow) */
  code?: string;
  /** Injected fetch function (for testing) */
  fetch?: typeof globalThis.fetch;
  /** Log function for browser flow messages (default: console.log) */
  log?: (msg: string) => void;
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
    code,
    fetch: fetchFn = globalThis.fetch,
  } = options;
  // log is accessed via options.log below (not destructured to avoid shadowing)

  const configManager = new ConfigManager(configDir, dev);

  // 1. Check existing login
  if (!force) {
    const existing = await configManager.load();
    if (existing.token) {
      return { success: true, alreadyLoggedIn: true };
    }
  }

  // 2. Code-based login flow (headless)
  if (code) {
    return executeCodeLogin(configManager, apiUrl, code, fetchFn);
  }

  // 3. Browser-based OAuth login flow
  const logFn = options.log ?? ((msg: string) => console.log(msg));
  const result = await performLogin({
    openBrowser: openBrowserFn,
    onSaveToken: (token) => {
      configManager.write({ token });
    },
    apiUrl,
    timeoutMs,
    generateNonce,
    accentColor: PEW_ACCENT_COLOR,
    log: logFn,
  });

  return {
    success: result.success,
    email: result.email,
    error: result.error,
  };
}

// ---------------------------------------------------------------------------
// Code-based login (headless)
// ---------------------------------------------------------------------------

interface CodeVerifyResponse {
  api_key?: string;
  email?: string;
  error?: string;
}

async function executeCodeLogin(
  configManager: ConfigManager,
  apiUrl: string,
  code: string,
  fetchFn: typeof globalThis.fetch,
): Promise<LoginResult> {
  try {
    const response = await fetchFn(`${apiUrl}/api/auth/code/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });

    const data = (await response.json()) as CodeVerifyResponse;

    if (!response.ok) {
      return {
        success: false,
        error: data.error ?? `Server returned ${response.status}`,
      };
    }

    if (!data.api_key) {
      return {
        success: false,
        error: "No API key returned",
      };
    }

    // Save the token
    configManager.write({ token: data.api_key });

    return {
      success: true,
      email: data.email,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}

// Re-export for CLI default browser opener
export { openBrowser };
