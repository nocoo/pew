/**
 * PATCH /api/admin/seasons/[seasonId] — update a season.
 *
 * - upcoming: can modify name, slug, start_date, end_date
 * - active/ended: can only modify name
 */

import { NextResponse } from "next/server";
import { resolveAdmin } from "@/lib/admin";
import { getDbRead, getDbWrite } from "@/lib/db";
import { deriveSeasonStatus } from "@/lib/seasons";
import { syncAllRostersForSeason } from "@/lib/season-roster";

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z$/;

function isValidDatetime(s: string): boolean {
  if (!DATETIME_RE.test(s)) return false;
  const d = new Date(s);
  return !isNaN(d.getTime());
}

// ---------------------------------------------------------------------------
// PATCH — update season
// ---------------------------------------------------------------------------

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ seasonId: string }> }
) {
  const admin = await resolveAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { seasonId } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const dbRead = await getDbRead();
  const dbWrite = await getDbWrite();

  try {
    // Fetch existing season
    const season = await dbRead.getSeasonById(seasonId);

    if (!season) {
      return NextResponse.json({ error: "Season not found" }, { status: 404 });
    }

    const status = deriveSeasonStatus(season.start_date, season.end_date);

    // Build update fields
    const updates: string[] = [];
    const values: unknown[] = [];

    // Name — always allowed
    if (body.name !== undefined) {
      const name = body.name as string;
      if (typeof name !== "string" || name.length < 1 || name.length > 64) {
        return NextResponse.json(
          { error: "name must be 1-64 characters" },
          { status: 400 }
        );
      }
      updates.push("name = ?");
      values.push(name);
    }

    // Date fields — only for upcoming seasons
    if (body.start_date !== undefined) {
      if (status !== "upcoming") {
        return NextResponse.json(
          { error: "Cannot modify dates of active or ended season" },
          { status: 400 }
        );
      }
      const sd = body.start_date as string;
      if (typeof sd !== "string" || !isValidDatetime(sd)) {
        return NextResponse.json(
          { error: "start_date must be ISO 8601 UTC format (YYYY-MM-DDTHH:mmZ)" },
          { status: 400 }
        );
      }
      updates.push("start_date = ?");
      values.push(sd);
    }

    if (body.end_date !== undefined) {
      if (status !== "upcoming") {
        return NextResponse.json(
          { error: "Cannot modify dates of active or ended season" },
          { status: 400 }
        );
      }
      const ed = body.end_date as string;
      if (typeof ed !== "string" || !isValidDatetime(ed)) {
        return NextResponse.json(
          { error: "end_date must be ISO 8601 UTC format (YYYY-MM-DDTHH:mmZ)" },
          { status: 400 }
        );
      }
      updates.push("end_date = ?");
      values.push(ed);
    }

    // Validate end_date >= start_date after applying updates
    const finalStartDate =
      (values[updates.indexOf("start_date = ?")] as string) ?? season.start_date;
    const finalEndDate =
      (values[updates.indexOf("end_date = ?")] as string) ?? season.end_date;
    if (new Date(finalEndDate).getTime() < new Date(finalStartDate).getTime()) {
      return NextResponse.json(
        { error: "end_date must be >= start_date" },
        { status: 400 }
      );
    }

    // Toggle flags — always allowed regardless of status
    if (body.allow_late_registration !== undefined) {
      updates.push("allow_late_registration = ?");
      values.push(body.allow_late_registration ? 1 : 0);
    }
    if (body.allow_roster_changes !== undefined) {
      updates.push("allow_roster_changes = ?");
      values.push(body.allow_roster_changes ? 1 : 0);
    }
    if (body.allow_late_withdrawal !== undefined) {
      updates.push("allow_late_withdrawal = ?");
      values.push(body.allow_late_withdrawal ? 1 : 0);
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    updates.push("updated_at = datetime('now')");
    values.push(seasonId);

    await dbWrite.execute(
      `UPDATE seasons SET ${updates.join(", ")} WHERE id = ?`,
      values
    );

    // Auto-backfill rosters when allow_roster_changes flips 0→1 on an active season.
    // Use post-update dates so a single PATCH that transitions upcoming→active
    // AND enables roster changes will still trigger backfill.
    const wasRosterOff = season.allow_roster_changes === 0;
    const isRosterOn = body.allow_roster_changes === true;
    if (wasRosterOff && isRosterOn) {
      const finalStatus = deriveSeasonStatus(finalStartDate, finalEndDate);
      if (finalStatus === "active") {
        await syncAllRostersForSeason(dbRead, dbWrite, seasonId);
      }
    }

    await dbRead.invalidateCacheKey("seasons:list");

    // Return updated season
    const updated = await dbRead.getSeasonById(seasonId);
    if (!updated) {
      return NextResponse.json(
        { error: "Season not found after update" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      start_date: updated.start_date,
      end_date: updated.end_date,
      created_at: updated.created_at,
      updated_at: updated.updated_at,
      status: deriveSeasonStatus(updated.start_date, updated.end_date),
      allow_late_registration: !!updated.allow_late_registration,
      allow_roster_changes: !!updated.allow_roster_changes,
      allow_late_withdrawal: !!updated.allow_late_withdrawal,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("no such table")) {
      return NextResponse.json(
        { error: "Season tables not yet migrated" },
        { status: 503 }
      );
    }
    console.error("Failed to update season:", err);
    return NextResponse.json(
      { error: "Failed to update season" },
      { status: 500 }
    );
  }
}
