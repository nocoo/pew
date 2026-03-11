/**
 * GET /api/teams — list teams the current user belongs to.
 * POST /api/teams — create a new team.
 */

import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth-helpers";
import { getD1Client } from "@/lib/d1";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TeamRow {
  id: string;
  name: string;
  slug: string;
  invite_code: string;
  created_by: string;
  created_at: string;
  member_count: number;
  logo_url: string | null;
}

// ---------------------------------------------------------------------------
// GET — list user's teams
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const authResult = await resolveUser(request);
  if (!authResult) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const client = getD1Client();
    const result = await client.query<TeamRow>(
      `SELECT t.id, t.name, t.slug, t.invite_code, t.created_by, t.created_at, t.logo_url,
         (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) AS member_count
       FROM teams t
       JOIN team_members tm ON tm.team_id = t.id
       WHERE tm.user_id = ?
       ORDER BY t.created_at DESC`,
      [authResult.userId],
    );

    return NextResponse.json({
      teams: result.results.map((t) => ({
        ...t,
        logo_url: t.logo_url ?? null,
      })),
    });
  } catch (err) {
    // Gracefully degrade if teams table doesn't exist yet
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("no such table")) {
      return NextResponse.json({ teams: [] });
    }
    console.error("Failed to query teams:", err);
    return NextResponse.json({ error: "Failed to load teams" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — create a new team
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  const authResult = await resolveUser(request);
  if (!authResult) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = body.name;
  if (typeof name !== "string" || name.length < 1 || name.length > 64) {
    return NextResponse.json(
      { error: "name must be 1-64 characters" },
      { status: 400 },
    );
  }

  // Auto-generate slug from name
  const baseSlug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);

  const slug = baseSlug || "team";

  try {
    const client = getD1Client();

    // Ensure unique slug
    const existing = await client.firstOrNull<{ id: string }>(
      "SELECT id FROM teams WHERE slug = ?",
      [slug],
    );

    const finalSlug = existing
      ? `${slug}-${crypto.randomUUID().slice(0, 6)}`
      : slug;

    // Generate invite code (8 chars)
    const inviteCode = crypto.randomUUID().replace(/-/g, "").slice(0, 8);

    const teamId = crypto.randomUUID();

    await client.execute(
      `INSERT INTO teams (id, name, slug, invite_code, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      [teamId, name, finalSlug, inviteCode, authResult.userId],
    );

    // Add creator as member (role: owner)
    await client.execute(
      `INSERT INTO team_members (id, team_id, user_id, role, joined_at)
       VALUES (?, ?, ?, 'owner', datetime('now'))`,
      [crypto.randomUUID(), teamId, authResult.userId],
    );

    return NextResponse.json({
      id: teamId,
      name,
      slug: finalSlug,
      invite_code: inviteCode,
      member_count: 1,
      logo_url: null,
    }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("no such table")) {
      return NextResponse.json(
        { error: "Teams feature not available yet — database migration pending" },
        { status: 503 },
      );
    }
    console.error("Failed to create team:", err);
    return NextResponse.json({ error: "Failed to create team" }, { status: 500 });
  }
}
