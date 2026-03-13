/**
 * CLI login command — browser-based OAuth flow.
 *
 * Flow:
 * 1. Start local HTTP server on random port, bound to 127.0.0.1 only
 * 2. Generate a one-time nonce (state) for CSRF protection
 * 3. Open browser to SaaS auth endpoint with callback URL + state
 * 4. SaaS authenticates user (Google OAuth) and redirects back with api_key + state
 * 5. Validate state matches, save api_key to ~/.config/pew/config.json
 *
 * Security measures:
 * - Loopback-only binding prevents LAN exposure of the callback server
 * - Nonce/state parameter prevents cross-site request forgery and token fixation
 * - HTML output is entity-escaped to prevent reflected XSS
 */

import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { ConfigManager } from "../config/manager.js";

// ---------------------------------------------------------------------------
// Host constants
// ---------------------------------------------------------------------------

export const DEFAULT_HOST = "https://pew.md";
export const DEV_HOST = "https://pew.dev.hexly.ai";

export function resolveHost(dev: boolean): string {
  return dev ? DEV_HOST : DEFAULT_HOST;
}

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
// Helpers
// ---------------------------------------------------------------------------

/** Escape HTML special characters to prevent reflected XSS */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
    openBrowser,
    generateNonce = () => randomBytes(16).toString("hex"),
  } = options;

  const configManager = new ConfigManager(configDir, dev);

  // 1. Check existing login
  if (!force) {
    const existing = await configManager.load();
    if (existing.token) {
      return { success: true, alreadyLoggedIn: true };
    }
  }

  // 2. Generate one-time state nonce for CSRF protection
  const expectedState = generateNonce();

  // 3. Start local callback server using Node http, bound to loopback only
  return new Promise<LoginResult>((resolve) => {
    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout>;

    const server: Server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost`);

      if (url.pathname === "/callback") {
        const apiKey = url.searchParams.get("api_key");
        const email = url.searchParams.get("email") ?? undefined;
        const state = url.searchParams.get("state");

        // Validate state parameter to prevent CSRF / token fixation
        if (state !== expectedState) {
          res.writeHead(403, { "Content-Type": "text/html" });
          res.end(htmlPage(
            "Login Failed",
            "Invalid or missing state parameter. This may be a forged request."
          ));
          settle({
            success: false,
            error: "State mismatch — possible CSRF attempt",
          });
          return;
        }

        if (!apiKey) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(htmlPage(
            "Login Failed",
            "No API key was received. Please try again."
          ));
          settle({
            success: false,
            error: "No api_key received in callback",
          });
          return;
        }

        // Save to config
        await configManager.save({ token: apiKey });

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(htmlPage(
          "Login Successful!",
          `Logged in as ${escapeHtml(email ?? "unknown")}. You can close this tab.`
        ));
        settle({ success: true, email });
        return;
      }

      res.writeHead(404);
      res.end("Not Found");
    });

    function settle(result: LoginResult) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      server.close();
      resolve(result);
    }

    // Listen on port 0 on loopback only (127.0.0.1) — never expose to LAN
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const callbackUrl = `http://127.0.0.1:${port}/callback`;
      const loginUrl = `${apiUrl}/api/auth/cli?callback=${encodeURIComponent(callbackUrl)}&state=${encodeURIComponent(expectedState)}`;

      // 4. Set timeout
      timeoutHandle = setTimeout(() => {
        settle({
          success: false,
          error: `Login timeout after ${timeoutMs / 1000}s — no callback received`,
        });
      }, timeoutMs);

      // 5. Open browser
      openBrowser(loginUrl).catch((err) => {
        settle({
          success: false,
          error: `Failed to open browser: ${String(err)}`,
        });
      });
    });
  });
}

function htmlPage(title: string, message: string): string {
  // title is always a hardcoded string from our code, but escape for defense in depth.
  // message is pre-escaped at the call site for any user-controlled content.
  const safeTitle = escapeHtml(title);
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>pew - ${safeTitle}</title>
<style>
  body { font-family: -apple-system, sans-serif; text-align: center; padding: 60px 20px; background: #0a0a0a; color: #fafafa; }
  h1 { font-size: 2rem; margin-bottom: 1rem; }
  p { color: #888; font-size: 1.1rem; }
</style>
</head>
<body>
  <h1>${safeTitle}</h1>
  <p>${message}</p>
</body>
</html>`;
}
