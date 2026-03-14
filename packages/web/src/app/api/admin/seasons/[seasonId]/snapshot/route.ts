/**
 * POST /api/admin/seasons/[seasonId]/snapshot — generate frozen snapshot.
 *
 * Admin-only. Only `ended` seasons can be snapshot-ted.
 *
 * Behavior:
 *   1. Validate season exists and status is "ended"
 *   2. Aggregate usage data for all registered teams + members
 *   3. Compute ranks (total_tokens DESC)
 *   4. Set snapshot_ready = 0 (readers fall back to live data during writes)
 *   5. Upsert snapshots (INSERT OR REPLACE), then clean up stale rows
 *   6. Set snapshot_ready = 1 (readers switch to frozen snapshot data)
 *   7. Return summary: team_count, member_count, created_at
 *
 * ⚠️ NON-ATOMIC WRITES: The D1 REST API batch() is NOT transactional —
 * it executes statements sequentially via individual HTTP requests
 * (see d1.ts#L104). If a failure occurs mid-batch:
 *   - Upsert phase: some rows may be updated while others are not,
 *     producing a mix of fresh and stale snapshot data.
 *   - Cleanup phase: may not run, leaving stale rows alongside new ones.
 * This is a known limitation. The upsert pattern avoids the worse
 * "total data loss" scenario of delete-then-insert, but true atomicity
 * requires the Cloudflare Worker D1 binding (env.DB.batch()) which
 * provides implicit transactional semantics. Snapshot is admin-only
 * and idempotent — a re-run will converge to correct state.
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
  // end_date is inclusive at minute precision, add 1 minute for exclusive < comparison
  const d = new Date(endDate);
  d.setUTCMinutes(d.getUTCMinutes() + 1);
  return d.toISOString().replace("T", " ").slice(0, 19);
}

function startDateInclusive(startDate: string): string {
  return new Date(startDate).toISOString().replace("T", " ").slice(0, 19);
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

    // 5. Mark snapshot as not-ready before writing data.
    //    Readers (leaderboard route) will serve live data while snapshot_ready=0.
    await client.execute(
      "UPDATE seasons SET snapshot_ready = ? WHERE id = ?",
      [0, seasonId]
    );

    // 6a. Upsert team snapshots via INSERT OR REPLACE.
    //     NOT atomic — see JSDoc for failure semantics. Re-running converges.
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    const teamStatements = teamRows.results.map((row, i) => ({
      sql: `INSERT OR REPLACE INTO season_snapshots
          (id, season_id, team_id, rank, total_tokens, input_tokens, output_tokens, cached_input_tokens, created_at)
        VALUES (
          COALESCE((SELECT id FROM season_snapshots WHERE season_id = ? AND team_id = ?), ?),
          ?, ?, ?, ?, ?, ?, ?, ?
        )`,
      params: [
        seasonId,
        row.team_id,
        uuid(),
        seasonId,
        row.team_id,
        i + 1,
        row.total_tokens,
        row.input_tokens,
        row.output_tokens,
        row.cached_input_tokens,
        now,
      ],
    }));

    // 6b. Upsert member snapshots
    const memberStatements = memberRows.map((row) => ({
      sql: `INSERT OR REPLACE INTO season_member_snapshots
          (id, season_id, team_id, user_id, total_tokens, input_tokens, output_tokens, cached_input_tokens, created_at)
        VALUES (
          COALESCE((SELECT id FROM season_member_snapshots WHERE season_id = ? AND team_id = ? AND user_id = ?), ?),
          ?, ?, ?, ?, ?, ?, ?, ?
        )`,
      params: [
        seasonId,
        row.team_id,
        row.user_id,
        uuid(),
        seasonId,
        row.team_id,
        row.user_id,
        row.total_tokens,
        row.input_tokens,
        row.output_tokens,
        row.cached_input_tokens,
        now,
      ],
    }));

    // Execute all upserts in a batch (sequential HTTP calls, not transactional)
    await client.batch([...teamStatements, ...memberStatements]);

    // 7. Clean up stale rows (teams/members removed since last snapshot).
    //    If this fails after upserts succeeded, stale rows remain but
    //    a re-run will clean them up (idempotent convergence).
    const activeTeamIds = teamRows.results.map((r) => r.team_id);
    if (activeTeamIds.length > 0) {
      const ph = activeTeamIds.map(() => "?").join(",");
      await client.batch([
        {
          sql: `DELETE FROM season_member_snapshots WHERE season_id = ? AND team_id NOT IN (${ph})`,
          params: [seasonId, ...activeTeamIds],
        },
        {
          sql: `DELETE FROM season_snapshots WHERE season_id = ? AND team_id NOT IN (${ph})`,
          params: [seasonId, ...activeTeamIds],
        },
      ]);
    } else {
      // No teams — clear all snapshots for this season
      await client.batch([
        {
          sql: "DELETE FROM season_member_snapshots WHERE season_id = ?",
          params: [seasonId],
        },
        {
          sql: "DELETE FROM season_snapshots WHERE season_id = ?",
          params: [seasonId],
        },
      ]);
    }

    // Also clean stale member rows within active teams
    if (memberRows.length > 0) {
      // Group member user_ids by team
      const membersByTeam = new Map<string, string[]>();
      for (const row of memberRows) {
        const ids = membersByTeam.get(row.team_id) ?? [];
        ids.push(row.user_id);
        membersByTeam.set(row.team_id, ids);
      }
      const cleanupStatements = [];
      for (const [teamId, userIds] of membersByTeam) {
        const ph = userIds.map(() => "?").join(",");
        cleanupStatements.push({
          sql: `DELETE FROM season_member_snapshots WHERE season_id = ? AND team_id = ? AND user_id NOT IN (${ph})`,
          params: [seasonId, teamId, ...userIds],
        });
      }
      if (cleanupStatements.length > 0) {
        await client.batch(cleanupStatements);
      }
    }

    // 8. All writes succeeded — mark snapshot as ready.
    //    Readers will now serve frozen snapshot data instead of live data.
    await client.execute(
      "UPDATE seasons SET snapshot_ready = ? WHERE id = ?",
      [1, seasonId]
    );

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
