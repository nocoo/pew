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
import { getD1Client } from "@/lib/d1";
import { deriveSeasonStatus } from "@/lib/seasons";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SeasonRow {
  id: string;
  name: string;
  slug: string;
  start_date: string;
  end_date: string;
  snapshot_ready: number;
}

interface TeamTokenRow {
  team_id: string;
  team_name: string;
  team_slug: string;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
}

interface SnapshotRow {
  team_id: string;
  team_name: string;
  team_slug: string;
  rank: number;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
}

interface MemberRow {
  team_id: string;
  user_id: string;
  name: string | null;
  nickname: string | null;
  image: string | null;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
}

interface MemberSnapshotRow {
  team_id: string;
  user_id: string;
  name: string | null;
  nickname: string | null;
  image: string | null;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert ISO end_date to exclusive upper bound for hour_start queries. */
function endDateExclusive(endDate: string): string {
  // end_date is inclusive at minute precision, add 1 minute for exclusive < comparison
  const d = new Date(endDate);
  d.setUTCMinutes(d.getUTCMinutes() + 1);
  return d.toISOString().replace("T", " ").slice(0, 19);
}

function startDateInclusive(startDate: string): string {
  return new Date(startDate).toISOString().replace("T", " ").slice(0, 19);
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

  const client = getD1Client();

  try {
    // Fetch season by UUID or slug
    const isUUID = UUID_RE.test(seasonId);
    const season = await client.firstOrNull<SeasonRow>(
      isUUID
        ? "SELECT id, name, slug, start_date, end_date, snapshot_ready FROM seasons WHERE id = ?"
        : "SELECT id, name, slug, start_date, end_date, snapshot_ready FROM seasons WHERE slug = ?",
      [seasonId]
    );

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
      const snapshots = await client.query<SnapshotRow>(
        `SELECT
          ss.team_id,
          t.name AS team_name,
          t.slug AS team_slug,
          ss.rank,
          ss.total_tokens,
          ss.input_tokens,
          ss.output_tokens,
          ss.cached_input_tokens
        FROM season_snapshots ss
        JOIN teams t ON t.id = ss.team_id
        WHERE ss.season_id = ?
        ORDER BY ss.rank ASC`,
        [season.id]
      );

      const membersByTeam = new Map<string, MemberSnapshotRow[]>();
      if (expandMembers) {
        const memberSnapshots = await client.query<MemberSnapshotRow>(
          `SELECT
            sms.team_id,
            sms.user_id,
            u.name,
            u.nickname,
            u.image,
            sms.total_tokens,
            sms.input_tokens,
            sms.output_tokens,
            sms.cached_input_tokens
          FROM season_member_snapshots sms
          JOIN users u ON u.id = sms.user_id
          WHERE sms.season_id = ?
          ORDER BY sms.total_tokens DESC`,
          [season.id]
        );

        for (const row of memberSnapshots.results) {
          const list = membersByTeam.get(row.team_id) ?? [];
          list.push(row);
          membersByTeam.set(row.team_id, list);
        }
      }

      entries = snapshots.results.map((row) => ({
        rank: row.rank,
        team: {
          id: row.team_id,
          name: row.team_name,
          slug: row.team_slug,
        },
        total_tokens: row.total_tokens,
        input_tokens: row.input_tokens,
        output_tokens: row.output_tokens,
        cached_input_tokens: row.cached_input_tokens,
        ...(expandMembers && {
          members: (membersByTeam.get(row.team_id) ?? []).map((m) => ({
            user_id: m.user_id,
            name: m.nickname ?? m.name,
            image: m.image,
            total_tokens: m.total_tokens,
            input_tokens: m.input_tokens,
            output_tokens: m.output_tokens,
            cached_input_tokens: m.cached_input_tokens,
          })),
        }),
      }));
    } else {
      // Real-time aggregation from usage_records
      const teamRows = await client.query<TeamTokenRow>(
        `SELECT
          st.team_id,
          t.name AS team_name,
          t.slug AS team_slug,
          COALESCE(SUM(ur.total_tokens), 0) AS total_tokens,
          COALESCE(SUM(ur.input_tokens), 0) AS input_tokens,
          COALESCE(SUM(ur.output_tokens), 0) AS output_tokens,
          COALESCE(SUM(ur.cached_input_tokens), 0) AS cached_input_tokens
        FROM season_teams st
        JOIN teams t ON t.id = st.team_id
        LEFT JOIN season_team_members tm ON tm.team_id = st.team_id AND tm.season_id = st.season_id
        LEFT JOIN usage_records ur ON ur.user_id = tm.user_id
          AND ur.hour_start >= ?
          AND ur.hour_start < ?
        WHERE st.season_id = ?
        GROUP BY st.team_id
        ORDER BY total_tokens DESC`,
        [fromDate, toDate, season.id]
      );

      const membersByTeam = new Map<string, MemberRow[]>();
      if (expandMembers && teamRows.results.length > 0) {
        const teamIds = teamRows.results.map((r) => r.team_id);
        const placeholders = teamIds.map(() => "?").join(",");
        const memberRows = await client.query<MemberRow>(
          `SELECT
            tm.team_id,
            tm.user_id,
            u.name,
            u.nickname,
            u.image,
            COALESCE(SUM(ur.total_tokens), 0) AS total_tokens,
            COALESCE(SUM(ur.input_tokens), 0) AS input_tokens,
            COALESCE(SUM(ur.output_tokens), 0) AS output_tokens,
            COALESCE(SUM(ur.cached_input_tokens), 0) AS cached_input_tokens
          FROM season_team_members tm
          JOIN users u ON u.id = tm.user_id
          LEFT JOIN usage_records ur ON ur.user_id = tm.user_id
            AND ur.hour_start >= ?
            AND ur.hour_start < ?
          WHERE tm.season_id = ?
            AND tm.team_id IN (${placeholders})
          GROUP BY tm.team_id, tm.user_id
          ORDER BY total_tokens DESC`,
          [fromDate, toDate, season.id, ...teamIds]
        );

        for (const row of memberRows.results) {
          const list = membersByTeam.get(row.team_id) ?? [];
          list.push(row);
          membersByTeam.set(row.team_id, list);
        }
      }

      entries = teamRows.results.map((row, index) => ({
        rank: index + 1,
        team: {
          id: row.team_id,
          name: row.team_name,
          slug: row.team_slug,
        },
        total_tokens: row.total_tokens,
        input_tokens: row.input_tokens,
        output_tokens: row.output_tokens,
        cached_input_tokens: row.cached_input_tokens,
        ...(expandMembers && {
          members: (membersByTeam.get(row.team_id) ?? []).map((m) => ({
            user_id: m.user_id,
            name: m.nickname ?? m.name,
            image: m.image,
            total_tokens: m.total_tokens,
            input_tokens: m.input_tokens,
            output_tokens: m.output_tokens,
            cached_input_tokens: m.cached_input_tokens,
          })),
        }),
      }));
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
