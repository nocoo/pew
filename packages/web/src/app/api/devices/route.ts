/**
 * GET /api/devices — list all devices for the authenticated user.
 * PUT /api/devices — upsert a device alias.
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
  first_seen: string;
  last_seen: string;
  total_tokens: number;
  sources: string; // GROUP_CONCAT result
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
    const result = await client.query<DeviceRow>(
      `SELECT
        ur.device_id,
        da.alias,
        MIN(ur.hour_start) AS first_seen,
        MAX(ur.hour_start) AS last_seen,
        SUM(ur.total_tokens) AS total_tokens,
        GROUP_CONCAT(DISTINCT ur.source) AS sources,
        COUNT(DISTINCT ur.model) AS model_count
      FROM usage_records ur
      LEFT JOIN device_aliases da
        ON da.user_id = ur.user_id AND da.device_id = ur.device_id
      WHERE ur.user_id = ?
      GROUP BY ur.device_id
      ORDER BY total_tokens DESC`,
      [userId]
    );

    const devices = result.results.map((row) => ({
      device_id: row.device_id,
      alias: row.alias,
      first_seen: row.first_seen,
      last_seen: row.last_seen,
      total_tokens: row.total_tokens,
      sources: row.sources ? row.sources.split(",") : [],
      model_count: row.model_count,
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
    // 1. Verify device exists in user's usage_records
    const deviceExists = await client.firstOrNull<{ device_id: string }>(
      `SELECT DISTINCT device_id FROM usage_records
       WHERE user_id = ? AND device_id = ?
       LIMIT 1`,
      [userId, deviceId]
    );

    if (!deviceExists) {
      return NextResponse.json(
        { error: "device_id not found in your usage records" },
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
