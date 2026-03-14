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
      allow_late_registration: number;
    }>("SELECT id, start_date, end_date, allow_late_registration FROM seasons WHERE id = ?", [seasonId]);

    if (!season) {
      return NextResponse.json(
        { error: "Season not found" },
        { status: 404 }
      );
    }

    const status = deriveSeasonStatus(season.start_date, season.end_date);
    if (status === "ended") {
      return NextResponse.json(
        { error: "Cannot register for ended seasons" },
        { status: 400 }
      );
    }
    if (status === "active" && !season.allow_late_registration) {
      return NextResponse.json(
        { error: "Registration closed — season already started" },
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

    // Fetch current team members to freeze into season roster
    const members = await client.query<{ user_id: string }>(
      "SELECT user_id FROM team_members WHERE team_id = ?",
      [team_id]
    );

    // Pre-validate: ensure no member is already registered for this season
    // via another team (UNIQUE(season_id, user_id) would reject anyway,
    // but checking upfront avoids partial writes)
    if (members.results.length > 0) {
      const placeholders = members.results.map(() => "?").join(",");
      const userIds = members.results.map((m) => m.user_id);
      const conflict = await client.firstOrNull<{ user_id: string }>(
        `SELECT user_id FROM season_team_members
         WHERE season_id = ? AND user_id IN (${placeholders})
         LIMIT 1`,
        [seasonId, ...userIds]
      );
      if (conflict) {
        return NextResponse.json(
          { error: "A team member is already registered for this season on another team" },
          { status: 409 }
        );
      }
    }

    // Write registration + frozen roster in a single batch.
    // D1 REST API batch() is NOT transactional — it executes statements
    // sequentially. If one fails, earlier ones are already committed.
    // On partial failure we compensate by deleting only the rows WE created
    // (identified by their UUIDs), never by (season_id, team_id) which
    // would also wipe data from a concurrent successful request.
    const id = crypto.randomUUID();
    const memberIds = members.results.map(() => crypto.randomUUID());
    const statements: Array<{ sql: string; params: unknown[] }> = [
      {
        sql: `INSERT INTO season_teams (id, season_id, team_id, registered_by)
              VALUES (?, ?, ?, ?)`,
        params: [id, seasonId, team_id, user.userId],
      },
      ...members.results.map((m, i) => ({
        sql: `INSERT INTO season_team_members (id, season_id, team_id, user_id)
              VALUES (?, ?, ?, ?)`,
        params: [memberIds[i]!, seasonId, team_id, m.user_id],
      })),
    ];

    try {
      await client.batch(statements);
    } catch (batchErr) {
      // Compensate: delete only rows created by THIS request (by UUID).
      // This is safe even under concurrent registrations because we never
      // touch rows written by other requests.
      try {
        if (memberIds.length > 0) {
          const ph = memberIds.map(() => "?").join(",");
          await client.execute(
            `DELETE FROM season_team_members WHERE id IN (${ph})`,
            memberIds
          );
        }
        await client.execute(
          "DELETE FROM season_teams WHERE id = ?",
          [id]
        );
      } catch {
        // Swallow cleanup errors — the original error is more important
      }
      throw batchErr;
    }

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
      allow_late_withdrawal: number;
    }>("SELECT id, start_date, end_date, allow_late_withdrawal FROM seasons WHERE id = ?", [seasonId]);

    if (!season) {
      return NextResponse.json(
        { error: "Season not found" },
        { status: 404 }
      );
    }

    const status = deriveSeasonStatus(season.start_date, season.end_date);
    if (status === "ended") {
      return NextResponse.json(
        { error: "Cannot withdraw from ended seasons" },
        { status: 400 }
      );
    }
    if (status === "active" && !season.allow_late_withdrawal) {
      return NextResponse.json(
        { error: "Withdrawal closed — season already started" },
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
      "DELETE FROM season_team_members WHERE season_id = ? AND team_id = ?",
      [seasonId, team_id]
    );

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
