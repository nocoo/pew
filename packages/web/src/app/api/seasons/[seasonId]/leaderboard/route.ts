/**
 * GET /api/seasons/[seasonId]/leaderboard — season leaderboard rankings.
 *
 * Public endpoint (no auth required).
 *
 * Query params:
 *   expand=members — include per-member token breakdown for each team
 *
 * Logic:
 *   - If snapshot exists (season_snapshots rows for this season): read frozen data
 *   - Otherwise: real-time aggregation from usage_records within season date range
 *
 * Date range: start_date 00:00:00Z to end_date+1 00:00:00Z (end_date inclusive).
 */

import { NextResponse } from "next/server";
import { getDbRead } from "@/lib/db";
import { deriveSeasonStatus } from "@/lib/seasons";
import type {
  SeasonSnapshotRow,
  SeasonMemberSnapshotRow,
  SeasonTeamTokenRow,
  SeasonMemberTokenRow,
  SeasonTeamSessionStatsRow,
  SeasonMemberSessionStatsRow,
} from "@/lib/rpc-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert ISO end_date to exclusive upper bound for hour_start queries.
 *
 * Output MUST be full ISO 8601 (`toISOString()`) so that SQLite lexicographic
 * comparison works correctly against `hour_start` values stored as
 * `"2026-03-21T16:00:00.000Z"`.  The previous `.replace("T"," ").slice(0,19)`
 * format caused `T` (ASCII 84) > ` ` (ASCII 32), making every record whose
 * date-part matched the boundary pass the `>=` check regardless of time.
 */
function endDateExclusive(endDate: string): string {
  // end_date is inclusive at minute precision, add 1 minute for exclusive < comparison
  const d = new Date(endDate);
  d.setUTCMinutes(d.getUTCMinutes() + 1);
  return d.toISOString();
}

function startDateInclusive(startDate: string): string {
  return new Date(startDate).toISOString();
}

// ---------------------------------------------------------------------------
// Helpers — identifier detection
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(
  request: Request,
  { params }: { params: Promise<{ seasonId: string }> }
) {
  const { seasonId } = await params;
  const url = new URL(request.url);
  const expandMembers = url.searchParams.get("expand") === "members";

  const db = await getDbRead();

  try {
    // Fetch season by UUID or slug
    const isUUID = UUID_RE.test(seasonId);
    const season = isUUID
      ? await db.getSeasonById(seasonId)
      : await db.getSeasonBySlug(seasonId);

    if (!season) {
      return NextResponse.json(
        { error: "Season not found" },
        { status: 404 }
      );
    }

    const status = deriveSeasonStatus(season.start_date, season.end_date);

    // Use snapshot_ready flag instead of querying season_snapshots table.
    // This avoids reading partially-written snapshot data during non-atomic writes.
    const hasSnapshot = season.snapshot_ready === 1;

    const fromDate = startDateInclusive(season.start_date);
    const toDate = endDateExclusive(season.end_date);

    let entries;

    if (hasSnapshot) {
      // Read from frozen snapshot tables
      const snapshots = await db.getSeasonSnapshots(season.id);

      const membersByTeam = new Map<string, SeasonMemberSnapshotRow[]>();
      if (expandMembers) {
        // Only include members who have opted in (is_public = 1)
        // Their token contributions are still counted in team totals
        const memberSnapshots = await db.getSeasonMemberSnapshots(
          season.id,
          true // publicOnly
        );

        for (const row of memberSnapshots) {
          const list = membersByTeam.get(row.team_id) ?? [];
          list.push(row);
          membersByTeam.set(row.team_id, list);
        }
      }

      entries = snapshots.map((row: SeasonSnapshotRow) => ({
        rank: row.rank,
        team: {
          id: row.team_id,
          name: row.team_name,
          slug: row.team_slug,
          logoUrl: row.team_logo_url,
        },
        total_tokens: row.total_tokens,
        input_tokens: row.input_tokens,
        output_tokens: row.output_tokens,
        cached_input_tokens: row.cached_input_tokens,
        session_count: 0,
        total_duration_seconds: 0,
        ...(expandMembers && {
          members: (membersByTeam.get(row.team_id) ?? []).map((m) => ({
            user_id: m.user_id,
            slug: m.slug,
            name: m.nickname ?? m.name,
            image: m.image,
            total_tokens: m.total_tokens,
            input_tokens: m.input_tokens,
            output_tokens: m.output_tokens,
            cached_input_tokens: m.cached_input_tokens,
            session_count: 0,
            total_duration_seconds: 0,
          })),
        }),
      }));

      // Enrich snapshot entries with live session stats
      const snapshotTeamIds = snapshots.map((r: SeasonSnapshotRow) => r.team_id);
      if (snapshotTeamIds.length > 0) {
        try {
          const teamSessionStats = await db.getSeasonTeamSessionStats(
            season.id,
            snapshotTeamIds,
            fromDate,
            toDate
          );
          const teamSessionMap = new Map(
            teamSessionStats.map((r: SeasonTeamSessionStatsRow) => [r.team_id, r])
          );
          for (const entry of entries) {
            const stats = teamSessionMap.get(entry.team.id);
            if (stats) {
              entry.session_count = stats.session_count;
              entry.total_duration_seconds = stats.total_duration_seconds;
            }
          }

          if (expandMembers) {
            const memberSessionStats = await db.getSeasonMemberSessionStats(
              season.id,
              snapshotTeamIds,
              fromDate,
              toDate
            );
            const memberSessionMap = new Map(
              memberSessionStats.map((r: SeasonMemberSessionStatsRow) => [
                `${r.team_id}:${r.user_id}`,
                r,
              ])
            );
            for (const entry of entries) {
              if (entry.members) {
                for (const member of entry.members) {
                  const stats = memberSessionMap.get(
                    `${entry.team.id}:${member.user_id}`
                  );
                  if (stats) {
                    member.session_count = stats.session_count;
                    member.total_duration_seconds = stats.total_duration_seconds;
                  }
                }
              }
            }
          }
        } catch {
          // Silently skip if session_records table doesn't exist yet
        }
      }
    } else {
      // Real-time aggregation from usage_records
      const teamRows = await db.getSeasonTeamTokens(season.id, fromDate, toDate);

      const membersByTeam = new Map<string, SeasonMemberTokenRow[]>();
      if (expandMembers && teamRows.length > 0) {
        const teamIds = teamRows.map((r: SeasonTeamTokenRow) => r.team_id);
        // Only include members who have opted in (is_public = 1)
        // Their token contributions are still counted in team totals
        const memberRows = await db.getSeasonMemberTokens(
          season.id,
          teamIds,
          fromDate,
          toDate,
          true // publicOnly
        );

        for (const row of memberRows) {
          const list = membersByTeam.get(row.team_id) ?? [];
          list.push(row);
          membersByTeam.set(row.team_id, list);
        }
      }

      entries = teamRows.map((row: SeasonTeamTokenRow, index: number) => ({
        rank: index + 1,
        team: {
          id: row.team_id,
          name: row.team_name,
          slug: row.team_slug,
          logoUrl: row.team_logo_url,
        },
        total_tokens: row.total_tokens,
        input_tokens: row.input_tokens,
        output_tokens: row.output_tokens,
        cached_input_tokens: row.cached_input_tokens,
        session_count: 0,
        total_duration_seconds: 0,
        ...(expandMembers && {
          members: (membersByTeam.get(row.team_id) ?? []).map((m) => ({
            user_id: m.user_id,
            slug: m.slug,
            name: m.nickname ?? m.name,
            image: m.image,
            total_tokens: m.total_tokens,
            input_tokens: m.input_tokens,
            output_tokens: m.output_tokens,
            cached_input_tokens: m.cached_input_tokens,
            session_count: 0,
            total_duration_seconds: 0,
          })),
        }),
      }));

      // Enrich with session stats
      const liveTeamIds = teamRows.map((r: SeasonTeamTokenRow) => r.team_id);
      if (liveTeamIds.length > 0) {
        try {
          const teamSessionStats = await db.getSeasonTeamSessionStats(
            season.id,
            liveTeamIds,
            fromDate,
            toDate
          );
          const teamSessionMap = new Map(
            teamSessionStats.map((r: SeasonTeamSessionStatsRow) => [r.team_id, r])
          );
          for (const entry of entries) {
            const stats = teamSessionMap.get(entry.team.id);
            if (stats) {
              entry.session_count = stats.session_count;
              entry.total_duration_seconds = stats.total_duration_seconds;
            }
          }

          if (expandMembers) {
            const memberSessionStats = await db.getSeasonMemberSessionStats(
              season.id,
              liveTeamIds,
              fromDate,
              toDate
            );
            const memberSessionMap = new Map(
              memberSessionStats.map((r: SeasonMemberSessionStatsRow) => [
                `${r.team_id}:${r.user_id}`,
                r,
              ])
            );
            for (const entry of entries) {
              if (entry.members) {
                for (const member of entry.members) {
                  const stats = memberSessionMap.get(
                    `${entry.team.id}:${member.user_id}`
                  );
                  if (stats) {
                    member.session_count = stats.session_count;
                    member.total_duration_seconds = stats.total_duration_seconds;
                  }
                }
              }
            }
          }
        } catch {
          // Silently skip if session_records table doesn't exist yet
        }
      }
    }

    return NextResponse.json({
      season: {
        id: season.id,
        name: season.name,
        slug: season.slug,
        start_date: season.start_date,
        end_date: season.end_date,
        status,
        is_snapshot: hasSnapshot,
      },
      entries,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("no such table")) {
      return NextResponse.json(
        { error: "Season tables not yet migrated" },
        { status: 503 }
      );
    }
    console.error("Failed to query season leaderboard:", err);
    return NextResponse.json(
      { error: "Failed to load season leaderboard" },
      { status: 500 }
    );
  }
}
