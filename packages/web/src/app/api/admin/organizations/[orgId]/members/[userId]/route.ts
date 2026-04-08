/**
 * DELETE /api/admin/organizations/[orgId]/members/[userId] — remove member (admin only).
 */

import { NextResponse } from "next/server";
import { resolveAdmin } from "@/lib/admin";
import { getDbRead, getDbWrite } from "@/lib/db";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ orgId: string; userId: string }> }
) {
  const admin = await resolveAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { orgId, userId } = await params;
  const dbRead = await getDbRead();
  const dbWrite = await getDbWrite();

  try {
    // Verify org exists
    const org = await dbRead.firstOrNull<{ id: string }>(
      "SELECT id FROM organizations WHERE id = ?",
      [orgId]
    );

    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    // Verify membership exists
    const membership = await dbRead.firstOrNull<{ id: string }>(
      "SELECT id FROM organization_members WHERE org_id = ? AND user_id = ?",
      [orgId, userId]
    );

    if (!membership) {
      return NextResponse.json({ error: "User is not a member" }, { status: 404 });
    }

    // Remove member
    await dbWrite.execute(
      "DELETE FROM organization_members WHERE org_id = ? AND user_id = ?",
      [orgId, userId]
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("no such table")) {
      return NextResponse.json(
        { error: "Organization tables not yet migrated" },
        { status: 503 }
      );
    }
    console.error("Failed to remove organization member:", err);
    return NextResponse.json(
      { error: "Failed to remove member" },
      { status: 500 }
    );
  }
}
