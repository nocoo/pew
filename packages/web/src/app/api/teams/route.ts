/**
 * GET /api/teams — list teams the current user belongs to.
 * POST /api/teams — create a new team.
 */

import { randomBytes } from "crypto";

import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth-helpers";
import { getDbRead, getDbWrite } from "@/lib/db";
import type { TeamRow } from "@/lib/rpc-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip invite_code from team data unless the requesting user is the creator. */
function sanitizeTeamForMember(
  team: TeamRow,
  userId: string,
): Omit<TeamRow, "invite_code"> | TeamRow {
  if (team.created_by === userId) return team;
  const { invite_code: _, ...rest } = team;
  return rest;
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
    const dbRead = await getDbRead();
    const teams = await dbRead.listTeamsForUser(authResult.userId);

    return NextResponse.json({
      teams: teams.map((t) => ({
        ...sanitizeTeamForMember(t, authResult.userId),
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
    const dbRead = await getDbRead();
    const dbWrite = await getDbWrite();

    // Ensure unique slug
    const existing = await dbRead.checkTeamSlugExists(slug);

    const finalSlug = existing
      ? `${slug}-${crypto.randomUUID().slice(0, 6)}`
      : slug;

    // Generate invite code — 128 bits of entropy (32 hex chars)
    // TODO(migration): Teams created before this change still have weak 8-char
    // hex invite codes. Use the regenerateInviteCode action via
    // PATCH /api/teams/[teamId] to rotate individual codes, or run a bulk
    // migration against D1 when deployment coordination is available.
    const inviteCode = randomBytes(16).toString("hex");

    const teamId = crypto.randomUUID();

    await dbWrite.execute(
      `INSERT INTO teams (id, name, slug, invite_code, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      [teamId, name, finalSlug, inviteCode, authResult.userId],
    );

    // Add creator as member (role: owner)
    await dbWrite.execute(
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
