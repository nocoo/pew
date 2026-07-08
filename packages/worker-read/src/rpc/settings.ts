/**
 * Settings domain RPC handlers for worker-read.
 *
 * Handles app settings and user preference queries.
 */

import type { D1Database } from "@cloudflare/workers-types";

// ---------------------------------------------------------------------------
// Response Types
// ---------------------------------------------------------------------------

interface AppSettingRow {
  key: string;
  value: string;
}

interface UserSettingRow {
  key: string;
  value: string;
}

// ---------------------------------------------------------------------------
// RPC Request Types
// ---------------------------------------------------------------------------

export interface GetAppSettingRequest {
  method: "settings.getApp";
  key: string;
}

export interface GetAllAppSettingsRequest {
  method: "settings.getAllApp";
}

export interface GetUserSettingRequest {
  method: "settings.getUser";
  userId: string;
  key: string;
}

export interface GetAllUserSettingsRequest {
  method: "settings.getAllUser";
  userId: string;
}

export type SettingsRpcRequest =
  | GetAppSettingRequest
  | GetAllAppSettingsRequest
  | GetUserSettingRequest
  | GetAllUserSettingsRequest;

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleGetAppSetting(
  req: GetAppSettingRequest,
  db: D1Database
): Promise<Response> {
  if (!req.key) {
    return Response.json({ error: "key is required" }, { status: 400 });
  }

  const result = await db
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .bind(req.key)
    .first<{ value: string }>();

  return Response.json({ result: result?.value ?? null });
}

async function handleGetAllAppSettings(db: D1Database): Promise<Response> {
  const results = await db
    .prepare(`SELECT key, value FROM app_settings ORDER BY key ASC`)
    .all<AppSettingRow>();

  return Response.json({ result: results.results });
}

async function handleGetUserSetting(
  req: GetUserSettingRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userId || !req.key) {
    return Response.json(
      { error: "userId and key are required" },
      { status: 400 }
    );
  }

  const result = await db
    .prepare(`SELECT value FROM user_settings WHERE user_id = ? AND key = ?`)
    .bind(req.userId, req.key)
    .first<{ value: string }>();

  return Response.json({ result: result?.value ?? null });
}

async function handleGetAllUserSettings(
  req: GetAllUserSettingsRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userId) {
    return Response.json({ error: "userId is required" }, { status: 400 });
  }

  const results = await db
    .prepare(`SELECT key, value FROM user_settings WHERE user_id = ? ORDER BY key ASC`)
    .bind(req.userId)
    .all<UserSettingRow>();

  return Response.json({ result: results.results });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handleSettingsRpc(
  request: SettingsRpcRequest,
  db: D1Database
): Promise<Response> {
  switch (request.method) {
    case "settings.getApp":
      return handleGetAppSetting(request, db);
    case "settings.getAllApp":
      return handleGetAllAppSettings(db);
    case "settings.getUser":
      return handleGetUserSetting(request, db);
    case "settings.getAllUser":
      return handleGetAllUserSettings(request, db);
    default:
      return Response.json(
        { error: `Unknown settings method: ${(request as { method: string }).method}` },
        { status: 400 }
      );
  }
}
