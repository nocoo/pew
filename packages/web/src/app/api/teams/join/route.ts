/**
 * POST /api/teams/join — join a team by invite code.
 */

import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth-helpers";
import { getD1Client } from "@/lib/d1";
import { syncSeasonRosters } from "@/lib/season-roster";

export async function POST(request: Request) {
  const authResult = await resolveUser(request);
  if (!authResult) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const inviteCode = body.invite_code;
  if (typeof inviteCode !== "string" || inviteCode.length === 0) {
    return NextResponse.json(
      { error: "invite_code is required" },
      { status: 400 },
    );
  }

  try {
    const client = getD1Client();

    // Find team by invite code
    const team = await client.firstOrNull<{ id: string; name: string; slug: string }>(
      "SELECT id, name, slug FROM teams WHERE invite_code = ?",
      [inviteCode],
    );

    if (!team) {
      return NextResponse.json(
        { error: "Invalid invite code" },
        { status: 404 },
      );
    }

    // Check if already a member
    const existing = await client.firstOrNull<{ id: string }>(
      "SELECT id FROM team_members WHERE team_id = ? AND user_id = ?",
      [team.id, authResult.userId],
    );

    if (existing) {
      return NextResponse.json(
        { error: "Already a member of this team" },
        { status: 409 },
      );
    }

    // Enforce team member limit from app_settings (default: 5)
    const DEFAULT_MAX_TEAM_MEMBERS = 5;
    let maxMembers = DEFAULT_MAX_TEAM_MEMBERS;
    try {
      const setting = await client.firstOrNull<{ value: string }>(
        "SELECT value FROM app_settings WHERE key = 'max_team_members'",
        [],
      );
      if (setting) {
        const parsed = parseInt(setting.value, 10);
        if (!isNaN(parsed) && parsed > 0) maxMembers = parsed;
      }
    } catch {
      // Settings table may not exist yet — use default
    }

    // Atomic check+insert: INSERT only if team is under the member limit.
    // This prevents race conditions where concurrent joins both pass a
    // separate COUNT check and both INSERT, exceeding the limit.
    const result = await client.execute(
      `INSERT INTO team_members (id, team_id, user_id, role, joined_at)
       SELECT ?, ?, ?, 'member', datetime('now')
       WHERE (SELECT COUNT(*) FROM team_members WHERE team_id = ?) < ?`,
      [crypto.randomUUID(), team.id, authResult.userId, team.id, maxMembers],
    );

    if (result.changes === 0) {
      return NextResponse.json(
        { error: `Team is full (max ${maxMembers} members)` },
        { status: 403 },
      );
    }

    // Sync season rosters if any active season allows roster changes
    try {
      await syncSeasonRosters(client, team.id);
    } catch (err) {
      console.error("Failed to sync season rosters after join:", err);
    }

    return NextResponse.json({
      team_id: team.id,
      team_name: team.name,
      team_slug: team.slug,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("no such table")) {
      return NextResponse.json(
        { error: "Teams feature not available yet — database migration pending" },
        { status: 503 },
      );
    }
    console.error("Failed to join team:", err);
    return NextResponse.json({ error: "Failed to join team" }, { status: 500 });
  }
}
