/**
 * GET /api/devices — list all devices for the authenticated user.
 * PUT /api/devices — upsert a device alias.
 * DELETE /api/devices — delete a device alias (only if it has zero usage records).
 */

import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth-helpers";
import { getD1Client } from "@/lib/d1";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DeviceRow {
  device_id: string;
  alias: string | null;
  first_seen: string | null;
  last_seen: string | null;
  total_tokens: number;
  sources: string | null; // GROUP_CONCAT result
  model_count: number;
}

// ---------------------------------------------------------------------------
// GET /api/devices
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const authResult = await resolveUser(request);
  if (!authResult) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = authResult.userId;

  const client = getD1Client();

  try {
    // Use a UNION to include devices that only exist in device_aliases
    // (i.e. user set an alias but device has no usage records yet/anymore).
    const result = await client.query<DeviceRow>(
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
      ORDER BY d.total_tokens DESC, d.device_id`,
      [userId, userId, userId, userId]
    );

    const devices = result.results.map((row) => ({
      device_id: row.device_id,
      alias: row.alias,
      first_seen: row.first_seen ?? null,
      last_seen: row.last_seen ?? null,
      total_tokens: row.total_tokens ?? 0,
      sources: row.sources ? row.sources.split(",") : [],
      model_count: row.model_count ?? 0,
    }));

    return NextResponse.json({ devices });
  } catch (err) {
    console.error("Failed to query devices:", err);
    return NextResponse.json(
      { error: "Failed to query devices" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// PUT /api/devices
// ---------------------------------------------------------------------------

export async function PUT(request: Request) {
  const authResult = await resolveUser(request);
  if (!authResult) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = authResult.userId;

  let body: { device_id?: string; alias?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate device_id
  const deviceId = body.device_id;
  if (!deviceId || typeof deviceId !== "string" || !deviceId.trim()) {
    return NextResponse.json(
      { error: "device_id is required" },
      { status: 400 }
    );
  }

  // Validate alias
  const alias = typeof body.alias === "string" ? body.alias.trim() : "";
  if (!alias) {
    return NextResponse.json(
      { error: "alias must be a non-empty string" },
      { status: 400 }
    );
  }
  if (alias.length > 50) {
    return NextResponse.json(
      { error: "alias must be 50 characters or fewer" },
      { status: 400 }
    );
  }

  const client = getD1Client();

  try {
    // 1. Verify device exists in user's usage_records OR device_aliases
    const deviceExists = await client.firstOrNull<{ device_id: string }>(
      `SELECT device_id FROM (
        SELECT DISTINCT device_id FROM usage_records
        WHERE user_id = ? AND device_id = ?
        UNION
        SELECT device_id FROM device_aliases
        WHERE user_id = ? AND device_id = ?
      ) LIMIT 1`,
      [userId, deviceId, userId, deviceId]
    );

    if (!deviceExists) {
      return NextResponse.json(
        { error: "device_id not found" },
        { status: 400 }
      );
    }

    // 2. Check for duplicate alias (case-insensitive, different device)
    const duplicate = await client.firstOrNull<{ device_id: string }>(
      `SELECT device_id FROM device_aliases
       WHERE user_id = ? AND LOWER(TRIM(alias)) = LOWER(TRIM(?)) AND device_id != ?
       LIMIT 1`,
      [userId, alias, deviceId]
    );

    if (duplicate) {
      return NextResponse.json(
        { error: "Alias already in use by another device" },
        { status: 409 }
      );
    }

    // 3. Upsert alias
    await client.execute(
      `INSERT INTO device_aliases (user_id, device_id, alias, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT (user_id, device_id) DO UPDATE
         SET alias = excluded.alias, updated_at = excluded.updated_at`,
      [userId, deviceId, alias]
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Failed to update device alias:", err);
    return NextResponse.json(
      { error: "Failed to update device alias" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/devices
// ---------------------------------------------------------------------------

export async function DELETE(request: Request) {
  const authResult = await resolveUser(request);
  if (!authResult) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = authResult.userId;

  let body: { device_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const deviceId = body.device_id;
  if (!deviceId || typeof deviceId !== "string" || !deviceId.trim()) {
    return NextResponse.json(
      { error: "device_id is required" },
      { status: 400 }
    );
  }

  const client = getD1Client();

  try {
    // 1. Ensure device has zero usage records — refuse to delete otherwise
    const hasRecords = await client.firstOrNull<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM usage_records
       WHERE user_id = ? AND device_id = ?`,
      [userId, deviceId]
    );

    if (hasRecords && hasRecords.cnt > 0) {
      return NextResponse.json(
        { error: "Cannot delete a device that has usage records" },
        { status: 409 }
      );
    }

    // 2. Delete the alias row
    await client.execute(
      `DELETE FROM device_aliases WHERE user_id = ? AND device_id = ?`,
      [userId, deviceId]
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Failed to delete device:", err);
    return NextResponse.json(
      { error: "Failed to delete device" },
      { status: 500 }
    );
  }
}
