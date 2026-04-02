/**
 * GET/PUT /api/admin/settings — admin-only app settings management.
 *
 * - GET → list all app_settings rows
 * - PUT → upsert a setting (requires `key` and `value`)
 */

import { NextResponse } from "next/server";
import { resolveAdmin } from "@/lib/admin";
import { getDbRead, getDbWrite } from "@/lib/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SettingRow {
  key: string;
  value: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// GET — list all settings
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const admin = await resolveAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const dbRead = await getDbRead();

  try {
    const { results } = await dbRead.query<SettingRow>(
      "SELECT key, value, updated_at FROM app_settings ORDER BY key ASC",
    );
    return NextResponse.json({ settings: results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("no such table")) {
      return NextResponse.json({ settings: [] });
    }
    console.error("Failed to load settings:", err);
    return NextResponse.json(
      { error: "Failed to load settings" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// PUT — upsert a setting
// ---------------------------------------------------------------------------

export async function PUT(request: Request) {
  const admin = await resolveAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { key, value } = body;
  if (typeof key !== "string" || key.length === 0) {
    return NextResponse.json(
      { error: "key is required (non-empty string)" },
      { status: 400 },
    );
  }
  if (typeof value !== "string") {
    return NextResponse.json(
      { error: "value is required (string)" },
      { status: 400 },
    );
  }

  // ---------------------------------------------------------------------------
  // Per-key semantic validation
  // ---------------------------------------------------------------------------

  if (key === "max_team_members") {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || String(parsed) !== value) {
      return NextResponse.json(
        { error: "max_team_members must be a positive integer" },
        { status: 400 },
      );
    }
  }

  if (key === "require_invite_code") {
    if (value !== "true" && value !== "false") {
      return NextResponse.json(
        { error: "require_invite_code must be 'true' or 'false'" },
        { status: 400 },
      );
    }
  }

  const dbWrite = await getDbWrite();

  try {
    await dbWrite.execute(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, value],
    );
    return NextResponse.json({ key, value });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("no such table")) {
      return NextResponse.json(
        { error: "Settings not available — database migration pending" },
        { status: 503 },
      );
    }
    console.error("Failed to update setting:", err);
    return NextResponse.json(
      { error: "Failed to update setting" },
      { status: 500 },
    );
  }
}
