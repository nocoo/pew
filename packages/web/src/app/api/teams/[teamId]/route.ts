/**
 * GET /api/teams/[teamId] — get team details.
 * DELETE /api/teams/[teamId] — leave team (or delete if owner and only member).
 */

import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth-helpers";
import { getD1Client } from "@/lib/d1";
import { deleteTeamLogoByUrl } from "@/lib/r2";

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
    const client = getD1Client();

    // Check membership
    const membership = await client.firstOrNull<{ role: string }>(
      "SELECT role FROM team_members WHERE team_id = ? AND user_id = ?",
      [teamId, authResult.userId],
    );

    if (!membership) {
      return NextResponse.json({ error: "Not a member" }, { status: 403 });
    }

    // Get team details
    const team = await client.firstOrNull<{
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
      members = await client.query<{
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
        const fallback = await client.query<{
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
    const client = getD1Client();

    // Check membership
    const membership = await client.firstOrNull<{ role: string }>(
      "SELECT role FROM team_members WHERE team_id = ? AND user_id = ?",
      [teamId, authResult.userId],
    );

    if (!membership) {
      return NextResponse.json({ error: "Not a member" }, { status: 403 });
    }

    // Count remaining members
    const countRow = await client.firstOrNull<{ cnt: number }>(
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
    await client.execute(
      "DELETE FROM team_members WHERE team_id = ? AND user_id = ?",
      [teamId, authResult.userId],
    );

    // If last member, delete the team and its logo
    if (memberCount <= 1) {
      // Read logo URL before deleting
      const team = await client.firstOrNull<{ logo_url: string | null }>(
        "SELECT logo_url FROM teams WHERE id = ?",
        [teamId],
      );

      await client.execute("DELETE FROM teams WHERE id = ?", [teamId]);

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
