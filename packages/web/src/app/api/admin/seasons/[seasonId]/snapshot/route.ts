/**
 * POST /api/admin/seasons/[seasonId]/snapshot — generate frozen snapshot.
 *
 * Admin-only. Only `ended` seasons can be snapshot-ted.
 *
 * Behavior:
 *   1. Validate season exists and status is "ended"
 *   2. Aggregate usage data for all registered teams + members
 *   3. Compute ranks (total_tokens DESC)
 *   4. Idempotent: DELETE old snapshots then re-INSERT
 *   5. Return summary: team_count, member_count, created_at
 */

import { NextResponse } from "next/server";
import { resolveAdmin } from "@/lib/admin";
import { getD1Client } from "@/lib/d1";
import { deriveSeasonStatus } from "@/lib/seasons";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SeasonRow {
  id: string;
  start_date: string;
  end_date: string;
}

interface TeamAggRow {
  team_id: string;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
}

interface MemberAggRow {
  team_id: string;
  user_id: string;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function endDateExclusive(endDate: string): string {
  const d = new Date(endDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().replace("T", " ").slice(0, 19);
}

function startDateInclusive(startDate: string): string {
  return startDate + " 00:00:00";
}

function uuid(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(
  request: Request,
  { params }: { params: Promise<{ seasonId: string }> }
) {
  const admin = await resolveAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { seasonId } = await params;
  const client = getD1Client();

  try {
    // 1. Fetch season
    const season = await client.firstOrNull<SeasonRow>(
      "SELECT id, start_date, end_date FROM seasons WHERE id = ?",
      [seasonId]
    );

    if (!season) {
      return NextResponse.json(
        { error: "Season not found" },
        { status: 404 }
      );
    }

    // 2. Validate status is ended
    const status = deriveSeasonStatus(season.start_date, season.end_date);
    if (status !== "ended") {
      return NextResponse.json(
        { error: "Snapshot can only be created for ended seasons" },
        { status: 400 }
      );
    }

    const fromDate = startDateInclusive(season.start_date);
    const toDate = endDateExclusive(season.end_date);

    // 3. Aggregate team-level tokens
    const teamRows = await client.query<TeamAggRow>(
      `SELECT
        st.team_id,
        COALESCE(SUM(ur.total_tokens), 0) AS total_tokens,
        COALESCE(SUM(ur.input_tokens), 0) AS input_tokens,
        COALESCE(SUM(ur.output_tokens), 0) AS output_tokens,
        COALESCE(SUM(ur.cached_input_tokens), 0) AS cached_input_tokens
      FROM season_teams st
      LEFT JOIN season_team_members tm ON tm.team_id = st.team_id AND tm.season_id = st.season_id
      LEFT JOIN usage_records ur ON ur.user_id = tm.user_id
        AND ur.hour_start >= ?
        AND ur.hour_start < ?
      WHERE st.season_id = ?
      GROUP BY st.team_id
      ORDER BY total_tokens DESC`,
      [fromDate, toDate, seasonId]
    );

    // 4. Aggregate member-level tokens
    let memberRows: MemberAggRow[] = [];
    if (teamRows.results.length > 0) {
      const teamIds = teamRows.results.map((r) => r.team_id);
      const placeholders = teamIds.map(() => "?").join(",");
      const result = await client.query<MemberAggRow>(
        `SELECT
          tm.team_id,
          tm.user_id,
          COALESCE(SUM(ur.total_tokens), 0) AS total_tokens,
          COALESCE(SUM(ur.input_tokens), 0) AS input_tokens,
          COALESCE(SUM(ur.output_tokens), 0) AS output_tokens,
          COALESCE(SUM(ur.cached_input_tokens), 0) AS cached_input_tokens
        FROM season_team_members tm
        LEFT JOIN usage_records ur ON ur.user_id = tm.user_id
          AND ur.hour_start >= ?
          AND ur.hour_start < ?
        WHERE tm.season_id = ?
          AND tm.team_id IN (${placeholders})
        GROUP BY tm.team_id, tm.user_id
        ORDER BY total_tokens DESC`,
        [fromDate, toDate, seasonId, ...teamIds]
      );
      memberRows = result.results;
    }

    // 5. Idempotent: delete old snapshots
    await client.execute(
      "DELETE FROM season_member_snapshots WHERE season_id = ?",
      [seasonId]
    );
    await client.execute(
      "DELETE FROM season_snapshots WHERE season_id = ?",
      [seasonId]
    );

    // 6. Insert team snapshots with computed ranks
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    for (const [i, row] of teamRows.results.entries()) {
      await client.execute(
        `INSERT INTO season_snapshots
          (id, season_id, team_id, rank, total_tokens, input_tokens, output_tokens, cached_input_tokens, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuid(),
          seasonId,
          row.team_id,
          i + 1,
          row.total_tokens,
          row.input_tokens,
          row.output_tokens,
          row.cached_input_tokens,
          now,
        ]
      );
    }

    // 7. Insert member snapshots
    for (const row of memberRows) {
      await client.execute(
        `INSERT INTO season_member_snapshots
          (id, season_id, team_id, user_id, total_tokens, input_tokens, output_tokens, cached_input_tokens, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuid(),
          seasonId,
          row.team_id,
          row.user_id,
          row.total_tokens,
          row.input_tokens,
          row.output_tokens,
          row.cached_input_tokens,
          now,
        ]
      );
    }

    return NextResponse.json(
      {
        season_id: seasonId,
        team_count: teamRows.results.length,
        member_count: memberRows.length,
        created_at: now,
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
    console.error("Failed to create season snapshot:", err);
    return NextResponse.json(
      { error: "Failed to create season snapshot" },
      { status: 500 }
    );
  }
}
