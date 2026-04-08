/**
 * POST /api/organizations/[orgId]/join — join an organization.
 *
 * Requires authentication. Users can freely join any organization.
 */

import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth-helpers";
import { getDbRead, getDbWrite } from "@/lib/db";

export async function POST(
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
    const org = await dbRead.firstOrNull<{ id: string; name: string; slug: string }>(
      "SELECT id, name, slug FROM organizations WHERE id = ?",
      [orgId]
    );

    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    // Check if already a member
    const existing = await dbRead.firstOrNull<{ id: string }>(
      "SELECT id FROM organization_members WHERE org_id = ? AND user_id = ?",
      [orgId, authResult.userId]
    );

    if (existing) {
      return NextResponse.json(
        { error: "Already a member of this organization" },
        { status: 409 }
      );
    }

    // Add member
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await dbWrite.execute(
      `INSERT INTO organization_members (id, org_id, user_id, joined_at)
       VALUES (?, ?, ?, ?)`,
      [id, orgId, authResult.userId, now]
    );

    return NextResponse.json({
      orgId: org.id,
      orgName: org.name,
      orgSlug: org.slug,
    }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("no such table")) {
      return NextResponse.json(
        { error: "Organization tables not yet migrated" },
        { status: 503 }
      );
    }
    console.error("Failed to join organization:", err);
    return NextResponse.json(
      { error: "Failed to join organization" },
      { status: 500 }
    );
  }
}
