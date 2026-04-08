/**
 * GET /api/organizations — list all organizations with member counts.
 *
 * Requires authentication. Returns all organizations (not just user's).
 */

import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth-helpers";
import { getDbRead } from "@/lib/db";

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  member_count: number;
}

export async function GET(request: Request) {
  const authResult = await resolveUser(request);
  if (!authResult) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const dbRead = await getDbRead();
    const { results } = await dbRead.query<OrgRow>(
      `SELECT o.id, o.name, o.slug, o.logo_url,
         (SELECT COUNT(*) FROM organization_members WHERE org_id = o.id) AS member_count
       FROM organizations o
       ORDER BY o.name ASC`
    );

    const organizations = results.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      logoUrl: r.logo_url,
      memberCount: r.member_count,
    }));

    return NextResponse.json({ organizations });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("no such table")) {
      return NextResponse.json({ organizations: [] });
    }
    console.error("Failed to list organizations:", err);
    return NextResponse.json(
      { error: "Failed to list organizations" },
      { status: 500 }
    );
  }
}
