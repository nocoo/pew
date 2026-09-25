/**
 * GET /api/organizations/[orgId]/members — list members of an organization.
 *
 * Requires authentication. Any logged-in user can view any org's member list.
 */

import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth-helpers";
import { unauthorizedResponse } from "@/lib/api-responses";
import { getDbRead } from "@/lib/db";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const authResult = await resolveUser(request);
  if (!authResult) {
    return unauthorizedResponse();
  }

  const { orgId } = await params;
  const dbRead = await getDbRead();

  try {
    // Verify org exists
    const org = await dbRead.getOrganizationById(orgId);

    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    // Get members with user details (no email)
    const results = await dbRead.listOrgMembers(orgId);

    const members = results.map((r) => ({
      id: r.id,
      orgId: r.org_id,
      userId: r.user_id,
      joinedAt: r.joined_at,
      user: {
        id: r.user_id,
        name: r.name,
        image: r.image,
        slug: r.slug,
      },
    }));

    return NextResponse.json({ members });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("no such table")) {
      return NextResponse.json(
        { error: "Organization tables not yet migrated" },
        { status: 503 }
      );
    }
    console.error("Failed to list organization members:", err);
    return NextResponse.json(
      { error: "Failed to list members" },
      { status: 500 }
    );
  }
}
