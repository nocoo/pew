/**
 * GET /api/organizations/mine — list organizations the current user belongs to.
 *
 * Requires authentication.
 */

import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth-helpers";
import { getDbRead } from "@/lib/db";

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
}

export async function GET(request: Request) {
  const authResult = await resolveUser(request);
  if (!authResult) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const dbRead = await getDbRead();
    const { results } = await dbRead.query<OrgRow>(
      `SELECT o.id, o.name, o.slug, o.logo_url
       FROM organizations o
       JOIN organization_members om ON om.org_id = o.id
       WHERE om.user_id = ?
       ORDER BY o.name ASC`,
      [authResult.userId]
    );

    const organizations = results.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      logoUrl: r.logo_url,
    }));

    return NextResponse.json({ organizations });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("no such table")) {
      return NextResponse.json({ organizations: [] });
    }
    console.error("Failed to list user organizations:", err);
    return NextResponse.json(
      { error: "Failed to list organizations" },
      { status: 500 }
    );
  }
}
