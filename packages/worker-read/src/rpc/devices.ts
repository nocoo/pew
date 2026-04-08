/**
 * Devices domain RPC handlers for worker-read.
 *
 * Handles all device-related read queries with typed interfaces.
 */

import type { D1Database } from "@cloudflare/workers-types";

// ---------------------------------------------------------------------------
// Response Types
// ---------------------------------------------------------------------------

export interface DeviceRow {
  device_id: string;
  alias: string | null;
  first_seen: string | null;
  last_seen: string | null;
  total_tokens: number;
  sources: string | null;
  model_count: number;
}

// ---------------------------------------------------------------------------
// RPC Request Types
// ---------------------------------------------------------------------------

export interface ListDevicesRequest {
  method: "devices.list";
  userId: string;
}

export interface CheckDeviceExistsRequest {
  method: "devices.exists";
  userId: string;
  deviceId: string;
}

export interface CheckDuplicateAliasRequest {
  method: "devices.checkDuplicateAlias";
  userId: string;
  alias: string;
  excludeDeviceId: string;
}

export interface CheckDeviceHasRecordsRequest {
  method: "devices.hasRecords";
  userId: string;
  deviceId: string;
}

export interface GetDeviceAliasRequest {
  method: "devices.getAlias";
  userId: string;
  deviceId: string;
}

export type DevicesRpcRequest =
  | ListDevicesRequest
  | CheckDeviceExistsRequest
  | CheckDuplicateAliasRequest
  | CheckDeviceHasRecordsRequest
  | GetDeviceAliasRequest;

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleListDevices(
  req: ListDevicesRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userId) {
    return Response.json({ error: "userId is required" }, { status: 400 });
  }

  const results = await db
    .prepare(
      `SELECT
        d.device_id,
        da.alias,
        d.first_seen,
        d.last_seen,
        d.total_tokens,
        d.sources,
        d.model_count
      FROM (
        SELECT
          device_id,
          MIN(hour_start) AS first_seen,
          MAX(hour_start) AS last_seen,
          SUM(total_tokens) AS total_tokens,
          GROUP_CONCAT(DISTINCT source) AS sources,
          COUNT(DISTINCT model) AS model_count
        FROM usage_records
        WHERE user_id = ?
        GROUP BY device_id
        UNION ALL
        SELECT
          da2.device_id,
          NULL AS first_seen,
          NULL AS last_seen,
          0 AS total_tokens,
          NULL AS sources,
          0 AS model_count
        FROM device_aliases da2
        WHERE da2.user_id = ?
          AND da2.device_id NOT IN (
            SELECT DISTINCT device_id FROM usage_records WHERE user_id = ?
          )
      ) d
      LEFT JOIN device_aliases da
        ON da.user_id = ? AND da.device_id = d.device_id
      ORDER BY d.total_tokens DESC, d.device_id`
    )
    .bind(req.userId, req.userId, req.userId, req.userId)
    .all<DeviceRow>();

  return Response.json({ data: results.results });
}

async function handleCheckDeviceExists(
  req: CheckDeviceExistsRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userId || !req.deviceId) {
    return Response.json(
      { error: "userId and deviceId are required" },
      { status: 400 }
    );
  }

  const result = await db
    .prepare(
      `SELECT device_id FROM (
        SELECT DISTINCT device_id FROM usage_records
        WHERE user_id = ? AND device_id = ?
        UNION
        SELECT device_id FROM device_aliases
        WHERE user_id = ? AND device_id = ?
      ) LIMIT 1`
    )
    .bind(req.userId, req.deviceId, req.userId, req.deviceId)
    .first<{ device_id: string }>();

  return Response.json({ data: { exists: result !== null } });
}

async function handleCheckDuplicateAlias(
  req: CheckDuplicateAliasRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userId || !req.alias || !req.excludeDeviceId) {
    return Response.json(
      { error: "userId, alias, and excludeDeviceId are required" },
      { status: 400 }
    );
  }

  const result = await db
    .prepare(
      `SELECT device_id FROM device_aliases
       WHERE user_id = ? AND LOWER(TRIM(alias)) = LOWER(TRIM(?)) AND device_id != ?
       LIMIT 1`
    )
    .bind(req.userId, req.alias, req.excludeDeviceId)
    .first<{ device_id: string }>();

  return Response.json({ data: { duplicate: result !== null } });
}

async function handleCheckDeviceHasRecords(
  req: CheckDeviceHasRecordsRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userId || !req.deviceId) {
    return Response.json(
      { error: "userId and deviceId are required" },
      { status: 400 }
    );
  }

  const result = await db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM usage_records
       WHERE user_id = ? AND device_id = ?`
    )
    .bind(req.userId, req.deviceId)
    .first<{ cnt: number }>();

  return Response.json({ data: { hasRecords: (result?.cnt ?? 0) > 0 } });
}

async function handleGetDeviceAlias(
  req: GetDeviceAliasRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userId || !req.deviceId) {
    return Response.json(
      { error: "userId and deviceId are required" },
      { status: 400 }
    );
  }

  const result = await db
    .prepare(
      `SELECT alias FROM device_aliases
       WHERE user_id = ? AND device_id = ?`
    )
    .bind(req.userId, req.deviceId)
    .first<{ alias: string }>();

  return Response.json({ data: result?.alias ?? null });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handleDevicesRpc(
  request: DevicesRpcRequest,
  db: D1Database
): Promise<Response> {
  switch (request.method) {
    case "devices.list":
      return handleListDevices(request, db);
    case "devices.exists":
      return handleCheckDeviceExists(request, db);
    case "devices.checkDuplicateAlias":
      return handleCheckDuplicateAlias(request, db);
    case "devices.hasRecords":
      return handleCheckDeviceHasRecords(request, db);
    case "devices.getAlias":
      return handleGetDeviceAlias(request, db);
    default:
      return Response.json(
        { error: `Unknown devices method: ${(request as { method: string }).method}` },
        { status: 400 }
      );
  }
}
