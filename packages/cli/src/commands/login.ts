/**
 * CLI login command — browser-based OAuth flow.
 *
 * Flow:
 * 1. Start local HTTP server on random port
 * 2. Open browser to SaaS auth endpoint with callback URL
 * 3. SaaS authenticates user (Google OAuth) and redirects back with api_key
 * 4. Save api_key to ~/.config/pew/config.json
 */

import { createServer, type Server } from "node:http";
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
    openBrowser,
  } = options;

  const configManager = new ConfigManager(configDir, dev);

  // 1. Check existing login
  if (!force) {
    const existing = await configManager.load();
    if (existing.token) {
      return { success: true, alreadyLoggedIn: true };
    }
  }

  // 2. Start local callback server using Node http
  return new Promise<LoginResult>((resolve) => {
    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout>;

    const server: Server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost`);

      if (url.pathname === "/callback") {
        const apiKey = url.searchParams.get("api_key");
        const email = url.searchParams.get("email") ?? undefined;

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
          `Logged in as ${email ?? "unknown"}. You can close this tab.`
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

    // Listen on port 0 for random available port
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const callbackUrl = `http://localhost:${port}/callback`;
      const loginUrl = `${apiUrl}/api/auth/cli?callback=${encodeURIComponent(callbackUrl)}`;

      // 3. Set timeout
      timeoutHandle = setTimeout(() => {
        settle({
          success: false,
          error: `Login timeout after ${timeoutMs / 1000}s — no callback received`,
        });
      }, timeoutMs);

      // 4. Open browser
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
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>pew - ${title}</title>
<style>
  body { font-family: -apple-system, sans-serif; text-align: center; padding: 60px 20px; background: #0a0a0a; color: #fafafa; }
  h1 { font-size: 2rem; margin-bottom: 1rem; }
  p { color: #888; font-size: 1.1rem; }
</style>
</head>
<body>
  <h1>${title}</h1>
  <p>${message}</p>
</body>
</html>`;
}
