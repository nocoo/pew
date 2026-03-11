/**
 * POST/DELETE /api/seasons/[seasonId]/register — season team registration.
 *
 * - POST   → register a team for the season (team owner only)
 * - DELETE → withdraw a team from the season (team owner only, upcoming only)
 */

import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth-helpers";
import { getD1Client } from "@/lib/d1";
import { deriveSeasonStatus } from "@/lib/seasons";

// ---------------------------------------------------------------------------
// POST — register team for season
// ---------------------------------------------------------------------------

export async function POST(
  request: Request,
  { params }: { params: Promise<{ seasonId: string }> }
) {
  const user = await resolveUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { seasonId } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { team_id } = body as { team_id?: string };
  if (!team_id || typeof team_id !== "string") {
    return NextResponse.json(
      { error: "team_id is required" },
      { status: 400 }
    );
  }

  const client = getD1Client();

  try {
    // Verify season exists
    const season = await client.firstOrNull<{
      id: string;
      start_date: string;
      end_date: string;
    }>("SELECT id, start_date, end_date FROM seasons WHERE id = ?", [seasonId]);

    if (!season) {
      return NextResponse.json(
        { error: "Season not found" },
        { status: 404 }
      );
    }

    const status = deriveSeasonStatus(season.start_date, season.end_date);
    if (status === "ended") {
      return NextResponse.json(
        { error: "Cannot register for an ended season" },
        { status: 400 }
      );
    }

    // Verify user is team owner
    const membership = await client.firstOrNull<{ role: string }>(
      "SELECT role FROM team_members WHERE team_id = ? AND user_id = ?",
      [team_id, user.userId]
    );

    if (!membership || membership.role !== "owner") {
      return NextResponse.json(
        { error: "Only team owners can register for seasons" },
        { status: 403 }
      );
    }

    // Check duplicate registration
    const existing = await client.firstOrNull<{ id: string }>(
      "SELECT id FROM season_teams WHERE season_id = ? AND team_id = ?",
      [seasonId, team_id]
    );

    if (existing) {
      return NextResponse.json(
        { error: "Team is already registered for this season" },
        { status: 409 }
      );
    }

    const id = crypto.randomUUID();
    await client.execute(
      `INSERT INTO season_teams (id, season_id, team_id, registered_by)
       VALUES (?, ?, ?, ?)`,
      [id, seasonId, team_id, user.userId]
    );

    return NextResponse.json(
      {
        id,
        season_id: seasonId,
        team_id,
        registered_at: new Date().toISOString(),
      },
      { status: 201 }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("no such table")) {
      return NextResponse.json(
        { error: "Season tables not yet migrated" },
        { status: 503 }
      );
    }
    console.error("Failed to register team for season:", err);
    return NextResponse.json(
      { error: "Failed to register team" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE — withdraw team from season
// ---------------------------------------------------------------------------

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ seasonId: string }> }
) {
  const user = await resolveUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { seasonId } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { team_id } = body as { team_id?: string };
  if (!team_id || typeof team_id !== "string") {
    return NextResponse.json(
      { error: "team_id is required" },
      { status: 400 }
    );
  }

  const client = getD1Client();

  try {
    // Verify season exists
    const season = await client.firstOrNull<{
      id: string;
      start_date: string;
      end_date: string;
    }>("SELECT id, start_date, end_date FROM seasons WHERE id = ?", [seasonId]);

    if (!season) {
      return NextResponse.json(
        { error: "Season not found" },
        { status: 404 }
      );
    }

    const status = deriveSeasonStatus(season.start_date, season.end_date);
    if (status !== "upcoming") {
      return NextResponse.json(
        { error: "Can only withdraw from upcoming seasons" },
        { status: 400 }
      );
    }

    // Verify user is team owner
    const membership = await client.firstOrNull<{ role: string }>(
      "SELECT role FROM team_members WHERE team_id = ? AND user_id = ?",
      [team_id, user.userId]
    );

    if (!membership || membership.role !== "owner") {
      return NextResponse.json(
        { error: "Only team owners can withdraw from seasons" },
        { status: 403 }
      );
    }

    // Verify registration exists
    const registration = await client.firstOrNull<{ id: string }>(
      "SELECT id FROM season_teams WHERE season_id = ? AND team_id = ?",
      [seasonId, team_id]
    );

    if (!registration) {
      return NextResponse.json(
        { error: "Team is not registered for this season" },
        { status: 404 }
      );
    }

    await client.execute(
      "DELETE FROM season_teams WHERE season_id = ? AND team_id = ?",
      [seasonId, team_id]
    );

    return NextResponse.json({ deleted: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("no such table")) {
      return NextResponse.json(
        { error: "Season tables not yet migrated" },
        { status: 503 }
      );
    }
    console.error("Failed to withdraw team from season:", err);
    return NextResponse.json(
      { error: "Failed to withdraw team" },
      { status: 500 }
    );
  }
}
