/**
 * pew Read Worker — Cloudflare Worker with native D1 bindings for reads.
 *
 * Provides a read-only SQL query proxy for the Next.js dashboard,
 * replacing the Cloudflare D1 REST API with a native D1 binding
 * for lower latency and higher reliability.
 *
 * Routes:
 * - GET  /api/live   — health check (no auth, no cache)
 * - POST /api/query  — execute read-only SQL query (legacy, being migrated)
 * - POST /api/rpc    — typed RPC endpoint for domain-specific queries
 *
 * Auth: shared secret (WORKER_READ_SECRET) between Next.js and this Worker.
 *       /api/live is excluded from auth (public health endpoint).
 *
 * Safety: tokenizer-based validation rejects write statements
 */

import { handleUsersRpc, type UsersRpcRequest } from "./rpc/users";
import { handleProjectsRpc, type ProjectsRpcRequest } from "./rpc/projects";
import { handleTeamsRpc, type TeamsRpcRequest } from "./rpc/teams";
import { handleSeasonsRpc, type SeasonsRpcRequest } from "./rpc/seasons";
import { handleUsageRpc, type UsageRpcRequest } from "./rpc/usage";
import { handleAchievementsRpc, type AchievementsRpcRequest } from "./rpc/achievements";
import { handleDevicesRpc, type DevicesRpcRequest } from "./rpc/devices";
import { handleOrganizationsRpc, type OrganizationsRpcRequest } from "./rpc/organizations";
import { handleShowcasesRpc, type ShowcasesRpcRequest } from "./rpc/showcases";
import { handleSettingsRpc, type SettingsRpcRequest } from "./rpc/settings";
import { handleAuthRpc, type AuthRpcRequest } from "./rpc/auth";
import { handleSessionsRpc, type SessionsRpcRequest } from "./rpc/sessions";
import { handleLeaderboardRpc, type LeaderboardRpcRequest } from "./rpc/leaderboard";
import { handlePricingRpc, type PricingRpcRequest } from "./rpc/pricing";
import { handleAdminRpc, type AdminRpcRequest } from "./rpc/admin";
import { handleLiveRpc, type LiveRpcRequest } from "./rpc/live";

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

export const WORKER_VERSION = "2.18.2";

// ---------------------------------------------------------------------------
// Boot timestamp (for uptime calculation)
// ---------------------------------------------------------------------------

const bootTime = Date.now();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Env {
  DB: D1Database;
  WORKER_READ_SECRET: string;
}

// ---------------------------------------------------------------------------
// Write-statement guard (enhanced)
// ---------------------------------------------------------------------------

/**
 * Dangerous SQL keywords that indicate write operations.
 * Checked after normalization (comments stripped, trimmed).
 */
const WRITE_KEYWORDS = /^(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|PRAGMA|REPLACE|TRUNCATE)\b/i;

/**
 * CTE pattern: WITH ... followed by a write keyword.
 * Matches: WITH x AS (...) DELETE/UPDATE/INSERT
 */
const CTE_WRITE_RE = /^WITH\b.*\b(DELETE|UPDATE|INSERT)\b/is;

/**
 * Remove SQL comments from a query string.
 * Handles:
 * - Line comments: -- comment
 * - Block comments: /* comment * /
 *
 * Preserves content inside string literals to avoid false positives.
 */
function stripComments(sql: string): string {
  let result = "";
  let i = 0;
  const len = sql.length;

  while (i < len) {
    // Check for string literal (single quote)
    if (sql[i] === "'") {
      const start = i;
      i++;
      while (i < len) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          // Escaped quote
          i += 2;
        } else if (sql[i] === "'") {
          i++;
          break;
        } else {
          i++;
        }
      }
      result += sql.slice(start, i);
      continue;
    }

    // Check for line comment: --
    if (sql[i] === "-" && sql[i + 1] === "-") {
      // Skip until end of line
      while (i < len && sql[i] !== "\n") {
        i++;
      }
      // Keep the newline to preserve structure
      if (i < len) {
        result += " ";
        i++;
      }
      continue;
    }

    // Check for block comment: /* */
    if (sql[i] === "/" && sql[i + 1] === "*") {
      i += 2;
      // Skip until */
      while (i < len - 1 && !(sql[i] === "*" && sql[i + 1] === "/")) {
        i++;
      }
      i += 2; // Skip */
      result += " "; // Replace comment with space
      continue;
    }

    result += sql[i];
    i++;
  }

  return result;
}

/**
 * Check if SQL contains a semicolon outside of string literals.
 * Multiple statements are not allowed.
 */
function containsMultiStatement(sql: string): boolean {
  let inString = false;
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === "'") {
      if (inString && sql[i + 1] === "'") {
        // Escaped quote, skip
        i++;
        continue;
      }
      inString = !inString;
      continue;
    }
    if (!inString && sql[i] === ";") {
      // Check if there's any non-whitespace after the semicolon
      const rest = sql.slice(i + 1).trim();
      if (rest.length > 0) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Validate that a SQL query is read-only.
 * Returns an error message if the query is rejected, null if allowed.
 */
export function validateReadOnlySQL(sql: string): string | null {
  // Step 1: Strip comments
  const noComments = stripComments(sql);

  // Step 2: Normalize whitespace and trim
  const normalized = noComments.trim();

  if (normalized.length === 0) {
    return "Empty SQL after normalization";
  }

  // Step 3: Check for multi-statement (semicolon outside string literals)
  if (containsMultiStatement(normalized)) {
    return "Multi-statement SQL not allowed";
  }

  // Step 4: Check for direct write keywords at start
  if (WRITE_KEYWORDS.test(normalized)) {
    return "Write queries not allowed";
  }

  // Step 5: Check for CTE with write (WITH ... DELETE/UPDATE/INSERT)
  if (CTE_WRITE_RE.test(normalized)) {
    return "CTE with write operation not allowed";
  }

  // Step 6: Must start with SELECT or WITH (for CTE SELECT)
  if (!/^(SELECT|WITH)\b/i.test(normalized)) {
    return "Only SELECT queries are allowed";
  }

  return null;
}

// ---------------------------------------------------------------------------
// Route: GET /api/live
// ---------------------------------------------------------------------------

async function handleLive(env: Env): Promise<Response> {
  let dbStatus: { connected: boolean; latencyMs?: number; error?: string };

  try {
    const start = performance.now();
    await env.DB.prepare("SELECT 1").first();
    dbStatus = {
      connected: true,
      latencyMs: Math.round(performance.now() - start),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Strip any accidental "ok" from error messages to prevent
    // keyword-based monitors from false-positive matching
    dbStatus = {
      connected: false,
      error: message.replace(/\bok\b/gi, "***"),
    };
  }

  const isHealthy = dbStatus.connected;

  const body = {
    status: isHealthy ? "ok" : "error",
    version: WORKER_VERSION,
    uptime: Math.round((Date.now() - bootTime) / 1000),
    db: dbStatus,
    timestamp: new Date().toISOString(),
  };

  return Response.json(body, {
    status: isHealthy ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}

// ---------------------------------------------------------------------------
// Route: POST /api/query
// ---------------------------------------------------------------------------

async function handleQuery(body: unknown, env: Env): Promise<Response> {
  if (typeof body !== "object" || body === null) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { sql, params } = body as { sql?: string; params?: unknown[] };

  if (typeof sql !== "string" || sql.trim().length === 0) {
    return Response.json({ error: "Missing or empty sql" }, { status: 400 });
  }

  // Safety: validate read-only SQL (enhanced validation)
  const validationError = validateReadOnlySQL(sql);
  if (validationError) {
    return Response.json(
      { error: validationError },
      { status: 403 },
    );
  }

  try {
    const stmt = env.DB.prepare(sql);
    const bound =
      Array.isArray(params) && params.length > 0
        ? stmt.bind(...params)
        : stmt;
    const result = await bound.all();

    return Response.json({
      results: result.results ?? [],
      meta: result.meta ?? { changes: 0, duration: 0 },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: `D1 query failed: ${message}` },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Route: POST /api/rpc
// ---------------------------------------------------------------------------

// Union of all RPC request types (add new domains here as they are implemented)
// Exported for use in type guards and client-side type safety
export type RpcRequest =
  | UsersRpcRequest
  | ProjectsRpcRequest
  | TeamsRpcRequest
  | SeasonsRpcRequest
  | UsageRpcRequest
  | AchievementsRpcRequest
  | DevicesRpcRequest
  | OrganizationsRpcRequest
  | ShowcasesRpcRequest
  | SettingsRpcRequest
  | AuthRpcRequest
  | SessionsRpcRequest
  | LeaderboardRpcRequest
  | PricingRpcRequest
  | AdminRpcRequest
  | LiveRpcRequest;

async function handleRpc(body: unknown, env: Env): Promise<Response> {
  if (typeof body !== "object" || body === null) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { method } = body as { method?: string };

  if (typeof method !== "string" || method.length === 0) {
    return Response.json({ error: "Missing or empty method" }, { status: 400 });
  }

  // Route to domain handler based on method prefix
  const domain = method.split(".")[0];

  try {
    switch (domain) {
      case "users":
        return handleUsersRpc(body as UsersRpcRequest, env.DB);
      case "projects":
        return handleProjectsRpc(body as ProjectsRpcRequest, env.DB);
      case "teams":
        return handleTeamsRpc(body as TeamsRpcRequest, env.DB);
      case "seasons":
        return handleSeasonsRpc(body as SeasonsRpcRequest, env.DB);
      case "usage":
        return handleUsageRpc(body as UsageRpcRequest, env.DB);
      case "achievements":
        return handleAchievementsRpc(body as AchievementsRpcRequest, env.DB);
      case "devices":
        return handleDevicesRpc(body as DevicesRpcRequest, env.DB);
      case "organizations":
        return handleOrganizationsRpc(body as OrganizationsRpcRequest, env.DB);
      case "showcases":
        return handleShowcasesRpc(body as ShowcasesRpcRequest, env.DB);
      case "settings":
        return handleSettingsRpc(body as SettingsRpcRequest, env.DB);
      case "auth":
        return handleAuthRpc(body as AuthRpcRequest, env.DB);
      case "sessions":
        return handleSessionsRpc(body as SessionsRpcRequest, env.DB);
      case "leaderboard":
        return handleLeaderboardRpc(body as LeaderboardRpcRequest, env.DB);
      case "pricing":
        return handlePricingRpc(body as PricingRpcRequest, env.DB);
      case "admin":
        return handleAdminRpc(body as AdminRpcRequest, env.DB);
      case "live":
        return handleLiveRpc(body as LiveRpcRequest, env.DB);
      default:
        return Response.json(
          { error: `Unknown RPC domain: ${domain}` },
          { status: 400 },
        );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: `RPC failed: ${message}` },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

const worker: ExportedHandler<Env> = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // GET /api/live — no auth
    if (path === "/api/live") {
      if (request.method !== "GET") {
        return Response.json(
          { error: "Method not allowed" },
          { status: 405 },
        );
      }
      return handleLive(env);
    }

    // Auth: all other routes require Bearer token
    const authHeader = request.headers.get("Authorization");
    const expected = `Bearer ${env.WORKER_READ_SECRET}`;
    if (!authHeader || authHeader !== expected) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // POST /api/query (legacy SQL proxy, being migrated to RPC)
    if (path === "/api/query") {
      if (request.method !== "POST") {
        return Response.json(
          { error: "Method not allowed" },
          { status: 405 },
        );
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return Response.json(
          { error: "Invalid JSON body" },
          { status: 400 },
        );
      }

      return handleQuery(body, env);
    }

    // POST /api/rpc — typed RPC endpoint
    if (path === "/api/rpc") {
      if (request.method !== "POST") {
        return Response.json(
          { error: "Method not allowed" },
          { status: 405 },
        );
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return Response.json(
          { error: "Invalid JSON body" },
          { status: 400 },
        );
      }

      return handleRpc(body, env);
    }

    // Unknown route
    return Response.json({ error: "Not found" }, { status: 404 });
  },
};

export default worker;
