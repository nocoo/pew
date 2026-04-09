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
import { getDbRead, getDbWrite } from "@/lib/db";
import { deriveSeasonStatus } from "@/lib/seasons";
import type { MemberAggRow } from "@/lib/rpc-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function endDateExclusive(endDate: string): string {
  // end_date is inclusive at minute precision, add 1 minute for exclusive < comparison
  const d = new Date(endDate);
  d.setUTCMinutes(d.getUTCMinutes() + 1);
  return d.toISOString();
}

function startDateInclusive(startDate: string): string {
  return new Date(startDate).toISOString();
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
  const dbRead = await getDbRead();
  const dbWrite = await getDbWrite();

  try {
    // 1. Fetch season
    const season = await dbRead.getSeasonById(seasonId);

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
    const teamRows = await dbRead.aggregateSeasonTeamTokens(seasonId, fromDate, toDate);

    // 4. Aggregate member-level tokens
    let memberRows: MemberAggRow[] = [];
    if (teamRows.length > 0) {
      const teamIds = teamRows.map((r) => r.team_id);
      memberRows = await dbRead.aggregateSeasonMemberTokens(seasonId, fromDate, toDate, teamIds);
    }

    // 5. Mark snapshot as not-ready before writing data.
    //    Readers (leaderboard route) will serve live data while snapshot_ready=0.
    await dbWrite.execute(
      "UPDATE seasons SET snapshot_ready = ? WHERE id = ?",
      [0, seasonId]
    );

    // 6a. Upsert team snapshots via INSERT OR REPLACE.
    //     NOT atomic — see JSDoc for failure semantics. Re-running converges.
    const now = new Date().toISOString();
    const teamStatements = teamRows.map((row, i) => ({
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
    await dbWrite.batch([...teamStatements, ...memberStatements]);

    // 7. Clean up stale rows (teams/members removed since last snapshot).
    //    If this fails after upserts succeeded, stale rows remain but
    //    a re-run will clean them up (idempotent convergence).
    const activeTeamIds = teamRows.map((r) => r.team_id);
    if (activeTeamIds.length > 0) {
      const ph = activeTeamIds.map(() => "?").join(",");
      await dbWrite.batch([
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
      await dbWrite.batch([
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
        await dbWrite.batch(cleanupStatements);
      }
    }

    // 8. All writes succeeded — mark snapshot as ready.
    //    Readers will now serve frozen snapshot data instead of live data.
    await dbWrite.execute(
      "UPDATE seasons SET snapshot_ready = ? WHERE id = ?",
      [1, seasonId]
    );

    return NextResponse.json(
      {
        season_id: seasonId,
        team_count: teamRows.length,
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
