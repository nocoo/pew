/**
 * GET/POST /api/admin/organizations/[orgId]/members — admin-only member management.
 *
 * - GET  → list members of the organization with user details
 * - POST → add a user to the organization
 */

import { NextResponse } from "next/server";
import { resolveAdmin } from "@/lib/admin";
import { getDbRead, getDbWrite } from "@/lib/db";

// ---------------------------------------------------------------------------
// GET — list members
// ---------------------------------------------------------------------------

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const admin = await resolveAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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

    // Get members with user details
    const { results } = await dbRead.query<{
      id: string;
      org_id: string;
      user_id: string;
      joined_at: string;
      user_name: string | null;
      user_email: string;
      user_image: string | null;
      user_slug: string | null;
    }>(
      `SELECT
         om.id, om.org_id, om.user_id, om.joined_at,
         u.name AS user_name, u.email AS user_email, u.image AS user_image, u.slug AS user_slug
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
        email: r.user_email,
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

// ---------------------------------------------------------------------------
// POST — add member
// ---------------------------------------------------------------------------

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const admin = await resolveAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { orgId } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { userId } = body as { userId?: string };

  if (!userId || typeof userId !== "string") {
    return NextResponse.json(
      { error: "userId is required" },
      { status: 400 }
    );
  }

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

    // Verify user exists
    const user = await dbRead.firstOrNull<{ id: string; name: string | null; email: string; image: string | null; slug: string | null }>(
      "SELECT id, name, email, image, slug FROM users WHERE id = ?",
      [userId]
    );

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Check if already a member
    const existing = await dbRead.firstOrNull<{ id: string }>(
      "SELECT id FROM organization_members WHERE org_id = ? AND user_id = ?",
      [orgId, userId]
    );

    if (existing) {
      return NextResponse.json(
        { error: "User is already a member of this organization" },
        { status: 409 }
      );
    }

    // Add member
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await dbWrite.execute(
      `INSERT INTO organization_members (id, org_id, user_id, joined_at)
       VALUES (?, ?, ?, ?)`,
      [id, orgId, userId, now]
    );

    return NextResponse.json(
      {
        id,
        orgId,
        userId,
        joinedAt: now,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          slug: user.slug,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("no such table")) {
      return NextResponse.json(
        { error: "Organization tables not yet migrated" },
        { status: 503 }
      );
    }
    console.error("Failed to add organization member:", err);
    return NextResponse.json(
      { error: "Failed to add member" },
      { status: 500 }
    );
  }
}
