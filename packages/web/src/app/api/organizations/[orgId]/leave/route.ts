/**
 * DELETE /api/organizations/[orgId]/leave — leave an organization.
 *
 * Requires authentication. Users can freely leave any organization they belong to.
 */

import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth-helpers";
import { getDbRead, getDbWrite } from "@/lib/db";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const authResult = await resolveUser(request);
  if (!authResult) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { orgId } = await params;
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

    // Check if user is a member
    const membership = await dbRead.firstOrNull<{ id: string }>(
      "SELECT id FROM organization_members WHERE org_id = ? AND user_id = ?",
      [orgId, authResult.userId]
    );

    if (!membership) {
      return NextResponse.json(
        { error: "Not a member of this organization" },
        { status: 404 }
      );
    }

    // Remove member
    await dbWrite.execute(
      "DELETE FROM organization_members WHERE org_id = ? AND user_id = ?",
      [orgId, authResult.userId]
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
    console.error("Failed to leave organization:", err);
    return NextResponse.json(
      { error: "Failed to leave organization" },
      { status: 500 }
    );
  }
}
