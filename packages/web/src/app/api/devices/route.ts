/**
 * GET /api/devices — list all devices for the authenticated user.
 * PUT /api/devices — upsert a device alias.
 * DELETE /api/devices — delete a device alias (only if it has zero usage records).
 */

import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth-helpers";
import { unauthorizedResponse } from "@/lib/api-responses";
import { getDbRead, getDbWrite } from "@/lib/db";

// ---------------------------------------------------------------------------
// GET /api/devices
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const authResult = await resolveUser(request);
  if (!authResult) {
    return unauthorizedResponse();
  }
  const userId = authResult.userId;

  const dbRead = await getDbRead();

  try {
    const results = await dbRead.listDevices(userId);

    const devices = results.map((row) => ({
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
    return unauthorizedResponse();
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

  const dbRead = await getDbRead();
  const dbWrite = await getDbWrite();

  try {
    // 1. Verify device exists in user's usage_records OR device_aliases
    const deviceExists = await dbRead.checkDeviceExists(userId, deviceId);

    if (!deviceExists) {
      return NextResponse.json(
        { error: "device_id not found" },
        { status: 400 }
      );
    }

    // 2. Check for duplicate alias (case-insensitive, different device)
    const duplicate = await dbRead.checkDuplicateDeviceAlias(userId, alias, deviceId);

    if (duplicate) {
      return NextResponse.json(
        { error: "Alias already in use by another device" },
        { status: 409 }
      );
    }

    // 3. Upsert alias
    await dbWrite.execute(
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
    return unauthorizedResponse();
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

  const dbRead = await getDbRead();
  const dbWrite = await getDbWrite();

  try {
    // 1. Ensure device has zero usage records — refuse to delete otherwise
    const hasRecords = await dbRead.checkDeviceHasRecords(userId, deviceId);

    if (hasRecords) {
      return NextResponse.json(
        { error: "Cannot delete a device that has usage records" },
        { status: 409 }
      );
    }

    // 2. Delete the alias row
    await dbWrite.execute(
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
