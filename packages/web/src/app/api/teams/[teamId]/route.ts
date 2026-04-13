/**
 * GET /api/teams/[teamId] — get team details.
 * DELETE /api/teams/[teamId] — leave team (or delete if owner and only member).
 */

import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth-helpers";

import { getDbRead, getDbWrite } from "@/lib/db";
import { deleteTeamLogoByUrl } from "@/lib/r2";
import { syncSeasonRosters } from "@/lib/season-roster";

// ---------------------------------------------------------------------------
// GET — team details with members
// ---------------------------------------------------------------------------

export async function GET(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const authResult = await resolveUser(request);
  if (!authResult) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { teamId } = await params;

  try {
    const dbRead = await getDbRead();

    // Check membership
    const role = await dbRead.getTeamMembership(teamId, authResult.userId);

    if (!role) {
      return NextResponse.json({ error: "Not a member" }, { status: 403 });
    }

    // Get team details
    const team = await dbRead.getTeamById(teamId);

    if (!team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    // Get members
    const members = await dbRead.getTeamMembers(teamId);

    // Fetch season registrations for this team (graceful if table missing)
    let registeredSeasonIds: string[] = [];
    try {
      registeredSeasonIds = await dbRead.getTeamSeasonRegistrations(teamId);
    } catch (regErr) {
      const regMsg = regErr instanceof Error ? regErr.message : "";
      if (!regMsg.includes("no such table")) {
        console.error("Failed to query season registrations:", regErr);
      }
      // Gracefully degrade — season tables may not exist yet
    }

    const { logo_url, ...teamRest } = team;
    return NextResponse.json({
      ...teamRest,
      logoUrl: logo_url ?? null,
      auto_register_season: !!team.auto_register_season,
      role,
      members: members.map((m) => ({
        userId: m.user_id,
        name: m.nickname ?? m.name,
        slug: m.slug,
        image: m.image,
        role: m.role,
        joinedAt: m.joined_at,
      })),
      registered_season_ids: registeredSeasonIds,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("no such table")) {
      return NextResponse.json(
        { error: "Teams feature not available yet — database migration pending" },
        { status: 503 },
      );
    }
    console.error("Failed to get team details:", err);
    return NextResponse.json({ error: "Failed to load team" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH — rename team (owner only)
// ---------------------------------------------------------------------------

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const authResult = await resolveUser(request);
  if (!authResult) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { teamId } = await params;

  let name: string | undefined;
  let autoRegisterSeason: boolean | undefined;
  try {
    const body = await request.json();
    name = typeof body.name === "string" ? body.name.trim() : undefined;
    autoRegisterSeason = typeof body.auto_register_season === "boolean" ? body.auto_register_season : undefined;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (name !== undefined && (!name || name.length > 64)) {
    return NextResponse.json(
      { error: "Team name is required (max 64 characters)" },
      { status: 400 },
    );
  }

  if (name === undefined && autoRegisterSeason === undefined) {
    return NextResponse.json(
      { error: "No valid fields to update" },
      { status: 400 },
    );
  }

  try {
    const dbRead = await getDbRead();

    // Only the owner can rename
    const dbWrite = await getDbWrite();
    const role = await dbRead.getTeamMembership(teamId, authResult.userId);

    if (!role) {
      return NextResponse.json({ error: "Not a member" }, { status: 403 });
    }
    if (role !== "owner") {
      return NextResponse.json({ error: "Only the team owner can update settings" }, { status: 403 });
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    if (name !== undefined) {
      updates.push("name = ?");
      values.push(name);
    }

    if (autoRegisterSeason !== undefined) {
      updates.push("auto_register_season = ?");
      values.push(autoRegisterSeason ? 1 : 0);
    }

    values.push(teamId);
    try {
      await dbWrite.execute(
        `UPDATE teams SET ${updates.join(", ")} WHERE id = ?`,
        values,
      );
    } catch (updateErr) {
      const updateMsg = updateErr instanceof Error ? updateErr.message : "";
      if (updateMsg.includes("no such column") && autoRegisterSeason !== undefined) {
        // Migration 016 not applied yet — auto_register_season column doesn't exist
        return NextResponse.json(
          { error: "Auto-registration feature not available yet (database migration pending)" },
          { status: 503 },
        );
      }
      throw updateErr;
    }

    // Only return fields that were actually updated
    const response: Record<string, unknown> = { ok: true };
    if (name !== undefined) response.name = name;
    if (autoRegisterSeason !== undefined) response.auto_register_season = autoRegisterSeason;
    return NextResponse.json(response);
  } catch (err) {
    console.error("Failed to rename team:", err);
    return NextResponse.json({ error: "Failed to rename team" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE — leave team
// ---------------------------------------------------------------------------

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const authResult = await resolveUser(request);
  if (!authResult) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { teamId } = await params;

  try {
    const dbRead = await getDbRead();
    const dbWrite = await getDbWrite();

    // Check membership
    const role = await dbRead.getTeamMembership(teamId, authResult.userId);

    if (!role) {
      return NextResponse.json({ error: "Not a member" }, { status: 403 });
    }

    // Count remaining members
    const memberCount = await dbRead.countTeamMembers(teamId);

    if (role === "owner" && memberCount > 1) {
      return NextResponse.json(
        { error: "Transfer ownership before leaving (not yet supported — remove other members first)" },
        { status: 400 },
      );
    }

    // Remove membership
    await dbWrite.execute(
      "DELETE FROM team_members WHERE team_id = ? AND user_id = ?",
      [teamId, authResult.userId],
    );

    // Sync season rosters if any active season allows roster changes
    try {
      await syncSeasonRosters(dbRead, dbWrite, teamId);
    } catch (err) {
      console.error("Failed to sync season rosters after leave:", err);
    }

    // If last member, delete the team and its logo
    if (memberCount <= 1) {
      // Read logo URL before deleting
      const logoUrl = await dbRead.getTeamLogoUrl(teamId);

      // Clean up season_teams before deleting team
      // NOTE: season_roster_snapshots are preserved for historical leaderboard data
      await dbWrite.batch([
        { sql: "DELETE FROM season_teams WHERE team_id = ?", params: [teamId] },
        { sql: "DELETE FROM teams WHERE id = ?", params: [teamId] },
      ]);

      // Best-effort logo cleanup — don't fail the request if R2 is unavailable
      if (logoUrl) {
        try {
          await deleteTeamLogoByUrl(logoUrl);
        } catch {
          // Silently ignore — orphaned R2 object is harmless
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("no such table")) {
      return NextResponse.json(
        { error: "Teams feature not available yet — database migration pending" },
        { status: 503 },
      );
    }
    console.error("Failed to leave team:", err);
    return NextResponse.json({ error: "Failed to leave team" }, { status: 500 });
  }
}
