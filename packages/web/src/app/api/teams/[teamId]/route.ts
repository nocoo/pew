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
    const membership = await dbRead.firstOrNull<{ role: string }>(
      "SELECT role FROM team_members WHERE team_id = ? AND user_id = ?",
      [teamId, authResult.userId],
    );

    if (!membership) {
      return NextResponse.json({ error: "Not a member" }, { status: 403 });
    }

    // Get team details
    const team = await dbRead.firstOrNull<{
      id: string;
      name: string;
      slug: string;
      invite_code: string;
      created_at: string;
      logo_url: string | null;
    }>(
      "SELECT id, name, slug, invite_code, created_at, logo_url FROM teams WHERE id = ?",
      [teamId],
    );

    if (!team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    // Get members — try with nickname, fall back without
    let members: { results: { user_id: string; name: string | null; nickname: string | null; image: string | null; role: string; joined_at: string }[] };
    try {
      members = await dbRead.query<{
        user_id: string;
        name: string | null;
        nickname: string | null;
        image: string | null;
        role: string;
        joined_at: string;
      }>(
        `SELECT tm.user_id, u.name, u.nickname, u.image, tm.role, tm.joined_at
         FROM team_members tm
         JOIN users u ON u.id = tm.user_id
         WHERE tm.team_id = ?
         ORDER BY tm.joined_at ASC`,
        [teamId],
      );
    } catch (innerErr) {
      const innerMsg = innerErr instanceof Error ? innerErr.message : "";
      if (innerMsg.includes("no such column")) {
        const fallback = await dbRead.query<{
          user_id: string;
          name: string | null;
          image: string | null;
          role: string;
          joined_at: string;
        }>(
          `SELECT tm.user_id, u.name, u.image, tm.role, tm.joined_at
           FROM team_members tm
           JOIN users u ON u.id = tm.user_id
           WHERE tm.team_id = ?
           ORDER BY tm.joined_at ASC`,
          [teamId],
        );
        members = {
          results: fallback.results.map((m) => ({ ...m, nickname: null })),
        };
      } else {
        throw innerErr;
      }
    }

    // Fetch season registrations for this team (graceful if table missing)
    let registeredSeasonIds: string[] = [];
    try {
      const regResult = await dbRead.query<{ season_id: string }>(
        "SELECT season_id FROM season_teams WHERE team_id = ?",
        [teamId],
      );
      registeredSeasonIds = regResult.results.map((r) => r.season_id);
    } catch (regErr) {
      const regMsg = regErr instanceof Error ? regErr.message : "";
      if (!regMsg.includes("no such table")) {
        console.error("Failed to query season registrations:", regErr);
      }
      // Gracefully degrade — season tables may not exist yet
    }

    return NextResponse.json({
      ...team,
      logo_url: team.logo_url ?? null,
      role: membership.role,
      members: members.results.map((m) => ({
        userId: m.user_id,
        name: m.nickname ?? m.name,
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

  let name: string;
  try {
    const body = await request.json();
    name = typeof body.name === "string" ? body.name.trim() : "";
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!name || name.length > 64) {
    return NextResponse.json(
      { error: "Team name is required (max 64 characters)" },
      { status: 400 },
    );
  }

  try {
    const dbRead = await getDbRead();

    // Only the owner can rename
    const dbWrite = await getDbWrite();
    const membership = await dbRead.firstOrNull<{ role: string }>(
      "SELECT role FROM team_members WHERE team_id = ? AND user_id = ?",
      [teamId, authResult.userId],
    );

    if (!membership) {
      return NextResponse.json({ error: "Not a member" }, { status: 403 });
    }
    if (membership.role !== "owner") {
      return NextResponse.json({ error: "Only the team owner can rename" }, { status: 403 });
    }

    await dbWrite.execute("UPDATE teams SET name = ? WHERE id = ?", [name, teamId]);

    return NextResponse.json({ ok: true, name });
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
    const membership = await dbRead.firstOrNull<{ role: string }>(
      "SELECT role FROM team_members WHERE team_id = ? AND user_id = ?",
      [teamId, authResult.userId],
    );

    if (!membership) {
      return NextResponse.json({ error: "Not a member" }, { status: 403 });
    }

    // Count remaining members
    const countRow = await dbRead.firstOrNull<{ cnt: number }>(
      "SELECT COUNT(*) AS cnt FROM team_members WHERE team_id = ?",
      [teamId],
    );
    const memberCount = countRow?.cnt ?? 0;

    if (membership.role === "owner" && memberCount > 1) {
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
      const team = await dbRead.firstOrNull<{ logo_url: string | null }>(
        "SELECT logo_url FROM teams WHERE id = ?",
        [teamId],
      );

      await dbWrite.execute("DELETE FROM teams WHERE id = ?", [teamId]);

      // Best-effort logo cleanup — don't fail the request if R2 is unavailable
      if (team?.logo_url) {
        try {
          await deleteTeamLogoByUrl(team.logo_url);
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
