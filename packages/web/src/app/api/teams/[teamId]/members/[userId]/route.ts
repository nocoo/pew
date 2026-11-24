/**
 * DELETE /api/teams/[teamId]/members/[userId] — kick a member (owner only).
 */

import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth-helpers";
import { getDbRead, getDbWrite } from "@/lib/db";
import { syncSeasonRosters } from "@/lib/season-roster";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ teamId: string; userId: string }> },
) {
  const authResult = await resolveUser(request);
  if (!authResult) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { teamId, userId: targetUserId } = await params;

  // Cannot kick yourself — use the leave endpoint instead
  if (targetUserId === authResult.userId) {
    return NextResponse.json(
      { error: "Use the leave endpoint to remove yourself" },
      { status: 400 },
    );
  }

  try {
    const dbRead = await getDbRead();
    const dbWrite = await getDbWrite();

    // Only the owner can kick members
    const role = await dbRead.getTeamMembership(teamId, authResult.userId);

    if (!role) {
      return NextResponse.json({ error: "Not a member" }, { status: 403 });
    }
    if (role !== "owner") {
      return NextResponse.json(
        { error: "Only the team owner can remove members" },
        { status: 403 },
      );
    }

    // Verify the target is actually a member
    const targetIsMember = await dbRead.checkTeamMembershipExists(teamId, targetUserId);

    if (!targetIsMember) {
      return NextResponse.json({ error: "User is not a member" }, { status: 404 });
    }

    // Remove the member
    await dbWrite.execute("DELETE FROM team_members WHERE team_id = ? AND user_id = ?", [
      teamId,
      targetUserId,
    ]);

    // Sync season rosters if any active season allows roster changes
    try {
      await syncSeasonRosters(dbRead, dbWrite, teamId);
    } catch (err) {
      console.error("Failed to sync season rosters after kick:", err);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to kick member:", err);
    return NextResponse.json({ error: "Failed to remove member" }, { status: 500 });
  }
}
