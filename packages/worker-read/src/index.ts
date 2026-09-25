/**
 * pew Read Worker — Cloudflare Worker with native D1 bindings for reads.
 *
 * Provides typed domain RPC methods for the Next.js dashboard,
 * replacing the Cloudflare D1 REST API with a native D1 binding
 * for lower latency and higher reliability.
 *
 * Routes:
 * - GET  /api/live   — health check (no auth, no cache)
 * - POST /api/rpc    — typed RPC endpoint for domain-specific queries
 *
 * Auth: shared secret (WORKER_READ_SECRET) between Next.js and this Worker.
 *       /api/live is excluded from auth (public health endpoint).
 *
 * SQL is owned by the Worker; RPC clients supply method parameters only.
 */

import { handleUsersRpc, type UsersRpcRequest } from "./rpc/users";
import { handleTeamsRpc, type TeamsRpcRequest } from "./rpc/teams";
import { handleSeasonsRpc, type SeasonsRpcRequest } from "./rpc/seasons";
import { handleUsageRpc, type UsageRpcRequest } from "./rpc/usage";
import { handleDevicesRpc, type DevicesRpcRequest } from "./rpc/devices";
import { handleOrganizationsRpc, type OrganizationsRpcRequest } from "./rpc/organizations";
import { handleSettingsRpc, type SettingsRpcRequest } from "./rpc/settings";
import { handleAuthRpc, type AuthRpcRequest } from "./rpc/auth";
import { handleSessionsRpc, type SessionsRpcRequest } from "./rpc/sessions";
import { handleLeaderboardRpc, type LeaderboardRpcRequest } from "./rpc/leaderboard";
import { handlePricingRpc, type PricingRpcRequest } from "./rpc/pricing";
import { handleAdminRpc, type AdminRpcRequest } from "./rpc/admin";
import { handleLiveRpc, type LiveRpcRequest } from "./rpc/live";
import { handleCacheRpc, type CacheRpcRequest } from "./rpc/cache";
import { syncDynamicPricing } from "./sync/orchestrator";

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

export const WORKER_VERSION = "3.0.5";

// ---------------------------------------------------------------------------
// Boot timestamp (for uptime calculation)
// ---------------------------------------------------------------------------

const bootTime = Date.now();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  WORKER_READ_SECRET: string;
}

// ---------------------------------------------------------------------------
// Constant-time string comparison
// ---------------------------------------------------------------------------

/**
 * Compare two strings in constant time to prevent timing attacks.
 * Uses crypto.subtle.timingSafeEqual (available in Cloudflare Workers runtime).
 * Length mismatch returns false without timing leak from byte comparison.
 */
async function secureCompare(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  // Use the longer length so comparison time doesn't leak secret length.
  const len = Math.max(bufA.byteLength, bufB.byteLength);
  const paddedA = new Uint8Array(len);
  const paddedB = new Uint8Array(len);
  paddedA.set(bufA);
  paddedB.set(bufB);
  // Cloudflare Workers expose crypto.subtle.timingSafeEqual; Node/Vitest does not.
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (a: BufferSource, b: BufferSource) => boolean;
  };
  if (typeof subtle.timingSafeEqual === "function") {
    return (
      bufA.byteLength === bufB.byteLength && subtle.timingSafeEqual(paddedA, paddedB)
    );
  }
  // Fallback constant-time comparison (XOR every byte, accumulate diff bits).
  let diff = bufA.byteLength ^ bufB.byteLength;
  for (let i = 0; i < len; i++) {
    diff |= (paddedA[i] ?? 0) ^ (paddedB[i] ?? 0);
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Route: GET /api/live
// ---------------------------------------------------------------------------

async function handleLive(env: Env): Promise<Response> {
  const timestamp = new Date().toISOString();
  const uptime = Math.round((Date.now() - bootTime) / 1000);
  let database: { connected: boolean; error?: string };

  try {
    await env.DB.prepare("SELECT 1 AS probe").first();
    database = { connected: true };
  } catch (err) {
    console.error(err);
    database = { connected: false, error: "Internal server error" };
  }

  const healthy = database.connected;

  return Response.json(
    { status: healthy ? "ok" : "error", version: WORKER_VERSION, component: "worker-read", timestamp, uptime, database },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}

// ---------------------------------------------------------------------------
// Route: POST /api/rpc
// ---------------------------------------------------------------------------

// Union of all RPC request types (add new domains here as they are implemented)
// Exported for use in type guards and client-side type safety
export type RpcRequest =
  | UsersRpcRequest
  | TeamsRpcRequest
  | SeasonsRpcRequest
  | UsageRpcRequest
  | DevicesRpcRequest
  | OrganizationsRpcRequest
  | SettingsRpcRequest
  | AuthRpcRequest
  | SessionsRpcRequest
  | LeaderboardRpcRequest
  | PricingRpcRequest
  | AdminRpcRequest
  | LiveRpcRequest
  | CacheRpcRequest;

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
      case "teams":
        return handleTeamsRpc(body as TeamsRpcRequest, env.DB);
      case "seasons":
        return handleSeasonsRpc(body as SeasonsRpcRequest, env.DB, env.CACHE);
      case "usage":
        return handleUsageRpc(body as UsageRpcRequest, env.DB);
      case "devices":
        return handleDevicesRpc(body as DevicesRpcRequest, env.DB);
      case "organizations":
        return handleOrganizationsRpc(body as OrganizationsRpcRequest, env.DB);
      case "settings":
        return handleSettingsRpc(body as SettingsRpcRequest, env.DB);
      case "auth":
        return handleAuthRpc(body as AuthRpcRequest, env.DB);
      case "sessions":
        return handleSessionsRpc(body as SessionsRpcRequest, env.DB);
      case "leaderboard":
        return handleLeaderboardRpc(body as LeaderboardRpcRequest, env.DB, env.CACHE);
      case "pricing":
        return handlePricingRpc(body as PricingRpcRequest, env.DB, env.CACHE);
      case "admin":
        return handleAdminRpc(body as AdminRpcRequest, env.DB);
      case "live":
        return handleLiveRpc(body as LiveRpcRequest, env.DB);
      case "cache":
        return handleCacheRpc(body as CacheRpcRequest, env.CACHE);
      default:
        return Response.json(
          { error: `Unknown RPC domain: ${domain}` },
          { status: 400 },
        );
    }
  } catch (err) {
    console.error(err);
    return Response.json(
      { error: "Internal server error" },
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

    // Auth: all other routes require Bearer token (constant-time comparison)
    if (typeof env.WORKER_READ_SECRET !== "string" || !env.WORKER_READ_SECRET.trim()) {
      return Response.json({ error: "Service unavailable" }, { status: 503 });
    }
    const authHeader = request.headers.get("Authorization");
    const expected = `Bearer ${env.WORKER_READ_SECRET}`;
    if (!authHeader || !(await secureCompare(authHeader, expected))) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
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

  async scheduled(_event, env) {
    const now = new Date().toISOString();
    const outcome = await syncDynamicPricing({ db: env.DB, kv: env.CACHE }, now);
    if (!outcome.ok) {
      console.error("dynamic pricing sync degraded", {
        entries: outcome.entriesWritten,
        errors: outcome.errors,
      });
    } else {
      console.log("dynamic pricing sync ok", { entries: outcome.entriesWritten });
    }
  },
};

export default worker;
