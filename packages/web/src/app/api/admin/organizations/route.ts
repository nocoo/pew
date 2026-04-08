/**
 * GET/POST /api/admin/organizations — admin-only organization management.
 *
 * - GET  → list all organizations with member counts
 * - POST → create a new organization
 */

import { NextResponse } from "next/server";
import { resolveAdmin } from "@/lib/admin";
import { getDbRead, getDbWrite } from "@/lib/db";

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const SLUG_RE = /^[a-z0-9-]{1,32}$/;

// ---------------------------------------------------------------------------
// GET — list all organizations
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const admin = await resolveAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const dbRead = await getDbRead();

  try {
    const { results } = await dbRead.query<{
      id: string;
      name: string;
      slug: string;
      logo_url: string | null;
      created_by: string;
      created_at: string;
      updated_at: string;
      member_count: number;
    }>(
      `SELECT
         o.id, o.name, o.slug, o.logo_url, o.created_by, o.created_at, o.updated_at,
         COUNT(om.id) AS member_count
       FROM organizations o
       LEFT JOIN organization_members om ON om.org_id = o.id
       GROUP BY o.id
       ORDER BY o.name ASC`
    );

    const organizations = results.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      logoUrl: r.logo_url,
      createdBy: r.created_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      memberCount: r.member_count,
    }));

    return NextResponse.json({ organizations });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("no such table")) {
      return NextResponse.json(
        { error: "Organization tables not yet migrated" },
        { status: 503 }
      );
    }
    console.error("Failed to list organizations:", err);
    return NextResponse.json(
      { error: "Failed to list organizations" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST — create a new organization
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  const admin = await resolveAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, slug } = body as {
    name?: string;
    slug?: string;
  };

  // Validate name
  if (!name || typeof name !== "string" || name.length < 1 || name.length > 64) {
    return NextResponse.json(
      { error: "name must be 1-64 characters" },
      { status: 400 }
    );
  }

  // Validate slug
  if (!slug || typeof slug !== "string" || !SLUG_RE.test(slug)) {
    return NextResponse.json(
      { error: "slug must be 1-32 lowercase alphanumeric or hyphens" },
      { status: 400 }
    );
  }

  const dbRead = await getDbRead();
  const dbWrite = await getDbWrite();

  try {
    // Check slug uniqueness
    const existing = await dbRead.firstOrNull<{ id: string }>(
      "SELECT id FROM organizations WHERE slug = ?",
      [slug]
    );
    if (existing) {
      return NextResponse.json(
        { error: "An organization with this slug already exists" },
        { status: 409 }
      );
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await dbWrite.execute(
      `INSERT INTO organizations (id, name, slug, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, name, slug, admin.userId, now, now]
    );

    return NextResponse.json(
      {
        id,
        name,
        slug,
        logoUrl: null,
        createdBy: admin.userId,
        createdAt: now,
        updatedAt: now,
        memberCount: 0,
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
    console.error("Failed to create organization:", err);
    return NextResponse.json(
      { error: "Failed to create organization" },
      { status: 500 }
    );
  }
}
