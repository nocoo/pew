/**
 * GET/PATCH/DELETE /api/admin/organizations/[orgId] — single organization management.
 *
 * - GET    → get organization details with member count
 * - PATCH  → update organization name/slug
 * - DELETE → delete organization and all memberships
 */

import { NextResponse } from "next/server";
import { resolveAdmin } from "@/lib/admin";
import { getDbRead, getDbWrite } from "@/lib/db";

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const SLUG_RE = /^[a-z0-9-]{1,32}$/;

// ---------------------------------------------------------------------------
// GET — get single organization
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
    const org = await dbRead.firstOrNull<{
      id: string;
      name: string;
      slug: string;
      logo_url: string | null;
      created_by: string;
      created_at: string;
      updated_at: string;
    }>(
      "SELECT id, name, slug, logo_url, created_by, created_at, updated_at FROM organizations WHERE id = ?",
      [orgId]
    );

    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    // Get member count
    const countResult = await dbRead.firstOrNull<{ count: number }>(
      "SELECT COUNT(*) as count FROM organization_members WHERE org_id = ?",
      [orgId]
    );

    return NextResponse.json({
      id: org.id,
      name: org.name,
      slug: org.slug,
      logoUrl: org.logo_url,
      createdBy: org.created_by,
      createdAt: org.created_at,
      updatedAt: org.updated_at,
      memberCount: countResult?.count ?? 0,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("no such table")) {
      return NextResponse.json(
        { error: "Organization tables not yet migrated" },
        { status: 503 }
      );
    }
    console.error("Failed to get organization:", err);
    return NextResponse.json(
      { error: "Failed to get organization" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// PATCH — update organization
// ---------------------------------------------------------------------------

export async function PATCH(
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

  const dbRead = await getDbRead();
  const dbWrite = await getDbWrite();

  try {
    // Check org exists
    const existing = await dbRead.firstOrNull<{ id: string; slug: string }>(
      "SELECT id, slug FROM organizations WHERE id = ?",
      [orgId]
    );

    if (!existing) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    // Build update fields
    const updates: string[] = [];
    const values: unknown[] = [];

    // Name
    if (body.name !== undefined) {
      const name = body.name as string;
      if (typeof name !== "string" || name.length < 1 || name.length > 64) {
        return NextResponse.json(
          { error: "name must be 1-64 characters" },
          { status: 400 }
        );
      }
      updates.push("name = ?");
      values.push(name);
    }

    // Slug
    if (body.slug !== undefined) {
      const slug = body.slug as string;
      if (typeof slug !== "string" || !SLUG_RE.test(slug)) {
        return NextResponse.json(
          { error: "slug must be 1-32 lowercase alphanumeric or hyphens" },
          { status: 400 }
        );
      }
      // Check uniqueness if slug changed
      if (slug !== existing.slug) {
        const slugConflict = await dbRead.firstOrNull<{ id: string }>(
          "SELECT id FROM organizations WHERE slug = ? AND id != ?",
          [slug, orgId]
        );
        if (slugConflict) {
          return NextResponse.json(
            { error: "An organization with this slug already exists" },
            { status: 409 }
          );
        }
      }
      updates.push("slug = ?");
      values.push(slug);
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    updates.push("updated_at = datetime('now')");
    values.push(orgId);

    await dbWrite.execute(
      `UPDATE organizations SET ${updates.join(", ")} WHERE id = ?`,
      values
    );

    // Return updated organization
    const updated = await dbRead.firstOrNull<{
      id: string;
      name: string;
      slug: string;
      logo_url: string | null;
      created_by: string;
      created_at: string;
      updated_at: string;
    }>(
      "SELECT id, name, slug, logo_url, created_by, created_at, updated_at FROM organizations WHERE id = ?",
      [orgId]
    );

    if (!updated) {
      return NextResponse.json(
        { error: "Organization not found after update" },
        { status: 404 }
      );
    }

    // Get member count
    const countResult = await dbRead.firstOrNull<{ count: number }>(
      "SELECT COUNT(*) as count FROM organization_members WHERE org_id = ?",
      [orgId]
    );

    return NextResponse.json({
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      logoUrl: updated.logo_url,
      createdBy: updated.created_by,
      createdAt: updated.created_at,
      updatedAt: updated.updated_at,
      memberCount: countResult?.count ?? 0,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("no such table")) {
      return NextResponse.json(
        { error: "Organization tables not yet migrated" },
        { status: 503 }
      );
    }
    console.error("Failed to update organization:", err);
    return NextResponse.json(
      { error: "Failed to update organization" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE — delete organization
// ---------------------------------------------------------------------------

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const admin = await resolveAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { orgId } = await params;
  const dbRead = await getDbRead();
  const dbWrite = await getDbWrite();

  try {
    // Check org exists
    const existing = await dbRead.firstOrNull<{ id: string }>(
      "SELECT id FROM organizations WHERE id = ?",
      [orgId]
    );

    if (!existing) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    // Delete organization (CASCADE will remove memberships)
    await dbWrite.execute("DELETE FROM organizations WHERE id = ?", [orgId]);

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("no such table")) {
      return NextResponse.json(
        { error: "Organization tables not yet migrated" },
        { status: 503 }
      );
    }
    console.error("Failed to delete organization:", err);
    return NextResponse.json(
      { error: "Failed to delete organization" },
      { status: 500 }
    );
  }
}
