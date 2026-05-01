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
    const org = await dbRead.firstOrNull<{ id: string }>(
      "SELECT id FROM organizations WHERE id = ?",
      [orgId]
    );

    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    // Get members with user details (no email)
    const { results } = await dbRead.query<{
      id: string;
      org_id: string;
      user_id: string;
      joined_at: string;
      user_name: string | null;
      user_image: string | null;
      user_slug: string | null;
    }>(
      `SELECT
         om.id, om.org_id, om.user_id, om.joined_at,
         u.name AS user_name, u.image AS user_image, u.slug AS user_slug
       FROM organization_members om
       JOIN users u ON u.id = om.user_id
       WHERE om.org_id = ?
       ORDER BY om.joined_at DESC`,
      [orgId]
    );

    const members = results.map((r) => ({
      id: r.id,
      orgId: r.org_id,
      userId: r.user_id,
      joinedAt: r.joined_at,
      user: {
        id: r.user_id,
        name: r.user_name,
        image: r.user_image,
        slug: r.user_slug,
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
